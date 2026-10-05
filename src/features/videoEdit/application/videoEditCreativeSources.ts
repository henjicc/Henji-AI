import { createLogger } from '@/core/logging'
import { videoEditCreativeSourceRequestSchema, type VideoEditCreativeSourceRequest } from '@/core/videoEdit/creativeResult'
import { readGenerationResultMedia } from '@/features/generation/application/generationResultSource'
import { readPersistedCanvasProjectSnapshot } from '@/features/canvas/application/canvasQueryService'
import { getGraphNodeMediaOutputs } from '@/features/canvas/application/graphOutputResolver'
import { parseCameraStageRenderTaskRef } from '@/features/cameraStage/application/cameraStageRenderCapabilityAdapter'
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { addMediaReferenceToLibrary, resolveLocalAssetPath } from '@/features/assets/services/assetCollectionService'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import { exportAudioEdit } from '@/features/audioEdit/application/audioEditApplicationService'
import { flushAudioEditProject, getAudioEditProjectInstance, loadAudioEditProject } from '@/features/audioEdit/application/audioEditProjectInstances'
import { loadImageEditorV3Document, createImageEditorV3RequestId } from '@/commands/imageEditorV3'
import { materializeImageEditorV3StandaloneRaster } from '@/commands/imageEditorV3Export'
import { createImageMarkV3RasterExportSpec } from '@/features/imageMark/standalone/imageMarkV3RasterExport'
import { prepareImageEditorV3ExportRender, renderImageEditorV3ExportTilesWithGpu } from '@/features/imageEdit/v3/export'
import { getPlatform } from '@/platform/runtime'
import type { AssetFileContent, AssetRecord, AssetSource } from '@/platform/contracts/assetLibrary'
import type { ImageEditorV3DocumentRef } from '@/platform/contracts/imageEditorV3'
import { sameVideoEditMediaPath } from './videoEditMedia'
import { sameVideoEditAssetContent } from './videoEditAssetReferences'
import type { VideoEditCreativeResult } from './videoEditResultTarget'

export type { VideoEditCreativeSourceRequest } from '@/core/videoEdit/creativeResult'
export interface VideoEditCreativeSourceOptions { signal?: AbortSignal; assertTarget: () => void }
type MediaKind = 'image' | 'video' | 'audio'
interface PublishedSource {
  path: string
  mediaType: MediaKind
  name: string
  librarySource: AssetSource
  originId: string
  completion: unknown
  captions?: string
  dimensions?: { width: number; height: number }
  /** Managed files created by this preparation; released only if no library record references them. */
  ownedFiles?: readonly string[]
  recheck(): Promise<void>
}
const logger = createLogger('features.videoEdit.creativeSources')
const SUBTITLE_BYTES = 2 * 1024 * 1024

function assertCurrent(options: VideoEditCreativeSourceOptions): void {
  options.signal?.throwIfAborted()
  options.assertTarget()
}
async function guarded<T>(options: VideoEditCreativeSourceOptions, operation: () => Promise<T>): Promise<T> {
  assertCurrent(options)
  try { const value = await operation(); assertCurrent(options); return value }
  catch (error) { assertCurrent(options); throw error }
}
function localPath(source: string): string {
  const path = resolveLocalAssetPath(source)
  if (!path || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path)) throw new Error('此结果尚未保存为本地文件，请先完成原结果保存。')
  return path
}
function sameContent(left: AssetFileContent, right: AssetFileContent): boolean {
  return left.contentIdentity === right.contentIdentity && left.sizeBytes === right.sizeBytes && left.fileModifiedAt === right.fileModifiedAt
}
function contentOf(asset: AssetRecord): AssetFileContent {
  if (asset.inspectionStatus !== 'ready' || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes! < 0 || asset.fileModifiedAt === null || !Number.isFinite(asset.fileModifiedAt) || !asset.contentIdentity || !/^[a-f0-9]{64}$/.test(asset.contentIdentity)) throw new Error('结果尚未完成本地文件检查，请在资产库检查原文件。')
  return { sizeBytes: asset.sizeBytes!, fileModifiedAt: asset.fileModifiedAt, contentIdentity: asset.contentIdentity }
}
function conflict(): never { throw new Error('原创作结果在检查期间已改变，请重新选择；已完成文件仍保留。') }

async function generationSource(source: Extract<VideoEditCreativeSourceRequest, { kind: 'generation.result' }>, options: VideoEditCreativeSourceOptions): Promise<PublishedSource> {
  const read = () => readGenerationResultMedia(source.id, undefined, { outputIndex: source.outputIndex, localOnly: true })
  const result = await guarded(options, read)
  if (!result) throw new Error('原生成结果不存在，请从历史记录重新选择。')
  const path = localPath(result.source)
  return { path, mediaType: result.mediaType, name: result.name, librarySource: 'generated', originId: source.id,
    completion: source.outputIndex,
    async recheck() { const latest = await read(); if (!latest || latest.mediaType !== result.mediaType || !sameVideoEditMediaPath(localPath(latest.source), path)) conflict() },
  }
}

interface CanvasOutput { path: string; mediaType: MediaKind; name: string; completion: string; node: CanvasNode }
/** Persisted canvas completions are the durable truth; live task state is released after acknowledgement. */
async function readCanvasOutput(projectId: string, select: (nodes: CanvasNode[]) => CanvasNode | undefined): Promise<CanvasOutput> {
  const project = await readPersistedCanvasProjectSnapshot(projectId)
  const node = select(project.nodes)
  const descriptor = node?.data.generationOutputDescriptor
  if (!node || node.data.isGenerating || node.data.generationError || node.data.generationCancelled || !node.data.generationOutputCommitId || descriptor?.version !== 1) throw new Error('请选择原画布中已保存的正式完成结果。')
  const outputs = getGraphNodeMediaOutputs(node, new Map(project.nodes.map(node => [node.id, node])))
  if (outputs.length !== 1 || !['image', 'video', 'audio'].includes(outputs[0].kind) || outputs[0].kind !== descriptor.mediaType) throw new Error('此结果没有唯一已发布的图片、视频或音频，请选择具体完成项。')
  return { path: localPath(outputs[0].url), mediaType: outputs[0].kind as MediaKind, name: node.data.displayName || '画布结果', completion: JSON.stringify([node.data.generationOutputCommitId, descriptor]), node }
}
function canvasPublished(output: CanvasOutput, librarySource: AssetSource, originId: string, read: () => Promise<CanvasOutput>): PublishedSource {
  return { path: output.path, mediaType: output.mediaType, name: output.name, librarySource, originId, completion: output.completion,
    async recheck() { const latest = await read(); if (latest.mediaType !== output.mediaType || latest.completion !== output.completion || !sameVideoEditMediaPath(latest.path, output.path)) conflict() },
  }
}

async function canvasSource(source: Extract<VideoEditCreativeSourceRequest, { kind: 'canvas.node' }>, options: VideoEditCreativeSourceOptions): Promise<PublishedSource> {
  const read = () => readCanvasOutput(source.projectId, nodes => nodes.find(node => node.id === source.nodeId
    && (source.completionId === undefined || node.data.generationOutputCommitId === source.completionId)
    && (source.outputId === undefined || node.data.generationOutputDescriptor?.outputId === source.outputId)))
  return canvasPublished(await guarded(options, read), 'canvas', `${source.projectId}:${source.nodeId}`, read)
}

const IMAGE_EDIT_VIDEO_FORMATS = new Set(['png8', 'png16', 'jpeg', 'webp'])
async function imageSource(source: Extract<VideoEditCreativeSourceRequest, { kind: 'image_edit.document' }>, options: VideoEditCreativeSourceOptions): Promise<PublishedSource> {
  if (!/^image-edit-v3:.+/.test(source.documentRef) || source.sourceFingerprint !== undefined && !/^sha256:[a-f0-9]{64}$/.test(source.sourceFingerprint)) throw new Error('请选择已保存的图片编辑文档版本。')
  const documentRef = source.documentRef as ImageEditorV3DocumentRef
  const read = () => loadImageEditorV3Document({ requestId: createImageEditorV3RequestId('video-edit-image-result'), documentRef }, options.signal)
  const snapshot = await guarded(options, read)
  if (!snapshot || snapshot.documentRef !== documentRef || snapshot.revision !== source.revision || snapshot.document.id !== documentRef.slice('image-edit-v3:'.length) || source.sourceFingerprint !== undefined && snapshot.sourceFingerprint !== source.sourceFingerprint) conflict()
  const fingerprint = snapshot.sourceFingerprint
  const spec = createImageMarkV3RasterExportSpec(snapshot.document, '图片编辑结果')
  if (!IMAGE_EDIT_VIDEO_FORMATS.has(spec.format)) throw new Error('此图片编辑文档为高位深或 HDR，需要先在图片编辑中导出为 PNG 后再加入剪辑。')
  prepareImageEditorV3ExportRender(snapshot.document, spec.description)
  assertCurrent(options)
  const tiles = renderImageEditorV3ExportTilesWithGpu({ document: snapshot.document, resourceDescriptors: snapshot.resources, description: spec.description, tileSize: 512, signal: options.signal })
  const result = await guarded(options, () => materializeImageEditorV3StandaloneRaster({ documentRef, revision: snapshot.revision, sourceFingerprint: fingerprint, format: spec.format, description: spec.description, tiles, tileSize: 512 }, options.signal))
  if (result.publication !== 'standalone-image' || result.documentRef !== documentRef || result.revision !== source.revision || result.sourceFingerprint !== fingerprint || result.format !== spec.format || result.width !== spec.description.width || result.height !== spec.description.height) conflict()
  return { path: localPath(result.imagePath), mediaType: 'image', name: '图片编辑结果', librarySource: 'canvas', originId: documentRef,
    completion: [source.revision, fingerprint], dimensions: { width: result.width, height: result.height }, ownedFiles: result.createdFilePaths,
    async recheck() { const latest = await read(); if (!latest || latest.documentRef !== documentRef || latest.revision !== source.revision || latest.sourceFingerprint !== fingerprint) conflict() },
  }
}

async function audioSource(source: Extract<VideoEditCreativeSourceRequest, { kind: 'audio_edit.project' }>, options: VideoEditCreativeSourceOptions): Promise<PublishedSource> {
  const owner = await guarded(options, () => loadAudioEditProject(source.projectId))
  await guarded(options, () => flushAudioEditProject(source.projectId))
  const baseline = owner.document; const version = owner.version
  const assertSource = (): void => { if (getAudioEditProjectInstance(source.projectId) !== owner || owner.document !== baseline || owner.version !== version) conflict() }
  const platform = getPlatform()
  const path = await guarded(options, () => platform.system.dialog.save({ defaultPath: `${baseline.name.replace(/\.[^.]+$/, '')}-剪辑.wav`, filters: [{ name: 'WAV 与 SRT', extensions: ['wav'] }] }))
  assertSource()
  if (!path) throw new DOMException('已取消口播结果导出。', 'AbortError')
  if (!/\.wav$/i.test(path)) throw new Error('请使用新的 .wav 文件名保存剪后声音。')
  const target = localPath(path); const subtitleTarget = target.replace(/\.wav$/i, '.srt')
  for (const file of [target, subtitleTarget]) if (await guarded(options, () => platform.system.fs.exists(file))) throw new Error('请选择新的 WAV 和 SRT 文件名，避免覆盖已有交付。')
  assertSource()
  const requestId = crypto.randomUUID()
  const cancel = (): void => { void platform.audioEdit.cancelTask(requestId).catch(error => logger.warn('口播结果取消未确认', { event: 'video_edit.creative_source.audio.cancel_failed', error, requestId })) }
  options.signal?.addEventListener('abort', cancel, { once: true })
  let result: Awaited<ReturnType<typeof exportAudioEdit>>
  try {
    result = await guarded(options, () => exportAudioEdit({ projectId: source.projectId, targetPath: target, format: 'wav', subtitleTargetPath: subtitleTarget, requestId, ...(source.includeProcessing !== undefined ? { includeProcessing: source.includeProcessing } : {}) }))
  } finally { options.signal?.removeEventListener('abort', cancel) }
  assertSource()
  if (!sameVideoEditMediaPath(result.audioPath, target) || !result.subtitlePath || !sameVideoEditMediaPath(result.subtitlePath, subtitleTarget) || !Number.isSafeInteger(result.durationFrames) || result.durationFrames < 1) throw new Error('口播服务没有返回完整 WAV 与 SRT 交付，请检查原输出。')
  const readCaptions = async (): Promise<string> => {
    const bytes = await platform.system.fs.readFile(subtitleTarget, { maxBytes: SUBTITLE_BYTES })
    if (bytes.byteLength > SUBTITLE_BYTES) throw new Error('口播字幕超过 2MiB，请裁短后重新导出。')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  const captions = await guarded(options, readCaptions)
  return { path: target, mediaType: 'audio', name: `${baseline.name} · 剪后声音`, librarySource: 'imported', originId: source.projectId, captions,
    completion: [requestId, baseline.revision, baseline.source.identity, baseline.source.sampleRate, result.durationFrames, source.includeProcessing ?? baseline.vstEnabled],
    async recheck() { assertSource(); if (await readCaptions() !== captions) conflict(); assertSource() },
  }
}

async function cameraSource(source: Extract<VideoEditCreativeSourceRequest, { kind: 'camera_stage.render_task' }>, options: VideoEditCreativeSourceOptions): Promise<PublishedSource> {
  const identity = parseCameraStageRenderTaskRef({ kind: 'camera_stage.render_task', id: source.taskRef })
  const read = async (): Promise<CanvasOutput> => {
    const output = await readCanvasOutput(identity.canvasProjectId, nodes => {
      const matching = nodes.filter(node => node.data.generationOutputCommitId === `camera-stage-render:${identity.requestId}`)
      if (matching.length > 1) throw new Error('三维渲染存在多个持久结果，请在画布中确认原结果。')
      return matching[0]
    })
    const receipt = output.node.data.cameraStageRenderReceipt
    if (!receipt || receipt.requestId !== identity.requestId || receipt.canvasProjectId !== identity.canvasProjectId || receipt.nodeId !== identity.nodeId || receipt.cameraStageDocumentId !== identity.cameraStageDocumentId || receipt.outputKind !== identity.outputKind || receipt.resolutionPreset !== identity.resolutionPreset || (receipt.selectedTimeSec ?? null) !== (identity.selectedTimeSec ?? null) || output.mediaType !== identity.outputKind) throw new Error('三维渲染尚未正式完成，或持久结果与原任务不一致，请查询原任务。')
    return { ...output, name: identity.outputKind === 'image' ? '三维渲染图片' : '三维渲染视频' }
  }
  return canvasPublished(await guarded(options, read), 'camera-stage', identity.requestId, read)
}

/** Only completed producer files are collected; failed backfill never removes them. */
export async function prepareVideoEditCreativeResult(input: VideoEditCreativeSourceRequest, options: VideoEditCreativeSourceOptions): Promise<VideoEditCreativeResult> {
  assertCurrent(options)
  const source = videoEditCreativeSourceRequestSchema.parse(input)
  logger.info('开始准备固定创作结果', { event: 'video_edit.creative_source.prepare.start', context: { kind: source.kind } })
  let published: PublishedSource | undefined
  let referenced = false
  const started = performance.now(); const timings: Record<string, number> = {}
  const mark = (stage: string): void => { timings[stage] = Math.round(performance.now() - started) }
  try {
    published = await guarded(options, () => {
      switch (source.kind) {
        case 'generation.result': return generationSource(source, options)
        case 'canvas.node': return canvasSource(source, options)
        case 'image_edit.document': return imageSource(source, options)
        case 'audio_edit.project': return audioSource(source, options)
        case 'camera_stage.render_task': return cameraSource(source, options)
      }
    })
    const platform = getPlatform()
    mark('produced')
    const output = published
    const parent = await guarded(options, () => platform.system.paths.dirname(output.path))
    await guarded(options, () => platform.media.allowRoot(parent))
    const content = await guarded(options, () => platform.assetLibrary.inspectFileContent(output.path, output.mediaType))
    await guarded(options, output.recheck)
    const created = await guarded(options, () => addMediaReferenceToLibrary({ filePath: output.path, mediaType: output.mediaType, source: output.librarySource, displayName: output.name }))
    referenced = true; mark('collected')
    const asset = await guarded(options, () => assetApplicationService.inspect(created.id))
    if (asset.id !== created.id || asset.mediaType !== output.mediaType || !sameVideoEditMediaPath(asset.filePath, output.path) || !sameContent(content, contentOf(asset))) conflict()
    if (output.dimensions && (asset.width !== output.dimensions.width || asset.height !== output.dimensions.height)) throw new Error('原创作结果的实际尺寸与完成回执不一致，请检查原输出。')
    await guarded(options, output.recheck)
    const current = await guarded(options, () => assetApplicationService.inspect(asset.id))
    if (!sameVideoEditAssetContent(asset, current) || current.inspectionStatus !== 'ready') conflict()
    mark('verified')
    const digest = await guarded(options, () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([source.kind, output.originId, output.completion, content, output.captions]))))
    const version = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    const result: VideoEditCreativeResult = { asset: structuredClone(current), origin: { kind: source.kind, id: output.originId, version }, ...(output.captions !== undefined ? { captions: output.captions } : {}) }
    mark('total')
    logger.info('固定创作结果已准备', { event: 'video_edit.creative_source.prepare.completed', context: { kind: source.kind, assetId: asset.id, timings } })
    return result
  } catch (error) {
    logger.warn('创作结果准备未完成，正式输出保留', { event: 'video_edit.creative_source.prepare.failed', error, context: { kind: source.kind } })
    // A managed render nobody references yet would be an orphan; library-referenced files stay.
    if (!referenced && published?.ownedFiles?.length) await getPlatform().image.releaseManagedGenerationMedia([...published.ownedFiles]).catch(release => logger.warn('未引用的图片编辑渲染未能释放', { event: 'video_edit.creative_source.release_failed', error: release }))
    throw error
  }
}
