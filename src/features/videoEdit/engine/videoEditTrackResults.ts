import { decodeSmartRegionLayout, smartRegionLayoutBytes, type SmartRegionMaskParams, type SmartRegionSegmentLayout } from '@/core/videoEdit/smartRegions'
import {
  decodeVideoEditTrackRecord, rasterizeVideoEditTrackBox, videoEditFollowPlacement, videoEditTrackBoxAt, videoEditTrackerKey, videoEditTrackFrameIndex,
  videoEditTrackShapeMask, type VideoEditTrackBox, type VideoEditTrackHeader, type VideoEditTracker,
} from '@/core/videoEdit/tracking'
import { videoEditClipPictureSize } from '@/core/videoEdit/clipGeometry'
import { videoEditClipMedia, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditSourceSeconds } from '@/core/videoEdit/time'
import { videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import { fetchRange, inflate, type VideoEditSmartRegionMask } from './videoEditSmartRegionMasks'
import { createLogger } from '@/core/logging'

/*
 * 渲染 Worker 读取跟踪结果（任务 4.10）：主线程把跟踪结果（可 fetch 的地址 + 版本）按“素材 ID + 方式 + 提示”发过来，
 * 渲染每帧时按片段的素材时间取框或掩码：
 * - 效果作用区域选“跟踪”：形状跟踪取那一帧的掩码 logit → 填洞、放大、扩展羽化；物体框跟踪把框画成矩形；
 * - 手绘遮罩跟随：取框，按相对参考框的平移与缩放移动遮罩；
 * - 片段跟随：取被跟随片段在这一帧的框，换算到序列画面，改跟随片段的位置（可选缩放）。
 * 结果文件在续跟时会原地更新（同一个跟踪定义同一个文件），所以缓存按“地址 + 版本”记。
 */

export interface VideoEditTrackResult { url: string; version: string }
export type VideoEditTrackResults = Readonly<Record<string, VideoEditTrackResult>>

let results: VideoEditTrackResults = {}
const layouts = new Map<string, Promise<SmartRegionSegmentLayout<VideoEditTrackHeader>>>()
const records = new Map<string, Promise<Uint8Array>>()
const masks = new Map<string, VideoEditSmartRegionMask>()
const MAX_LAYOUTS = 16; const MAX_RECORDS = 64; const MAX_MASKS = 12
const logger = createLogger('features.videoEdit.tracking')
const failures = new Set<string>()

function remember<T>(cache: Map<string, T>, key: string, value: T, limit: number): T {
  cache.delete(key); cache.set(key, value)
  while (cache.size > limit) cache.delete(cache.keys().next().value as string)
  return value
}
const cacheKey = (result: VideoEditTrackResult): string => `${result.url}\u0000${result.version}`

export function setVideoEditTrackResults(value: VideoEditTrackResults): void {
  results = value
  const live = new Set(Object.values(value).map(cacheKey))
  for (const key of failures) if (!live.has(key)) failures.delete(key)
  for (const cache of [layouts, records, masks] as Array<Map<string, unknown>>) for (const key of [...cache.keys()]) if (!live.has(key.split('\u0001')[0])) cache.delete(key)
}

function layoutOf(result: VideoEditTrackResult): Promise<SmartRegionSegmentLayout<VideoEditTrackHeader>> {
  const key = cacheKey(result)
  const cached = layouts.get(key)
  if (cached) return remember(layouts, key, cached, MAX_LAYOUTS)
  const pending = (async () => {
    let head = await fetchRange(result.url, 0, 64 * 1024)
    const total = smartRegionLayoutBytes(head)
    if (head.byteLength < total) head = await fetchRange(result.url, 0, total)
    const layout = decodeSmartRegionLayout<VideoEditTrackHeader>(head)
    if (layout.header.kind !== 'track' || !layout.header.frameCount || layout.header.boxes.length !== layout.header.frameCount) throw new Error('跟踪结果格式无效。')
    return layout
  })()
  pending.catch(() => { if (layouts.get(key) === pending) layouts.delete(key) })
  return remember(layouts, key, pending, MAX_LAYOUTS)
}

function recordOf(result: VideoEditTrackResult, layout: SmartRegionSegmentLayout<VideoEditTrackHeader>, index: number): Promise<Uint8Array> {
  const key = `${cacheKey(result)}\u0001${index}`
  const cached = records.get(key)
  if (cached) return remember(records, key, cached, MAX_RECORDS)
  const entry = layout.frames[index]
  if (!entry?.length) return Promise.reject(new Error('跟踪帧记录缺失。'))
  const pending = fetchRange(result.url, layout.dataOffset + entry.offset, layout.dataOffset + entry.offset + entry.length).then(inflate)
  pending.catch(() => { if (records.get(key) === pending) records.delete(key) })
  return remember(records, key, pending, MAX_RECORDS)
}

/** 跟踪器在素材时间 timeUs 的框（相邻帧插值）；还没有结果时 undefined。 */
export async function videoEditTrackerBox(trackerKey: string, timeUs: number): Promise<VideoEditTrackBox | null | undefined> {
  const result = results[trackerKey]
  if (!result) return undefined
  return videoEditTrackBoxAt((await layoutOf(result)).header, timeUs)
}

/** 跟踪器作为效果作用区域的蒙版（片段画面比例，长边 512）；还没有结果时 undefined。 */
export async function videoEditTrackerMask(trackerKey: string, params: SmartRegionMaskParams, timeUs: number): Promise<VideoEditSmartRegionMask | undefined> {
  const result = results[trackerKey]
  if (!result) return undefined
  const layout = await layoutOf(result)
  const { header } = layout
  if (header.method === 'box') return rasterizeVideoEditTrackBox(videoEditTrackBoxAt(header, timeUs), header.sourceWidth, header.sourceHeight, params)
  const index = videoEditTrackFrameIndex(header, timeUs)
  const key = `${cacheKey(result)}\u0001m${index}\u0000${params.feather}\u0000${params.expand}\u0000${params.invert}`
  const cached = masks.get(key)
  if (cached) return remember(masks, key, cached, MAX_MASKS)
  const record = decodeVideoEditTrackRecord(await recordOf(result, layout, index))
  // 物体不在画面里（被挡住、出画）：整张为空，反转时整张满
  const mask = record.score > 0 ? videoEditTrackShapeMask(record.logits, header, params) : rasterizeVideoEditTrackBox(null, header.sourceWidth, header.sourceHeight, params)
  return remember(masks, key, mask, MAX_MASKS)
}

/** 片段在序列第 frame 帧对应的素材时间（微秒；超出片段范围按两端）。 */
export function videoEditClipSourceTimeUs(document: VideoEditComposition, clip: VideoEditClip, frame: number): number {
  const media = videoEditClipMedia(document, clip)
  if (media?.kind === 'image') return 0
  const local = Math.max(0, Math.min(clip.duration - 1, frame - clip.start))
  return Math.round(videoEditSourceSeconds(videoEditClipSourceTimeAt(clip, local, document.frameRate, true)) * 1e6)
}

export function videoEditClipTracker(document: VideoEditComposition, clip: VideoEditClip, trackerId: string): { key: string; tracker: VideoEditTracker } | undefined {
  const tracker = clip.trackers?.find(entry => entry.id === trackerId)
  const media = videoEditClipMedia(document, clip)
  return tracker && media ? { key: videoEditTrackerKey(media.id, tracker), tracker } : undefined
}

/**
 * 片段跟随（元素跟随）：有 `follow` 的片段按被跟随片段这一帧的跟踪框改位置（可选缩放）。
 * 被跟随的片段、跟踪器不在了或还没有结果时保持原位。
 */
export async function applyVideoEditClipFollow(document: VideoEditComposition, clips: VideoEditClip[], frame: number): Promise<VideoEditClip[]> {
  if (!clips.some(clip => clip.follow)) return clips
  const resolve = async (clip: VideoEditClip, ancestors: ReadonlySet<string>): Promise<VideoEditClip | undefined> => {
    if (ancestors.has(clip.id)) return undefined
    if (!clip.follow) return clip
    const source = document.clips.find(entry => entry.id === clip.follow!.clipId)
    if (!source) return clip
    const target = await resolve(source, new Set([...ancestors, clip.id]))
    if (!target) return undefined
    const tracker = videoEditClipTracker(document, target, clip.follow.trackerId)
    if (!tracker) return clip
    const box = await videoEditTrackerBox(tracker.key, videoEditClipSourceTimeUs(document, target, frame)).catch((error: unknown) => {
      const result = results[tracker.key]; const key = result && cacheKey(result)
      if (key && !failures.has(key)) { failures.add(key); logger.warn('片段跟随结果读取失败', { event: 'video_edit.tracking.follow_failed', error, context: { sequenceId: document.id, clipId: clip.id } }) }
      return undefined
    })
    if (!box) return clip
    return { ...clip, ...videoEditFollowPlacement(clip.follow, clip.scale, target, videoEditClipPictureSize(document, target), document, box) }
  }
  return Promise.all(clips.map(async clip => await resolve(clip, new Set()) ?? clip))
}
