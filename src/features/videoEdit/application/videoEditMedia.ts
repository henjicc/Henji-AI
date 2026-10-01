import { ALL_FORMATS, Input, UrlSource } from 'mediabunny'
import { getPlatform } from '@/platform/runtime'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { editVideoProject, requireVideoEditInstance } from './videoEditService'
import type { VideoEditMedia, VideoEditDocument } from '@/core/videoEdit/document'
import { createLogger } from '@/core/logging'
import { VIDEO_EDIT_FRAME_RATES, videoEditFps } from '@/core/videoEdit/time'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { resolveVideoEditAssetReference, sameVideoEditAssetContent, videoEditAssetContentSnapshot } from './videoEditAssetReferences'
import { verifyVideoEditMediaContent } from '../videoEditMediaContent'

export type VideoEditImportSource = { path: string; assetId?: string } | { assetId: string; path?: string }
const logger = createLogger('features.videoEdit.media')
let metadataActive = 0
const metadataQueue: Array<() => void> = []
async function boundedMetadata<T>(operation: () => Promise<T>): Promise<T> {
  if (metadataActive >= 2) await new Promise<void>(resolve => metadataQueue.push(resolve))
  else metadataActive++
  try { return await operation() } finally { const next = metadataQueue.shift(); if (next) next(); else metadataActive-- }
}

export function sameVideoEditMediaPath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const path = value.replaceAll('\\', '/')
    return /^[a-z]:\//i.test(path) || path.startsWith('//') ? path.toLowerCase() : path
  }
  return normalize(left) === normalize(right)
}
export async function inspectVideoEditMedia(path: string, signal?: AbortSignal): Promise<VideoEditMedia> {
  return boundedMetadata(() => inspectMedia(path, signal))
}
async function inspectMedia(path: string, signal?: AbortSignal): Promise<VideoEditMedia> {
  signal?.throwIfAborted()
  const platform = getPlatform()
  if (!await platform.system.fs.exists(path)) throw new Error('源文件已移动或丢失，请重新定位素材。')
  await platform.media.allowRoot(await platform.system.paths.dirname(path))
  const base = { id: crypto.randomUUID(), path, name: path.split(/[\\/]/).at(-1) || '素材' }
  if (/\.(png|jpe?g|webp|bmp|avif)$/i.test(path)) {
    const response = await fetch(toFetchableMediaUrl(path), { signal }); if (!response.ok) throw new Error('无法读取图片。')
    const bitmap = await createImageBitmap(await response.blob())
    try { signal?.throwIfAborted(); return { ...base, kind: 'image', width: bitmap.width, height: bitmap.height, durationSeconds: 0 } } finally { bitmap.close() }
  }
  signal?.throwIfAborted()
  const input = new Input({ source: new UrlSource(toFetchableMediaUrl(path), { maxCacheSize: 8 * 1024 * 1024, getRetryDelay: () => null }), formats: ALL_FORMATS })
  const cancel = (): void => input.dispose()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    if (!video && !audio) throw new Error('文件没有可用的音视频轨道。')
    if (video && !await video.canDecode()) throw new Error('当前设备无法解码此视频，请先转为 H.264 SDR 视频。')
    if (audio && !await audio.canDecode()) throw new Error('当前设备无法解码此音轨。')
    const metrics = video ? await video.computeFrameRateMetrics({ targetPacketCount: 256 }) : undefined
    const rate = metrics && metrics.probedPacketCount >= 2 && Number.isFinite(metrics.bestGuessFrameRate) ? VIDEO_EDIT_FRAME_RATES.find(rate => Math.abs(videoEditFps(rate) / metrics.bestGuessFrameRate - 1) < 0.001) : undefined
    const durationSeconds = await input.computeDuration()
    signal?.throwIfAborted()
    return { ...base, kind: video ? 'video' : 'audio', hasAudio: Boolean(audio), width: video?.displayWidth ?? 0, height: video?.displayHeight ?? 0, durationSeconds, ...(video ? { ...(rate ? { frameRate: rate } : {}), frameRateMode: metrics && metrics.probedPacketCount >= 2 ? metrics.frameRateIsConstant ? 'sampled-constant' as const : 'variable' as const : 'unknown' as const } : {}) }
  } finally { signal?.removeEventListener('abort', cancel); input.dispose() }
}
function validateAssetMedia(media: VideoEditMedia, asset: AssetRecord): void {
  if (media.assetId && media.assetId !== asset.id || media.assetContent && (media.assetContent.sizeBytes !== asset.sizeBytes || media.assetContent.fileModifiedAt !== asset.fileModifiedAt || media.assetContent.contentIdentity && media.assetContent.contentIdentity !== asset.contentIdentity)) throw new Error('此工程引用的素材内容已改变，请先重新定位源素材。')
  if (media.kind !== asset.mediaType || asset.width !== null && asset.width !== media.width || asset.height !== null && asset.height !== media.height) throw new Error('素材库与工程的源文件信息不一致，请重新定位源素材。')
}
export async function importVideoEditSources(projectId: string, sources: VideoEditImportSource[], binId?: string, signal?: AbortSignal, afterImport?: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument | Promise<VideoEditDocument>): Promise<string[]> {
  const owner = requireVideoEditInstance(projectId)
  logger.info('导入剪辑素材开始', { event: 'video_edit.media.import.start', context: { projectId, count: sources.length } })
  try {
  if (binId && !owner.document.bins.some(bin => bin.id === binId)) throw new Error('目标素材箱不存在。')
  if (sources.some(source => !source.assetId && !source.path)) throw new Error('请引用素材库素材或本地源文件。')
  const unique = sources.filter((source, index) => sources.findIndex(other => source.assetId ? other.assetId === source.assetId : !other.assetId && typeof source.path === 'string' && typeof other.path === 'string' && sameVideoEditMediaPath(other.path, source.path)) === index)
  if (unique.length > 200) throw new Error('工程最多引用 200 个源文件，请分批导入。')
  const results = await Promise.allSettled(unique.map(async input => {
    signal?.throwIfAborted()
    const fixed = !input.assetId && input.path ? owner.document.media.find(media => sameVideoEditMediaPath(media.path, input.path!) && media.assetContent?.contentIdentity) : undefined
    if (fixed) await boundedMetadata(() => verifyVideoEditMediaContent(fixed, signal))
    const asset = input.assetId ? await boundedMetadata(() => resolveVideoEditAssetReference(input.assetId!)) : undefined
    const path = asset?.filePath ?? input.path
    if (!path) throw new Error('请引用素材库素材或本地源文件。')
    return { path, ...(asset ? { asset } : {}), ...(fixed ? { fixed } : {}) }
  }))
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  const resolved: Array<{ path: string; asset?: AssetRecord; fixed?: VideoEditMedia }> = []
  for (const result of results) if (result.status === 'fulfilled') {
    const previous = resolved.find(source => sameVideoEditMediaPath(source.path, result.value.path))
    if (previous?.asset && result.value.asset && previous.asset.id !== result.value.asset.id) throw new Error('同一源文件包含冲突的素材库引用，请重新引用。')
    if (!previous) resolved.push(result.value)
    else if (result.value.asset) previous.asset = result.value.asset
  }
  signal?.throwIfAborted()
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原工程已关闭，导入不会写入重新打开的工程。')
  const metadata = await Promise.allSettled(resolved.map(async source => {
    signal?.throwIfAborted()
    const existing = owner.document.media.find(media => sameVideoEditMediaPath(media.path, source.path))
    if (existing && source.asset) validateAssetMedia(existing, source.asset)
    const media = existing ?? (source.asset?.mediaType === 'image' && source.asset.width && source.asset.height && /\.(png|jpe?g|webp|bmp|avif)$/i.test(source.path)
      ? { id: crypto.randomUUID(), path: source.path, name: source.asset.displayName, kind: 'image' as const, width: source.asset.width, height: source.asset.height, durationSeconds: 0 }
      : await inspectVideoEditMedia(source.path, signal))
    if (existing && source.asset && !existing.assetContent?.contentIdentity && existing.kind !== 'image') {
      const current = await inspectVideoEditMedia(source.path, signal)
      if (current.durationSeconds !== existing.durationSeconds || Boolean(current.hasAudio) !== Boolean(existing.hasAudio) || JSON.stringify(current.frameRate) !== JSON.stringify(existing.frameRate) || current.frameRateMode !== existing.frameRateMode) throw new Error('旧引用的时长、帧率或音轨尚未核验，请先重新定位源素材。')
    }
    if (source.asset) validateAssetMedia(media, source.asset)
    return { source, media }
  }))
  const metadataFailure = metadata.find(result => result.status === 'rejected')
  if (metadataFailure?.status === 'rejected') throw metadataFailure.reason
  const inspected = metadata.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  signal?.throwIfAborted()
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原工程已关闭，导入不会写入重新打开的工程。')
  const ids: string[] = []
  const baseline = owner.document
  const document = structuredClone(baseline)
    if (binId && !document.bins.some(bin => bin.id === binId)) throw new Error('导入期间目标素材箱已移除，请重新选择导入位置。')
    for (const { source, media: inspectedMedia } of inspected) {
      let media = document.media.find(media => sameVideoEditMediaPath(media.path, source.path))
      if (!media) { media = { ...inspectedMedia }; document.media.push(media) }
      if (source.asset) {
        validateAssetMedia(media, source.asset)
        const content = videoEditAssetContentSnapshot(source.asset)
        if (!media.assetContent?.contentIdentity || media.path !== source.path) media.sourceRevision = crypto.randomUUID()
        media.path = source.path
        media.assetId = source.asset.id; media.assetContent = content
      }
      let item = document.items.find(item => item.mediaId === media!.id && item.binId === binId)
      if (!item) { item = { id: crypto.randomUUID(), name: media.name, kind: media.kind, mediaId: media.id, ...(binId ? { binId } : {}) }; document.items.push(item) }
      ids.push(item.id)
    }
  const next = afterImport ? await afterImport(document, ids) : document
  await Promise.all(inspected.map(({ source }) => source.asset ? boundedMetadata(async () => {
    signal?.throwIfAborted()
    if (!sameVideoEditAssetContent(source.asset!, await resolveVideoEditAssetReference(source.asset!.id))) throw new Error('素材库源文件在导入期间已改变，请重新引用该素材。')
  }) : source.fixed ? boundedMetadata(() => verifyVideoEditMediaContent(source.fixed!, signal)) : undefined))
  signal?.throwIfAborted()
  if (requireVideoEditInstance(projectId) !== owner || owner.document !== baseline) throw new Error('导入检查期间原工程已改变，请重新导入。')
  editVideoProject(projectId, () => next)
  logger.info('导入剪辑素材完成', { event: 'video_edit.media.import.completed', context: { projectId, count: ids.length } })
  return ids
  } catch (error) {
    logger.debug('导入剪辑素材未完成', { event: 'video_edit.media.import.failed', error, context: { projectId } }); throw error
  }
}
export async function importVideoEditPaths(projectId: string, paths: string[], binId?: string): Promise<string[]> {
  return importVideoEditSources(projectId, paths.map(path => ({ path })), binId)
}
export async function chooseVideoEditMedia(projectId: string, binId?: string): Promise<string[]> {
  const owner = requireVideoEditInstance(projectId)
  const paths = await getPlatform().system.dialog.open({ multiple: true, filters: [{ name: '视频、图片与音频', extensions: ['mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'webp', 'avif'] }] })
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原工程已关闭，请重新导入。')
  return paths ? importVideoEditPaths(projectId, Array.isArray(paths) ? paths : [paths], binId) : []
}
export async function relinkVideoEditMedia(projectId: string, mediaId: string): Promise<void> {
  const owner = requireVideoEditInstance(projectId)
  const previous = owner.document.media.find(media => media.id === mediaId)
  if (!previous) throw new Error('源素材不存在。')
  const path = await getPlatform().system.dialog.open()
  if (!path || Array.isArray(path)) return
  const linked = sameVideoEditMediaPath(previous.path, path) && previous.assetId
  const content = linked ? await getPlatform().assetLibrary.inspectFileContent(path, previous.kind) : undefined
  const media = await inspectVideoEditMedia(path)
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原工程已关闭，请重新定位素材。')
  if (media.kind !== previous.kind) throw new Error('重新定位的文件类型必须与原素材一致。')
  if (content) {
    const current = await getPlatform().assetLibrary.inspectFileContent(path, media.kind)
    if (current.contentIdentity !== content.contentIdentity || current.sizeBytes !== content.sizeBytes || current.fileModifiedAt !== content.fileModifiedAt) throw new Error('源文件在重新定位期间已改变，请重新选择。')
  }
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原工程已关闭，请重新定位素材。')
  if (owner.document.media.find(item => item.id === mediaId) !== previous) throw new Error('源素材在重新定位期间已改变，请重新选择。')
  editVideoProject(projectId, document => ({ ...document, media: document.media.map(item => item.id === mediaId ? { ...media, id: mediaId, sourceRevision: media.id, ...(content ? { assetId: previous.assetId, assetContent: content } : {}) } : item) }))
}
