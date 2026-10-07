import { reportVideoEditImport, withVideoEditImportTask, type VideoEditImportTask, type VideoEditImportProgress } from './videoEditImportTask'
import { autoCreateVideoEditProxies } from './videoEditProxy'
import { ALL_FORMATS, Input, UrlSource } from 'mediabunny'
import { getPlatform } from '@/platform/runtime'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { editVideoProject, requireVideoEditInstance } from './videoEditService'
import type { VideoEditMedia, VideoEditDocument } from '@/core/videoEdit/document'
import { createLogger } from '@/core/logging'
import { matchVideoEditFrameRate, resolveVideoEditMediaInspection, videoEditNativeMediaProbe, type VideoEditBrowserInspection, type VideoEditNativeProbeOutcome } from './videoEditMediaProbe'
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

export function videoEditMediaPathKey(value: string): string {
  const path = value.replaceAll('\\', '/')
  return /^[a-z]:\//i.test(path) || path.startsWith('//') ? path.toLowerCase() : path
}
export function sameVideoEditMediaPath(left: string, right: string): boolean { return videoEditMediaPathKey(left) === videoEditMediaPathKey(right) }
/** Only one page of promises enters the existing two-decoder queue at a time. */
async function settleImportBatches<T, R>(values: readonly T[], operation: (value: T) => Promise<R>, signal?: AbortSignal, onCompleted?: (completed: number) => void): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = []; let completed = 0
  for (let offset = 0; offset < values.length; offset += 32) {
    signal?.throwIfAborted()
    results.push(...await Promise.allSettled(values.slice(offset, offset + 32).map(async value => {
      try { signal?.throwIfAborted(); return await operation(value) }
      finally { if (!signal?.aborted) onCompleted?.(++completed) }
    })))
  }
  signal?.throwIfAborted(); return results
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
  // Native first for the decoding decision; the browser inspection runs alongside as fallback and metadata source.
  // A native fault never blocks the fallback: it counts as the service being unavailable.
  const forced = await videoEditNativeMediaProbe.forcedBackend()
  const nativeProbe = forced === 'browser' ? Promise.resolve<VideoEditNativeProbeOutcome>({ status: 'unavailable' }) : videoEditNativeMediaProbe.probe(path, signal).catch((error: unknown): VideoEditNativeProbeOutcome => {
    signal?.throwIfAborted()
    logger.warn('原生素材探测异常，改用后备探测', { event: 'video_edit.media.inspect.native_failed', error })
    return { status: 'unavailable' }
  })
  const [native, browser] = await Promise.all([nativeProbe, inspectBrowserMedia(path, signal)])
  signal?.throwIfAborted()
  const browserDecodes = browser.status === 'read' && Boolean(browser.media)
  let resolved: ReturnType<typeof resolveVideoEditMediaInspection>
  try { resolved = resolveVideoEditMediaInspection(path, native, browser, forced) } catch (error) {
    logger.info('剪辑素材无法解码', { event: 'video_edit.media.inspect.undecodable', error, context: { native: native.status, browserDecodes, ...(forced ? { forced } : {}) } })
    throw error
  }
  const { backend, nativeDecodes, fields } = resolved
  // `backend` is the decoder that plays the file; `nativeDecodes` only reports the native probe's finding.
  logger.info('剪辑素材探测完成', { event: 'video_edit.media.inspect.completed', context: { kind: fields.kind, backend, native: native.status, nativeDecodes, browserDecodes, ...(forced ? { forced } : {}) } })
  return { ...base, ...fields }
}
/** Chromium's view of the file; an unreadable or undecodable file is a result, not an error. */
async function inspectBrowserMedia(path: string, signal?: AbortSignal): Promise<VideoEditBrowserInspection> {
  const input = new Input({ source: new UrlSource(toFetchableMediaUrl(path), { maxCacheSize: 8 * 1024 * 1024, getRetryDelay: () => null }), formats: ALL_FORMATS })
  const cancel = (): void => input.dispose()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    const audioTracks = audio ? await input.getAudioTracks() : []
    const streams = { ...(video ? { video: { codec: video.codec, decodable: await video.canDecode() } } : {}), ...(audio ? { audio: { codec: audio.codec, decodable: await audio.canDecode() } } : {}) }
    if ((!video && !audio) || streams.video?.decodable === false || streams.audio?.decodable === false) return { status: 'read', ...streams }
    const metrics = video ? await video.computeFrameRateMetrics({ targetPacketCount: 256 }) : undefined
    const rate = metrics && metrics.probedPacketCount >= 2 ? matchVideoEditFrameRate(metrics.bestGuessFrameRate) : undefined
    const durationSeconds = await input.computeDuration()
    signal?.throwIfAborted()
    // Every sound track in file order (task 2.6); the browser decoder opens them by the same number.
    const audioStreams = audioTracks.every(track => Number.isInteger(track.numberOfChannels) && track.numberOfChannels >= 1 && track.numberOfChannels <= 64) && audioTracks.length ? { audioStreams: audioTracks.map(track => ({ channels: track.numberOfChannels, ...(Number.isInteger(track.sampleRate) && track.sampleRate > 0 && track.sampleRate <= 768_000 ? { sampleRate: track.sampleRate } : {}) })) } : {}
    return { status: 'read', ...streams, media: { kind: video ? 'video' : 'audio', hasAudio: Boolean(audio), width: video?.displayWidth ?? 0, height: video?.displayHeight ?? 0, durationSeconds, ...(video ? { ...(rate ? { frameRate: rate } : {}), frameRateMode: metrics && metrics.probedPacketCount >= 2 ? metrics.frameRateIsConstant ? 'sampled-constant' as const : 'variable' as const : 'unknown' as const } : {}), ...audioStreams } }
  } catch (error) {
    signal?.throwIfAborted()
    return { status: 'unreadable', error }
  } finally { signal?.removeEventListener('abort', cancel); input.dispose() }
}
function validateAssetMedia(media: VideoEditMedia, asset: AssetRecord): void {
  if (media.assetId && media.assetId !== asset.id || media.assetContent && (media.assetContent.sizeBytes !== asset.sizeBytes || media.assetContent.fileModifiedAt !== asset.fileModifiedAt || media.assetContent.contentIdentity && media.assetContent.contentIdentity !== asset.contentIdentity)) throw new Error('此剪辑引用的素材内容已改变，请先重新定位源素材。')
  if (media.kind !== asset.mediaType || asset.width !== null && asset.width !== media.width || asset.height !== null && asset.height !== media.height) throw new Error('素材库与剪辑的源文件信息不一致，请重新定位源素材。')
}
/** `skipUnreadable`：本地文件读不出或解码不了时跳过并报告（文件夹导入），而不是让整批导入失败。素材库引用始终严格。 */
export interface VideoEditImportOptions { skipUnreadable?: (path: string, reason: unknown) => void; task?: VideoEditImportTask; onProgress?: (progress: VideoEditImportProgress) => void }
export async function importVideoEditSources(projectId: string, sources: VideoEditImportSource[], binId?: string, signal?: AbortSignal, afterImport?: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument | Promise<VideoEditDocument>, preserveProgramAnchors: readonly string[] = [], options: VideoEditImportOptions = {}): Promise<string[]> {
  if (!options.task) return withVideoEditImportTask(projectId, signal, task => importVideoEditSources(projectId, sources, binId, task.controller.signal, afterImport, preserveProgramAnchors, { ...options, task }))
  const owner = requireVideoEditInstance(projectId)
  const existingByPath = new Map(owner.document.media.map(media => [videoEditMediaPathKey(media.path), media]))
  logger.info('导入剪辑素材开始', { event: 'video_edit.media.import.start', context: { projectId, count: sources.length } })
  try {
  if (binId && !owner.document.bins.some(bin => bin.id === binId)) throw new Error('目标素材箱不存在。')
  if (sources.some(source => !source.assetId && !source.path)) throw new Error('请引用素材库素材或本地源文件。')
  const seen = new Set<string>()
  const unique = sources.filter(source => { const key = source.assetId ? `asset:${source.assetId}` : `path:${videoEditMediaPathKey(source.path!)}`; if (seen.has(key)) return false; seen.add(key); return true })
  const results = await settleImportBatches(unique, async input => {
    signal?.throwIfAborted()
    const fixed = !input.assetId && input.path ? existingByPath.get(videoEditMediaPathKey(input.path)) : undefined
    if (fixed?.assetContent?.contentIdentity) await boundedMetadata(() => verifyVideoEditMediaContent(fixed, signal))
    const asset = input.assetId ? await boundedMetadata(() => resolveVideoEditAssetReference(input.assetId!)) : undefined
    const path = asset?.filePath ?? input.path
    if (!path) throw new Error('请引用素材库素材或本地源文件。')
    return { path, ...(asset ? { asset } : {}), ...(fixed?.assetContent?.contentIdentity ? { fixed } : {}) }
  }, signal)
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  const resolved: Array<{ path: string; asset?: AssetRecord; fixed?: VideoEditMedia }> = []
  const resolvedByPath = new Map<string, typeof resolved[number]>()
  for (const result of results) if (result.status === 'fulfilled') {
    const key = videoEditMediaPathKey(result.value.path)
    const previous = resolvedByPath.get(key)
    if (previous?.asset && result.value.asset && previous.asset.id !== result.value.asset.id) throw new Error('同一源文件包含冲突的素材库引用，请重新引用。')
    if (!previous) { resolved.push(result.value); resolvedByPath.set(key, result.value) }
    else if (result.value.asset) previous.asset = result.value.asset
  }
  signal?.throwIfAborted()
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，导入不会写入重新打开的剪辑。')
  reportVideoEditImport(options.task, { phase: 'probing', completed: 0, total: resolved.length }, options.onProgress)
  const metadata = await settleImportBatches(resolved, async source => {
    signal?.throwIfAborted()
    const existing = existingByPath.get(videoEditMediaPathKey(source.path))
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
  }, signal, completed => reportVideoEditImport(options.task!, { phase: 'probing', completed, total: resolved.length }, options.onProgress))
  signal?.throwIfAborted()
  const skipped = new Set(options.skipUnreadable ? metadata.flatMap((result, index) => result.status === 'rejected' && !resolved[index].asset ? [index] : []) : [])
  for (const index of skipped) options.skipUnreadable!(resolved[index].path, (metadata[index] as PromiseRejectedResult).reason)
  const metadataFailure = metadata.find((result, index) => result.status === 'rejected' && !skipped.has(index))
  if (metadataFailure?.status === 'rejected') throw metadataFailure.reason
  const inspected = metadata.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  signal?.throwIfAborted()
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，导入不会写入重新打开的剪辑。')
  const ids: string[] = []
  const baseline = owner.document
  const document = structuredClone(baseline)
  const mediaByPath = new Map(document.media.map(media => [videoEditMediaPathKey(media.path), media]))
  const itemsByMedia = new Map(document.items.filter(item => item.binId === binId).map(item => [item.mediaId, item]))
    if (binId && !document.bins.some(bin => bin.id === binId)) throw new Error('导入期间目标素材箱已移除，请重新选择导入位置。')
    for (const { source, media: inspectedMedia } of inspected) {
      let media = mediaByPath.get(videoEditMediaPathKey(source.path))
      if (!media) { media = { ...inspectedMedia }; document.media.push(media); mediaByPath.set(videoEditMediaPathKey(source.path), media) }
      if (source.asset) {
        validateAssetMedia(media, source.asset)
        const content = videoEditAssetContentSnapshot(source.asset)
        if (!media.assetContent?.contentIdentity || media.path !== source.path) media.sourceRevision = crypto.randomUUID()
        media.path = source.path
        media.assetId = source.asset.id; media.assetContent = content
      }
      let item = itemsByMedia.get(media.id)
      if (!item) { item = { id: crypto.randomUUID(), name: media.name, kind: media.kind, mediaId: media.id, ...(binId ? { binId } : {}) }; document.items.push(item); itemsByMedia.set(media.id, item) }
      ids.push(item.id)
    }
  const next = afterImport ? await afterImport(document, ids) : document
  const rechecks = await settleImportBatches(inspected, async ({ source }) => source.asset ? boundedMetadata(async () => {
    signal?.throwIfAborted()
    if (!sameVideoEditAssetContent(source.asset!, await resolveVideoEditAssetReference(source.asset!.id))) throw new Error('素材库源文件在导入期间已改变，请重新引用该素材。')
  }) : source.fixed ? boundedMetadata(() => verifyVideoEditMediaContent(source.fixed!, signal)) : undefined, signal)
  const recheckFailure = rechecks.find(result => result.status === 'rejected')
  if (recheckFailure?.status === 'rejected') throw recheckFailure.reason
  signal?.throwIfAborted()
  if (requireVideoEditInstance(projectId) !== owner || owner.document !== baseline) throw new Error('导入检查期间原剪辑已改变，请重新导入。')
  editVideoProject(projectId, () => next, preserveProgramAnchors)
  const nextItems = new Map(next.items.map(item => [item.id, item]))
  void autoCreateVideoEditProxies(projectId, ids.flatMap(id => { const item = nextItems.get(id); return item?.mediaId ? [item.mediaId] : [] })).catch(error => logger.warn('导入后代理创建未完成', { event: 'video_edit.proxy.import_failed', error }))
  logger.info('导入剪辑素材完成', { event: 'video_edit.media.import.completed', context: { projectId, count: ids.length } })
  return ids
  } catch (error) {
    logger.debug('导入剪辑素材未完成', { event: 'video_edit.media.import.failed', error, context: { projectId } }); throw error
  }
}
export async function importVideoEditPaths(projectId: string, paths: string[], binId?: string): Promise<string[]> {
  const { importVideoEditPathsAndFolders } = await import('./videoEditFolderImport')
  return (await importVideoEditPathsAndFolders(projectId, paths, binId)).itemIds
}
/**
 * Import dialog formats: containers the media probe reads. Whether a file actually decodes is decided by
 * inspection, which names the format when it cannot; dropped files are not filtered by extension at all.
 */
export const VIDEO_EDIT_IMPORT_EXTENSIONS = [
  'mp4', 'm4v', 'mov', 'mxf', 'mkv', 'webm', 'avi', 'mpg', 'mpeg', 'm2ts', 'mts',
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus',
  'png', 'jpg', 'jpeg', 'webp', 'avif',
] as const
export async function chooseVideoEditMedia(projectId: string, binId?: string): Promise<string[]> {
  const owner = requireVideoEditInstance(projectId)
  const paths = await getPlatform().system.dialog.open({ multiple: true, filters: [{ name: '视频、图片与音频', extensions: [...VIDEO_EDIT_IMPORT_EXTENSIONS] }] })
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，请重新导入。')
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
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，请重新定位素材。')
  if (media.kind !== previous.kind) throw new Error('重新定位的文件类型必须与原素材一致。')
  if (content) {
    const current = await getPlatform().assetLibrary.inspectFileContent(path, media.kind)
    if (current.contentIdentity !== content.contentIdentity || current.sizeBytes !== content.sizeBytes || current.fileModifiedAt !== content.fileModifiedAt) throw new Error('源文件在重新定位期间已改变，请重新选择。')
  }
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，请重新定位素材。')
  if (owner.document.media.find(item => item.id === mediaId) !== previous) throw new Error('源素材在重新定位期间已改变，请重新选择。')
  editVideoProject(projectId, document => ({ ...document, media: document.media.map(item => item.id === mediaId ? { ...media, id: mediaId, sourceRevision: media.id, ...(content ? { assetId: previous.assetId, assetContent: content } : {}) } : item) }))
}
/**
 * The sound streams of one media file (task 2.6). Media imported before the stream list existed is read once on
 * demand and the list is recorded, so its audio channels can be modified; nothing is migrated when a project opens.
 */
export async function ensureVideoEditMediaAudioStreams(projectId: string, mediaId: string, signal?: AbortSignal): Promise<NonNullable<VideoEditMedia['audioStreams']>> {
  const owner = requireVideoEditInstance(projectId)
  const media = owner.document.media.find(media => media.id === mediaId)
  if (!media || media.kind === 'image') throw new Error('此素材项没有声音。')
  if (media.audioStreams) return media.audioStreams
  const inspected = await inspectVideoEditMedia(media.path, signal)
  signal?.throwIfAborted()
  if (!inspected.audioStreams) throw new Error('此素材没有可用的声音。')
  const streams = inspected.audioStreams
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭。')
  editVideoProject(projectId, document => {
    const current = document.media.find(value => value.id === mediaId)
    if (!current || current.path !== media.path) throw new Error('素材已改变，请重新打开音频声道设置。')
    return current.audioStreams ? document : { ...document, media: document.media.map(value => value.id === mediaId ? { ...value, audioStreams: streams } : value) }
  })
  logger.info('补读剪辑素材声音流', { event: 'video_edit.media.audio_streams.completed', context: { projectId, streams: streams.length } })
  return streams
}
