import { decodeSmartRegionLayout, smartRegionLayoutBytes, type SmartRegionMaskParams, type SmartRegionSegmentLayout } from '@/core/videoEdit/smartRegions'
import {
  decodeVideoEditTrackRecord, rasterizeVideoEditTrackBox, videoEditFollowPlacement, videoEditTrackBoxAt, videoEditTrackerKey, videoEditTrackFrameIndex,
  videoEditTrackShapeMask, type VideoEditTrackBox, type VideoEditTrackHeader, type VideoEditTracker,
  decodeVideoEditTrackGeometry, isVideoEditTrackQuad, rasterizeVideoEditTrackPlane, videoEditCornerPinMatrix, videoEditTrackProject, type VideoEditTrackGeometryRecord, type VideoEditTrackQuad,
} from '@/core/videoEdit/tracking'
import { videoEditClipPictureSize, videoEditClipToFrame } from '@/core/videoEdit/clipGeometry'
import { videoEditClipMedia, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditTrackingSourceId } from '@/core/videoEdit/trackingSource'
import { videoEditFps, videoEditSourceSeconds } from '@/core/videoEdit/time'
import { videoEditClipSourceRange, videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import { videoEditPointPose, videoEditQuadPose, type VideoEditSimilarity } from '@/core/videoEdit/trackTransform'
import { solveVideoEditStabilization, videoEditCameraSamples, videoEditStabilizationAt, videoEditStabilizationPictureTransform, videoEditStabilizedPlacement, type VideoEditClipStabilization, type VideoEditStabilizationSolution } from '@/core/videoEdit/stabilization'
import { recordingCursorPointAt, recordingTrackBox, recordingWindowBoundsAt } from '@/core/videoEdit/recordingTracks'
import type { RecordingCursorSource } from '@/core/videoEdit/recordingCursor'
import type { VideoEditFollowTrack } from '@/core/videoEdit/tracking'
import { fetchRange, inflate, type VideoEditSmartRegionMask } from './videoEditSmartRegionMasks'
import { VideoEditRecordingCursorSource, type RecordingCursorPageReader } from './videoEditRecordingCursorSource'
import { loadVideoEditHighs } from './videoEditHighs'
import { createLogger } from '@/core/logging'

/*
 * 渲染 Worker 读取跟踪结果（任务 4.10）：主线程把跟踪结果（可 fetch 的地址 + 版本）按“素材 ID + 方式 + 提示”发过来，
 * 渲染每帧时按片段的素材时间取框或掩码：
 * - 效果作用区域选“跟踪”：形状跟踪取那一帧的掩码 logit → 填洞、放大、扩展羽化；物体框跟踪把框画成矩形；
 * - 手绘遮罩跟随：取框，按相对参考框的平移与缩放移动遮罩；
 * - 片段跟随：取被跟随片段在这一帧的框与姿态，换算到序列画面，改跟随片段的位置（可选缩放、旋转）；
 * - 防抖：片段用到的相机路径求 L1 平滑路径（按结果版本、参数与范围缓存），每帧把修正合成进片段的位置、缩放、旋转；
 * - 录屏事件跟踪：不读结果文件，按素材的录制事件直接换算框（光标、窗口）。
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

/** 录屏事件跟踪：键 → 素材的录制事件与跟踪定义（由算键的地方登记，Worker 内本地）。 */
const recordingTracks = new Map<string, { source: RecordingCursorSource; tracker: VideoEditTracker }>()
let recordingEvents = new VideoEditRecordingCursorSource()
const recordingReferences = new Map<string, Promise<{ x: number; y: number; width: number; height: number } | null>>()
/** 主线程读事件页的方式（Worker 用默认的媒体地址读取）。 */
export function setVideoEditRecordingTrackReader(reader: RecordingCursorPageReader): void { recordingEvents = new VideoEditRecordingCursorSource(reader); recordingReferences.clear() }

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

/** Explicit result handle: reviewing never replaces the renderer's active result table. */
export async function readVideoEditTrackReviewHeader(result: VideoEditTrackResult, signal: AbortSignal): Promise<VideoEditTrackHeader> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new DOMException('已取消', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    // The small shared header request can also serve rendering/other callers; do not abort it.
    layoutOf(result).then(layout => { signal.removeEventListener('abort', abort); if (signal.aborted) abort(); else resolve(layout.header) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
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

/** 跟踪器的结果键；录屏事件跟踪同时登记它的事件来源（素材没有录制事件时无结果）。 */
export function videoEditTrackerResultKey(document: Pick<VideoEditComposition, 'media' | 'items'>, clip: VideoEditClip, sourceId: string, tracker: VideoEditTracker): string {
  const key = videoEditTrackerKey(sourceId, tracker)
  const source = tracker.recording && clip.kind === 'video' ? videoEditClipMedia(document, clip)?.recordingCursor : undefined
  if (source) recordingTracks.set(key, { source, tracker })
  return key
}

async function recordingBox(entry: { source: RecordingCursorSource; tracker: VideoEditTracker }, timeUs: number): Promise<VideoEditTrackBox | null> {
  const { source, tracker } = entry; const prompt = tracker.prompts[0]; const signal = new AbortController().signal
  const time = timeUs + source.recordingStartUs
  if (tracker.recording!.kind === 'cursor') return recordingTrackBox(tracker.recording!, prompt, source, { cursor: recordingCursorPointAt(await recordingEvents.window(source, time, 0, signal), time) })
  const windowId = tracker.recording!.windowId
  const referenceKey = JSON.stringify([source.sourceDigest, windowId, prompt.timeUs])
  let reference = recordingReferences.get(referenceKey)
  if (!reference) {
    const at = prompt.timeUs + source.recordingStartUs
    reference = recordingEvents.windowEvents(source, at, signal).then(events => recordingWindowBoundsAt(events, at, windowId))
    reference.catch(() => { if (recordingReferences.get(referenceKey) === reference) recordingReferences.delete(referenceKey) })
    recordingReferences.set(referenceKey, reference)
    while (recordingReferences.size > 64) recordingReferences.delete(recordingReferences.keys().next().value as string)
  }
  return recordingTrackBox(tracker.recording!, prompt, source, { window: recordingWindowBoundsAt(await recordingEvents.windowEvents(source, time, signal), time, windowId), reference: await reference })
}

/** 跟踪器在素材时间 timeUs 的框（相邻帧插值）；还没有结果时 undefined。 */
export async function videoEditTrackerBox(trackerKey: string, timeUs: number): Promise<VideoEditTrackBox | null | undefined> {
  const recording = recordingTracks.get(trackerKey)
  if (recording) return recordingBox(recording, timeUs)
  const result = results[trackerKey]
  if (!result) return undefined
  return videoEditTrackBoxAt((await layoutOf(result)).header, timeUs)
}

/** 点、平面跟踪在素材时间 timeUs 的几何（相邻帧插值）；partial 时点跟踪保留部分跟丢的帧（各点自带可信度）。 */
export async function videoEditTrackerGeometry(trackerKey: string, timeUs: number, partial = false): Promise<VideoEditTrackGeometryRecord | undefined> {
  const recording = recordingTracks.get(trackerKey)
  if (recording) {
    if (recording.tracker.recording?.kind !== 'cursor') return undefined
    const box = await recordingBox(recording, timeUs)
    return box ? { points: [[box[0] + box[2] / 2, box[1] + box[3] / 2, 1]], confidence: 1 } : undefined
  }
  const result=results[trackerKey]; if (!result) return undefined
  const layout=await layoutOf(result); const h=layout.header
  if (h.method !== 'point' && h.method !== 'planar') return undefined
  const position=Math.max(0,Math.min(h.frameCount-1,timeUs*h.fps/1e6-h.firstFrame)); const before=Math.floor(position); const after=Math.min(h.frameCount-1,before+1); const t=position-before
  const a=decodeVideoEditTrackGeometry(await recordOf(result,layout,before))
  if (before===after) return a.confidence>0 || partial && a.points?.some(p=>p[2]>0) ? a : undefined
  const b=decodeVideoEditTrackGeometry(await recordOf(result,layout,after))
  if (partial && a.points && b.points) {
    // 各点按自己的可信度：两帧都跟到才插值，只有一帧跟到时取那一帧，都丢了记 0。
    const points=a.points.map((p,i)=>{ const q=b.points![i]; return p[2]>0 && q[2]>0 ? [p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,Math.min(p[2],q[2])] as [number,number,number] : p[2]>0 ? p : q })
    return points.some(p=>p[2]>0) ? {points,confidence:Math.min(...points.map(p=>p[2]))} : undefined
  }
  if (!a.confidence || !b.confidence) return undefined
  const blend=(x:number,y:number):number=>x+(y-x)*t
  if (a.quad && b.quad) {
    const quad=a.quad.map((p,i)=>[blend(p[0],b.quad![i][0]),blend(p[1],b.quad![i][1])]) as VideoEditTrackQuad
    return isVideoEditTrackQuad(quad) ? {quad,confidence:Math.min(a.confidence,b.confidence)} : undefined
  }
  return {points:a.points?.map((p,i)=>[blend(p[0],b.points![i][0]),blend(p[1],b.points![i][1]),Math.min(p[2],b.points![i][2])]),confidence:Math.min(a.confidence,b.confidence)}
}
/** Derived geometry exists only on render copies, never in the saved document（trackingRotation：跟随带来的旋转增量）。 */
export type VideoEditTrackedClip = VideoEditClip & { trackingQuad?: VideoEditTrackQuad; trackingRotation?: number }
export function videoEditClipTrackingQuad(clip: VideoEditClip): VideoEditTrackQuad | undefined { return (clip as VideoEditTrackedClip).trackingQuad }

/** 跟踪器作为效果作用区域的蒙版（片段画面比例，长边 512）；还没有结果时 undefined。 */
export async function videoEditTrackerMask(trackerKey: string, params: SmartRegionMaskParams, timeUs: number): Promise<VideoEditSmartRegionMask | undefined> {
  const result = results[trackerKey]
  if (!result) return undefined
  const layout = await layoutOf(result)
  const { header } = layout
  if (header.method === 'planar') return rasterizeVideoEditTrackPlane((await videoEditTrackerGeometry(trackerKey,timeUs))?.quad,header.sourceWidth,header.sourceHeight,params)
  if (header.method !== 'shape') return rasterizeVideoEditTrackBox(videoEditTrackBoxAt(header, timeUs), header.sourceWidth, header.sourceHeight, params)
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
  const source = videoEditTrackingSourceId(document, clip)
  return tracker && source ? { key: videoEditTrackerResultKey(document, clip, source, tracker), tracker } : undefined
}

/**
 * 跟随用的一帧跟踪：框，加上能求出的姿态（两点及以上的点跟踪、平面跟踪有旋转与缩放）。
 * 部分点跟丢时三、四点跟踪用剩下的点；姿态求不出来时只有框（只跟位置）。
 */
export async function videoEditTrackerFollowTrack(trackerKey: string, tracker: VideoEditTracker, timeUs: number, picture: { width: number; height: number }): Promise<VideoEditFollowTrack | undefined> {
  const box = await videoEditTrackerBox(trackerKey, timeUs)
  if (!box) return undefined
  const aspect = picture.width / Math.max(1, picture.height)
  const reference = tracker.prompts[0]
  if (tracker.method === 'point' && (reference.points?.length ?? 0) >= 2) {
    const geometry = await videoEditTrackerGeometry(trackerKey, timeUs, true)
    const pose = geometry?.points && videoEditPointPose(reference.points!.map(p => [p[0], p[1]] as const), geometry.points, aspect)
    return pose ? { box, pose } : { box }
  }
  if (tracker.method === 'planar' && reference.quad) {
    const geometry = await videoEditTrackerGeometry(trackerKey, timeUs)
    const pose = geometry?.quad && videoEditQuadPose(reference.quad, geometry.quad, aspect, geometry.confidence)
    return pose ? { box, pose } : { box }
  }
  return { box }
}

// ==================== 防抖 ====================

const stabilizations = new Map<string, Promise<VideoEditStabilizationSolution & { firstFrame: number; fps: number }>>()
const MAX_STABILIZATIONS = 16

/** 相机运动（防抖分析）的结果键：同一素材共用，与片段参数无关。 */
export function videoEditCameraKey(sourceId: string): string { return videoEditTrackerKey(sourceId, { method: 'camera' as VideoEditTracker['method'], prompts: [] }) }

/**
 * 片段用到的那段相机路径的平滑解（按结果版本、参数、范围与画面宽高比缓存）；还没有分析结果时 undefined。
 * 分析覆盖不到的帧按两端处理。
 */
export async function videoEditClipStabilizationSolution(document: VideoEditComposition, clip: VideoEditClip): Promise<(VideoEditStabilizationSolution & { firstFrame: number; fps: number }) | undefined> {
  const params = clip.stabilization; const sourceId = videoEditTrackingSourceId(document, clip)
  if (!params || !sourceId) return undefined
  const result = results[videoEditCameraKey(sourceId)]
  if (!result) return undefined
  const { header } = await layoutOf(result)
  if (!header.camera?.length) throw new Error('防抖分析结果缺少相机路径。')
  const range = videoEditClipSourceRange(clip, videoEditFps(document.frameRate))
  const first = Math.max(header.firstFrame, Math.floor(range.from * header.fps)); const last = Math.min(header.firstFrame + header.frameCount - 1, Math.ceil(range.to * header.fps))
  if (last <= first) return undefined
  const picture = videoEditClipPictureSize(document, clip); const aspect = picture.width / Math.max(1, picture.height)
  const key = `${cacheKey(result)}\u0001${JSON.stringify([params.smoothness, params.maxCrop, params.rotation, params.scale, first, last, Math.round(aspect * 1e4)])}`
  let pending = stabilizations.get(key)
  if (!pending) {
    pending = loadVideoEditHighs().then(highs => {
      const samples = videoEditCameraSamples(header.camera!.slice(first - header.firstFrame, last - header.firstFrame + 1))
      const solution = solveVideoEditStabilization(highs, samples, aspect, params)
      logger.info('防抖路径求解完成', { event: 'video_edit.stabilization.solved', context: { frames: samples.length, smoothness: params.smoothness, crop: Math.round(solution.crop * 1000) / 1000, solveMs: solution.solveMs } })
      return { ...solution, firstFrame: first, fps: header.fps }
    })
    pending.catch(() => { if (stabilizations.get(key) === pending) stabilizations.delete(key) })
    stabilizations.set(key, pending)
    while (stabilizations.size > MAX_STABILIZATIONS) stabilizations.delete(stabilizations.keys().next().value as string)
  }
  return pending
}

/** 片段在序列第 frame 帧的画面修正（原画面 → 稳定后的画面）；没有防抖或还没有结果时 undefined。 */
export async function videoEditClipStabilizationTransform(document: VideoEditComposition, clip: VideoEditClip, frame: number): Promise<VideoEditSimilarity | undefined> {
  const params: VideoEditClipStabilization | undefined = clip.stabilization
  if (!params) return undefined
  const solution = await videoEditClipStabilizationSolution(document, clip).catch((error: unknown) => {
    const key = `stabilize\u0000${clip.id}`
    if (!failures.has(key)) { failures.add(key); logger.warn('防抖修正读取失败', { event: 'video_edit.stabilization.failed', error, context: { clipId: clip.id } }) }
    return undefined
  })
  if (!solution) return undefined
  const position = videoEditClipSourceTimeUs(document, clip, frame) * solution.fps / 1e6 - solution.firstFrame
  return videoEditStabilizationPictureTransform(videoEditStabilizationAt(solution, position), solution.zoom, params)
}

/** 有防抖的片段：把这一帧的修正合成进位置、缩放与旋转（在关键帧与跟随之后），与预览、导出同一份。 */
export async function applyVideoEditStabilization<T extends VideoEditClip>(document: VideoEditComposition, clips: T[], frame: number): Promise<T[]> {
  if (!clips.some(clip => clip.stabilization)) return clips
  return Promise.all(clips.map(async clip => {
    const transform = clip.stabilization && await videoEditClipStabilizationTransform(document, clip, frame)
    return transform ? videoEditStabilizedPlacement(clip, videoEditClipPictureSize(document, clip), document, transform) : clip
  }))
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
    const resolved = await resolve(source, new Set([...ancestors, clip.id]))
    if (!resolved) return undefined
    // 被跟踪片段有防抖时，跟踪点按稳定后的画面换算，跟随的元素贴在稳定画面里的物体上。
    const target = (await applyVideoEditStabilization(document, [resolved], frame))[0]
    const tracker = videoEditClipTracker(document, target, clip.follow.trackerId)
    if (!tracker) return clip
    if (clip.follow.mode === 'corner_pin') {
      const geometry=await videoEditTrackerGeometry(tracker.key,videoEditClipSourceTimeUs(document,target,frame)).catch((error: unknown) => {
        const result=results[tracker.key];const key=result && cacheKey(result)
        if(key && !failures.has(key)){failures.add(key);logger.warn('角点贴合结果读取失败', {event:'video_edit.tracking.corner_failed',error,context:{clipId:clip.id}})}
        return undefined
      })
      // 四点跟踪也可角点贴合：四个点按左上、右上、右下、左下的提示顺序就是四角。
      const corners = geometry?.quad ?? (geometry?.points?.length === 4 && geometry.points.every(p => p[2] > 0) ? geometry.points.map(p => [p[0], p[1]]) as VideoEditTrackQuad : undefined)
      if (!corners || !isVideoEditTrackQuad(corners)) return clip
      const parentQuad=videoEditClipTrackingQuad(target); const parent=parentQuad && videoEditCornerPinMatrix(parentQuad)
      const quad=corners.map(([u,v]) => { if (parent) return videoEditTrackProject(parent,u,v); const p=videoEditClipToFrame(target,videoEditClipPictureSize(document,target),document,u,v); return [p.x,p.y] }) as VideoEditTrackQuad
      return { ...clip, trackingQuad:quad } as VideoEditTrackedClip
    }
    const picture = videoEditClipPictureSize(document, target)
    const track = await videoEditTrackerFollowTrack(tracker.key, tracker.tracker, videoEditClipSourceTimeUs(document, target, frame), picture).catch((error: unknown) => {
      const result = results[tracker.key]; const key = result ? cacheKey(result) : tracker.key
      if (!failures.has(key)) { failures.add(key); logger.warn('片段跟随结果读取失败', { event: 'video_edit.tracking.follow_failed', error, context: { sequenceId: document.id, clipId: clip.id } }) }
      return undefined
    })
    if (!track) return clip
    const { trackingRotation, ...placement } = videoEditFollowPlacement(clip.follow, clip, target, picture, document, track)
    return { ...clip, ...placement, ...(trackingRotation ? { trackingRotation } : {}) } as VideoEditTrackedClip
  }
  return Promise.all(clips.map(async clip => await resolve(clip, new Set()) ?? clip))
}
