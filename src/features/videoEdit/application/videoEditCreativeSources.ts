import { createLogger } from '@/core/logging'
import { videoEditCreativeOrigin, videoEditCreativeSourceRequestSchema, type VideoEditCreativeSource, type VideoEditCreativeSourceRequest } from '@/core/videoEdit/creativeResult'
import type { DocumentMeta } from '@/core/documents/types'
import { readGenerationResultMedia } from '@/features/generation/application/generationResultSource'
import { readPersistedCanvasProjectSnapshot } from '@/features/canvas/application/canvasQueryService'
import { getGraphNodeMediaOutputs } from '@/features/canvas/application/graphOutputResolver'
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { addMediaReferenceToLibrary, resolveLocalAssetPath } from '@/features/assets/services/assetCollectionService'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import { exportAudioEdit } from '@/features/audioEdit/application/audioEditApplicationService'
import { flushAudioEditProject, getAudioEditProjectInstance, loadAudioEditProject } from '@/features/audioEdit/application/audioEditProjectInstances'
import { loadImageEditorV3Document, createImageEditorV3RequestId } from '@/commands/imageEditorV3'
import { materializeImageEditorV3StandaloneRaster } from '@/commands/imageEditorV3Export'
import { createImageMarkV3RasterExportSpec } from '@/features/imageMark/standalone/imageMarkV3RasterExport'
import { prepareImageEditorV3ExportRender, renderImageEditorV3ExportTilesWithGpu } from '@/features/imageEdit/v3/export'
import { ensureImageDocumentOpenInBackground } from '@/features/imageEdit/documents/imageDocumentRuntime'
import { getPlatform } from '@/platform/runtime'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import type { AssetFileContent, AssetRecord, AssetSource } from '@/platform/contracts/assetLibrary'
import type { ImageEditorV3DocumentRef } from '@/platform/contracts/imageEditorV3'
import { sameVideoEditMediaPath } from './videoEditMedia'
import { sameVideoEditAssetContent } from './videoEditAssetReferences'
import type { VideoEditCreativeResult } from './videoEditResultTarget'

/*
 * 把其他工具的结果准备成剪辑可以引用的媒体（4.1 起来源统一为“文档 + 部位”与“生成记录 + 序号”两种）：
 * - 生成记录：取第几个结果的本地文件。
 * - 文档：按跨文档引用找到文档（先位置后 ID），再按它的类型取成品——画布节点的正式完成结果、
 *   图片文档的受管渲染、口播导出的剪后声音与字幕。其他类型（镜头参考、剪辑）没有直接的成品，如实拒绝。
 * 第一次读取固定完成身份，收录前后各复查一次，期间原结果改变就拒绝（已完成的文件保留在生产方）。
 */

export type { VideoEditCreativeSourceRequest } from '@/core/videoEdit/creativeResult'
export interface VideoEditCreativeSourceOptions {
  signal?: AbortSignal
  assertTarget: () => void
  /** 把完成的结果文件放进目标剪辑所在项目（复制进“生成结果”），返回之后引用的位置；省略时引用原文件。 */
  place?: (path: string) => Promise<string>
  /** 需要新写出文件的来源（口播的剪后声音）写到这里；省略时请用户选择保存位置。 */
  outputFolder?: () => Promise<string | null>
}
type MediaKind = 'image' | 'video' | 'audio'
interface PublishedSource {
  path: string
  mediaType: MediaKind
  name: string
  librarySource: AssetSource
  /** 写进片段的来源（位置按找到的文档更新，图片文档带上渲染所用的版本）。 */
  origin: VideoEditCreativeSource
  captions?: string
  dimensions?: { width: number; height: number }
  /** Managed files created by this preparation; released only if no library record references them. */
  ownedFiles?: readonly string[]
  recheck(): Promise<void>
}

/** 来源文档找不到（被删除、移走且索引里没有）：“回到来源”据此提示重新定位。 */
export class VideoEditSourceMissingError extends Error {
  constructor() {
    super('找不到这个片段的来源文档，它可能已被删除或移到了别处。')
    this.name = 'VideoEditSourceMissingError'
  }
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
function documentOrigin(meta: DocumentMeta, extra: { part?: string; revision?: number } = {}): VideoEditCreativeSource {
  return { type: 'document', docRef: { docId: meta.id, path: meta.path }, ...(extra.part !== undefined ? { part: extra.part } : {}), ...(extra.revision !== undefined ? { revision: extra.revision } : {}) }
}

async function generationSource(source: Extract<VideoEditCreativeSourceRequest, { type: 'generation' }>, options: VideoEditCreativeSourceOptions): Promise<PublishedSource> {
  const read = () => readGenerationResultMedia(source.recordId, undefined, { outputIndex: source.outputIndex, localOnly: true })
  const result = await guarded(options, read)
  if (!result) throw new Error('原生成结果不存在，请从历史记录重新选择。')
  const path = localPath(result.source)
  return { path, mediaType: result.mediaType, name: result.name, librarySource: 'generated', origin: videoEditCreativeOrigin(source),
    async recheck() { const latest = await read(); if (!latest || latest.mediaType !== result.mediaType || !sameVideoEditMediaPath(localPath(latest.source), path)) conflict() },
  }
}

interface CanvasOutput { path: string; mediaType: MediaKind; name: string; completion: string; node: CanvasNode }
/** Persisted canvas completions are the durable truth; live task state is released after acknowledgement. */
async function readCanvasOutput(canvasId: string, nodeId: string): Promise<CanvasOutput> {
  const project = await readPersistedCanvasProjectSnapshot(canvasId)
  const node = project.nodes.find(candidate => candidate.id === nodeId)
  const descriptor = node?.data.generationOutputDescriptor
  if (!node || node.data.isGenerating || node.data.generationError || node.data.generationCancelled || !node.data.generationOutputCommitId || descriptor?.version !== 1) throw new Error('请选择原画布中已保存的正式完成结果。')
  const outputs = getGraphNodeMediaOutputs(node, new Map(project.nodes.map(node => [node.id, node])))
  if (outputs.length !== 1 || !['image', 'video', 'audio'].includes(outputs[0].kind) || outputs[0].kind !== descriptor.mediaType) throw new Error('此结果没有唯一已发布的图片、视频或音频，请选择具体完成项。')
  return { path: localPath(outputs[0].url), mediaType: outputs[0].kind as MediaKind, name: node.data.displayName || '画布结果', completion: JSON.stringify([node.data.generationOutputCommitId, descriptor]), node }
}

async function canvasSource(meta: DocumentMeta, part: string | undefined, options: VideoEditCreativeSourceOptions): Promise<PublishedSource> {
  if (!part) throw new Error('请选择画布里的一个结果节点放进剪辑。')
  const read = () => readCanvasOutput(meta.id, part)
  const output = await guarded(options, read)
  // 三维渲染结果也是画布节点：沿用它在资产库里的来源标记
  const librarySource: AssetSource = output.node.data.cameraStageRenderReceipt ? 'camera-stage' : 'canvas'
  return { path: output.path, mediaType: output.mediaType, name: output.name, librarySource, origin: documentOrigin(meta, { part }),
    async recheck() { const latest = await read(); if (latest.mediaType !== output.mediaType || latest.completion !== output.completion || !sameVideoEditMediaPath(latest.path, output.path)) conflict() },
  }
}

const IMAGE_EDIT_VIDEO_FORMATS = new Set(['png8', 'png16', 'jpeg', 'webp'])
/** 图片文档按工作副本的指定版本（省略时当前版本）受管渲染成一张图片。 */
async function imageSource(meta: DocumentMeta, revision: number | undefined, options: VideoEditCreativeSourceOptions): Promise<PublishedSource> {
  // 没打开过的图片文档先在后台解包到工作副本（已打开的直接用，未写回的修改照样算数）
  await guarded(options, () => ensureImageDocumentOpenInBackground(meta.id))
  const documentRef = `image-edit-v3:${meta.id}` as ImageEditorV3DocumentRef
  const read = () => loadImageEditorV3Document({ requestId: createImageEditorV3RequestId('video-edit-image-result'), documentRef }, options.signal)
  const snapshot = await guarded(options, read)
  if (!snapshot || snapshot.documentRef !== documentRef || revision !== undefined && snapshot.revision !== revision || snapshot.document.id !== meta.id) conflict()
  const fingerprint = snapshot.sourceFingerprint
  const spec = createImageMarkV3RasterExportSpec(snapshot.document, meta.name)
  if (!IMAGE_EDIT_VIDEO_FORMATS.has(spec.format)) throw new Error('此图片文档为高位深或 HDR，需要先在图片编辑中导出为 PNG 后再加入剪辑。')
  prepareImageEditorV3ExportRender(snapshot.document, spec.description)
  assertCurrent(options)
  const tiles = renderImageEditorV3ExportTilesWithGpu({ document: snapshot.document, resourceDescriptors: snapshot.resources, description: spec.description, tileSize: 512, signal: options.signal })
  const result = await guarded(options, () => materializeImageEditorV3StandaloneRaster({ documentRef, revision: snapshot.revision, sourceFingerprint: fingerprint, format: spec.format, description: spec.description, tiles, tileSize: 512 }, options.signal))
  if (result.publication !== 'standalone-image' || result.documentRef !== documentRef || result.revision !== snapshot.revision || result.sourceFingerprint !== fingerprint || result.format !== spec.format || result.width !== spec.description.width || result.height !== spec.description.height) conflict()
  return { path: localPath(result.imagePath), mediaType: 'image', name: meta.name, librarySource: 'canvas', origin: documentOrigin(meta, { revision: snapshot.revision }),
    dimensions: { width: result.width, height: result.height }, ownedFiles: result.createdFilePaths,
    async recheck() { const latest = await read(); if (!latest || latest.documentRef !== documentRef || latest.revision !== snapshot.revision || latest.sourceFingerprint !== fingerprint) conflict() },
  }
}

/** 给剪后声音挑一个不重名的位置：先用指定文件夹（项目“生成结果”），没有时请用户选。 */
async function audioTarget(name: string, options: VideoEditCreativeSourceOptions): Promise<string> {
  const platform = getPlatform()
  const stem = `${name.replace(/\.[^.]+$/, '')}-剪辑`
  const folder = options.outputFolder ? await guarded(options, options.outputFolder) : null
  if (folder) {
    for (let index = 1; index <= 999; index += 1) {
      const candidate = await platform.system.paths.join(folder, `${stem}${index === 1 ? '' : ` (${index})`}.wav`)
      const subtitle = candidate.replace(/\.wav$/i, '.srt')
      if (!await platform.system.fs.exists(candidate) && !await platform.system.fs.exists(subtitle)) return candidate
    }
    throw new Error('项目“生成结果”里同名文件过多，请先整理后重试。')
  }
  const path = await guarded(options, () => platform.system.dialog.save({ defaultPath: `${stem}.wav`, filters: [{ name: 'WAV 与 SRT', extensions: ['wav'] }] }))
  if (!path) throw new DOMException('已取消口播结果导出。', 'AbortError')
  if (!/\.wav$/i.test(path)) throw new Error('请使用新的 .wav 文件名保存剪后声音。')
  for (const file of [path, path.replace(/\.wav$/i, '.srt')]) if (await guarded(options, () => platform.system.fs.exists(file))) throw new Error('请选择新的 WAV 和 SRT 文件名，避免覆盖已有交付。')
  return path
}

async function audioSource(meta: DocumentMeta, includeProcessing: boolean | undefined, options: VideoEditCreativeSourceOptions): Promise<PublishedSource> {
  const projectId = meta.id
  const owner = await guarded(options, () => loadAudioEditProject(projectId, meta.path))
  await guarded(options, () => flushAudioEditProject(projectId))
  const baseline = owner.document; const version = owner.version
  const assertSource = (): void => { if (getAudioEditProjectInstance(projectId) !== owner || owner.document !== baseline || owner.version !== version) conflict() }
  const platform = getPlatform()
  const target = localPath(await audioTarget(baseline.name, options))
  const subtitleTarget = target.replace(/\.wav$/i, '.srt')
  assertSource()
  const requestId = crypto.randomUUID()
  const cancel = (): void => { void platform.audioEdit.cancelTask(requestId).catch(error => logger.warn('口播结果取消未确认', { event: 'video_edit.creative_source.audio.cancel_failed', error, requestId })) }
  options.signal?.addEventListener('abort', cancel, { once: true })
  let result: Awaited<ReturnType<typeof exportAudioEdit>>
  try {
    result = await guarded(options, () => exportAudioEdit({ projectId, targetPath: target, format: 'wav', subtitleTargetPath: subtitleTarget, requestId, ...(includeProcessing !== undefined ? { includeProcessing } : {}) }))
  } finally { options.signal?.removeEventListener('abort', cancel) }
  assertSource()
  if (!sameVideoEditMediaPath(result.audioPath, target) || !result.subtitlePath || !sameVideoEditMediaPath(result.subtitlePath, subtitleTarget) || !Number.isSafeInteger(result.durationFrames) || result.durationFrames < 1) throw new Error('口播服务没有返回完整 WAV 与 SRT 交付，请检查原输出。')
  const readCaptions = async (): Promise<string> => {
    const bytes = await platform.system.fs.readFile(subtitleTarget, { maxBytes: SUBTITLE_BYTES })
    if (bytes.byteLength > SUBTITLE_BYTES) throw new Error('口播字幕超过 2MiB，请裁短后重新导出。')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  const captions = await guarded(options, readCaptions)
  return { path: target, mediaType: 'audio', name: `${baseline.name} · 剪后声音`, librarySource: 'imported', origin: documentOrigin(meta, { revision: baseline.revision }), captions,
    async recheck() { assertSource(); if (await readCaptions() !== captions) conflict(); assertSource() },
  }
}

/** 按跨文档引用找到来源文档（先位置后 ID）；找不到时报 VideoEditSourceMissingError。 */
export async function resolveVideoEditSourceDocument(docRef: { docId: string; path: string }): Promise<DocumentMeta> {
  const resolved = await getDocumentOperations().resolveDocumentLink(docRef)
  if (resolved.status !== 'found') throw new VideoEditSourceMissingError()
  return resolved.meta
}

async function documentSource(source: Extract<VideoEditCreativeSourceRequest, { type: 'document' }>, options: VideoEditCreativeSourceOptions): Promise<PublishedSource> {
  const meta = await guarded(options, () => resolveVideoEditSourceDocument(source.docRef))
  switch (meta.kind) {
    case 'canvas': return await canvasSource(meta, source.part, options)
    case 'image_document': return await imageSource(meta, source.revision, options)
    case 'audio_edit': return await audioSource(meta, source.includeProcessing, options)
    case 'camera_stage': throw new Error('镜头参考本身不是成片：请先在画布里渲染，再把渲染结果加入剪辑。')
    case 'video_edit': throw new Error('剪辑不能作为另一个剪辑的片段来源。')
  }
}

/** Only completed producer files are collected; failed backfill never removes them. */
export async function prepareVideoEditCreativeResult(input: VideoEditCreativeSourceRequest, options: VideoEditCreativeSourceOptions): Promise<VideoEditCreativeResult> {
  assertCurrent(options)
  const source = videoEditCreativeSourceRequestSchema.parse(input)
  logger.info('开始准备固定创作结果', { event: 'video_edit.creative_source.prepare.start', context: { type: source.type } })
  let published: PublishedSource | undefined
  let referenced = false
  const started = performance.now(); const timings: Record<string, number> = {}
  const mark = (stage: string): void => { timings[stage] = Math.round(performance.now() - started) }
  try {
    published = await guarded(options, () => source.type === 'generation' ? generationSource(source, options) : documentSource(source, options))
    const platform = getPlatform()
    mark('produced')
    const output = published
    await guarded(options, output.recheck)
    // 复制进目标项目的“生成结果”后引用副本：项目文件夹拷走也带着结果（重要记录 006）
    const filePath = options.place ? await guarded(options, () => options.place!(output.path)) : output.path
    if (!sameVideoEditMediaPath(filePath, output.path)) mark('placed')
    const parent = await guarded(options, () => platform.system.paths.dirname(filePath))
    await guarded(options, () => platform.media.allowRoot(parent))
    const content = await guarded(options, () => platform.assetLibrary.inspectFileContent(filePath, output.mediaType))
    await guarded(options, output.recheck)
    const created = await guarded(options, () => addMediaReferenceToLibrary({ filePath, mediaType: output.mediaType, source: output.librarySource, displayName: output.name }))
    referenced = true; mark('collected')
    const asset = await guarded(options, () => assetApplicationService.inspect(created.id))
    if (asset.id !== created.id || asset.mediaType !== output.mediaType || !sameVideoEditMediaPath(asset.filePath, filePath) || !sameContent(content, contentOf(asset))) {
      // 诊断：哪一项对不上（路径与内容身份只进日志）
      logger.warn('收录后的资产与结果文件不一致', { event: 'video_edit.creative_source.asset_mismatch', context: { type: source.type, sameId: asset.id === created.id, sameType: asset.mediaType === output.mediaType, samePath: sameVideoEditMediaPath(asset.filePath, filePath), assetPath: asset.filePath, filePath, content, asset: { sizeBytes: asset.sizeBytes, fileModifiedAt: asset.fileModifiedAt, contentIdentity: asset.contentIdentity, inspectionStatus: asset.inspectionStatus } } })
      conflict()
    }
    if (output.dimensions && (asset.width !== output.dimensions.width || asset.height !== output.dimensions.height)) throw new Error('原创作结果的实际尺寸与完成回执不一致，请检查原输出。')
    await guarded(options, output.recheck)
    const current = await guarded(options, () => assetApplicationService.inspect(asset.id))
    if (!sameVideoEditAssetContent(asset, current) || current.inspectionStatus !== 'ready') conflict()
    mark('total')
    const result: VideoEditCreativeResult = { asset: structuredClone(current), origin: output.origin, ...(output.captions !== undefined ? { captions: output.captions } : {}) }
    logger.info('固定创作结果已准备', { event: 'video_edit.creative_source.prepare.completed', context: { type: source.type, assetId: asset.id, timings } })
    return result
  } catch (error) {
    logger.warn('创作结果准备未完成，正式输出保留', { event: 'video_edit.creative_source.prepare.failed', error, context: { type: source.type } })
    // A managed render nobody references yet would be an orphan; library-referenced files stay.
    if (!referenced && published?.ownedFiles?.length) await getPlatform().image.releaseManagedGenerationMedia([...published.ownedFiles]).catch(release => logger.warn('未引用的图片编辑渲染未能释放', { event: 'video_edit.creative_source.release_failed', error: release }))
    throw error
  }
}
