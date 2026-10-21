import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { videoEditComposition, videoEditClipMedia, type VideoEditClip, type VideoEditDocument, type VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditTrackerSchema, normalizeVideoEditTracker, VIDEO_EDIT_MAX_TRACKERS, videoEditFollowBinding, videoEditTrackerFollowAbilities, type VideoEditFollowTrack, type VideoEditTracker, type VideoEditTrackPrompt } from '@/core/videoEdit/tracking'
import { assertVideoEditMaskTrackers, isShapesMask, videoEditMaskShapeBounds, type VideoEditMaskShape } from '@/core/videoEdit/effectMasks'
import { videoEditClipPictureSize } from '@/core/videoEdit/clipGeometry'
import { evaluateVideoEditClip, videoEditClipAnimatedValueSchemas } from '@/core/videoEdit/keyframes'
import { recordingCursorPointAt, recordingForegroundWindowAt, RECORDING_CURSOR_REGION } from '@/core/videoEdit/recordingTracks'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import { editVideoSequence, requireVideoEditInstance } from './videoEditService'
import { applyVideoEditClipFollow, setVideoEditRecordingTrackReader, setVideoEditTrackResults, videoEditClipSourceTimeUs, videoEditClipTracker, videoEditTrackerBox, videoEditTrackerFollowTrack, videoEditTrackerGeometry } from '../engine/videoEditTrackResults'
import { VideoEditRecordingCursorSource, type RecordingCursorPageReader } from '../engine/videoEditRecordingCursorSource'
import { videoEditTrackResults, videoEditTrackingRequest, waitVideoEditTrackingDefinitions } from './videoEditTracking'
import type { VideoEditCompositeTarget } from './videoEditCompositing'

export function assertVideoEditTrackerClip(document: VideoEditDocument, clip: VideoEditClip): void {
  const media = videoEditClipMedia(document, clip)
  if (clip.kind === 'sequence' && document.sequences.some(sequence => sequence.id === document.items.find(item => item.id === clip.itemId)?.sequenceId)) return
  if (!media || (clip.kind !== 'video' && clip.kind !== 'image')) throw new Error('请选择视频、图片或嵌套序列片段建立跟踪。')
}
export function putVideoEditTracker(document: VideoEditDocument, clip: VideoEditClip, value: unknown): VideoEditTracker {
  assertVideoEditTrackerClip(document, clip)
  const tracker = normalizeVideoEditTracker(videoEditTrackerSchema.parse(value))
  const existing = clip.trackers?.some(entry => entry.id === tracker.id)
  if (!existing && (clip.trackers?.length ?? 0) >= VIDEO_EDIT_MAX_TRACKERS) throw new Error(`一个片段最多 ${VIDEO_EDIT_MAX_TRACKERS} 个跟踪器。`)
  clip.trackers = existing ? clip.trackers!.map(entry => entry.id === tracker.id ? tracker : entry) : [...clip.trackers ?? [], tracker]
  return tracker
}
export { assertVideoEditMaskTrackers }
export function assertVideoEditClipFollow(sequence: VideoEditSequence, clip: VideoEditClip): void {
  if (!clip.follow) return
  if (clip.kind === 'audio' || clip.kind === 'adjustment') throw new Error('片段跟随只用于画面、文字或图形片段。')
  const target = sequence.clips.find(entry => entry.id === clip.follow!.clipId)
  const tracker = target?.trackers?.find(tracker => tracker.id === clip.follow!.trackerId)
  if (!target || !tracker) throw new Error('follow 需要同一序列内已有跟踪器的片段，请先创建 video_edit.tracker。')
  const abilities = videoEditTrackerFollowAbilities(tracker)
  if (clip.follow.mode === 'corner_pin' && ((clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'sequence') || !abilities.cornerPin)) throw new Error('角点贴合需要图片、视频或嵌套序列片段，以及平面跟踪器或四点跟踪器。')
  if (clip.follow.motion?.rotation !== undefined && !abilities.rotation) throw new Error(`跟踪器“${tracker.name}”不能跟随旋转：需要两点及以上的点跟踪或平面跟踪；只跟随位置请去掉 motion.rotation。`)
  if (clip.follow.motion?.size !== undefined && !abilities.scale) throw new Error(`跟踪器“${tracker.name}”不能跟随缩放：一点跟踪只有位置；请去掉 motion.size。`)
  const seen = new Set([clip.id]); let current: VideoEditClip | undefined = target
  while (current) {
    if (seen.has(current.id)) throw new Error('片段不能跟随自己或形成循环跟随。')
    seen.add(current.id); current = current.follow ? sequence.clips.find(entry => entry.id === current!.follow!.clipId) : undefined
  }
}
export function editVideoEditTracker(projectId: string, sequenceId: string, clipId: string, value: VideoEditTracker | { remove: string }): void {
  const document = requireVideoEditInstance(projectId).document
  editVideoSequence(projectId, sequenceId, sequence => {
    const clip = sequence.clips.find(entry => entry.id === clipId)
    if (!clip) throw new Error('跟踪片段已移除。')
    if ('remove' in value) clip.trackers = clip.trackers?.filter(entry => entry.id !== value.remove)
    else putVideoEditTracker(document, clip, value)
    return sequence
  })
}
export function correctVideoEditTracker(projectId: string, sequenceId: string, clipId: string, trackerId: string, prompt: VideoEditTrackPrompt): void {
  const instance = requireVideoEditInstance(projectId)
  const clip = instance.document.sequences.find(sequence => sequence.id === sequenceId)?.clips.find(clip => clip.id === clipId)
  const tracker = clip?.trackers?.find(tracker => tracker.id === trackerId)
  if (!tracker) throw new Error('跟踪器已移除。')
  editVideoEditTracker(projectId, sequenceId, clipId, { ...tracker, prompts: [...tracker.prompts.filter(entry => entry.timeUs !== prompt.timeUs), prompt] })
}
/** Start box tracking from a drawn mask, binding its original geometry in the same undo step. */
export function trackVideoEditMask(target: VideoEditCompositeTarget, effectId: string, shapeId: string): void {
  const instance = requireVideoEditInstance(target.projectId)
  const composition = videoEditComposition(instance.document, target.sequenceId)
  const frame = instance.frame
  editVideoSequence(target.projectId, target.sequenceId, sequence => {
    const clip = sequence.clips.find(clip => clip.id === target.clipId)
    const effect = clip?.effects?.find(effect => effect.id === effectId)
    if (!clip || !isShapesMask(effect?.mask)) throw new Error('请选择手绘遮罩。')
    const shape = effect.mask.shapes.find(shape => shape.id === shapeId)
    if (!shape) throw new Error('遮罩已移除。')
    if (shape.follow) { delete shape.follow; return sequence }
    const bounds = videoEditMaskShapeBounds(shape)
    const x = Math.max(0, bounds[0]); const y = Math.max(0, bounds[1]); const width = Math.min(1, bounds[0] + bounds[2]) - x; const height = Math.min(1, bounds[1] + bounds[3]) - y
    if (width < 0.002 || height < 0.002) throw new Error('遮罩需要覆盖画面内的物体才能跟踪。')
    const reference: [number, number, number, number] = [x, y, width, height]
    const tracker = putVideoEditTracker(instance.document, clip, { id: crypto.randomUUID(), name: '遮罩跟踪', method: 'box', prompts: [{ timeUs: videoEditClipSourceTimeUs(composition, clip, frame), box: reference }] })
    shape.follow = { trackerId: tracker.id, reference }
    return sequence
  })
}
const logger = createLogger('features.videoEdit.tracking')
/** 主线程读录屏事件页：直接读本地日志文件（Worker 里由渲染会话把路径换成媒体地址）。 */
const readRecordingPage: RecordingCursorPageReader = async (page, signal) => {
  const bytes = await getPlatform().system.fs.readFile(page.path, { maxBytes: 2 * 1024 * 1024 })
  signal.throwIfAborted()
  return new Uint8Array(bytes)
}
setVideoEditRecordingTrackReader(readRecordingPage)

/** Read the same ranged result as the render Worker, using a fresh result version. */
export async function readVideoEditTrackingBox(projectId: string, sequenceId: string, clipId: string, trackerId: string, frame: number) {
  const instance = requireVideoEditInstance(projectId)
  const document = videoEditComposition(instance.document, sequenceId)
  const clip = document.clips.find(entry => entry.id === clipId)
  const tracker = clip && videoEditClipTracker(document, clip, trackerId)
  if (!clip || !tracker) return undefined
  setVideoEditTrackResults(videoEditTrackResults())
  return videoEditTrackerBox(tracker.key, videoEditClipSourceTimeUs(document, clip, frame))
}
export async function readVideoEditTrackingPlacement(projectId: string, sequenceId: string, clipId: string, frame: number): Promise<VideoEditClip | undefined> {
  const document = videoEditComposition(requireVideoEditInstance(projectId).document, sequenceId)
  const clip = document.clips.find(clip => clip.id === clipId)
  if (!clip) return undefined
  setVideoEditTrackResults(videoEditTrackResults())
  return (await applyVideoEditClipFollow(document, [clip], frame))[0]
}
/** 跟随用的一帧跟踪（框与姿态），与渲染 Worker 同一读取。 */
export async function readVideoEditTrackingFollow(projectId: string, sequenceId: string, clipId: string, trackerId: string, frame: number): Promise<VideoEditFollowTrack | undefined> {
  const instance = requireVideoEditInstance(projectId)
  const document = videoEditComposition(instance.document, sequenceId)
  const clip = document.clips.find(entry => entry.id === clipId)
  const tracker = clip && videoEditClipTracker(document, clip, trackerId)
  if (!clip || !tracker) return undefined
  setVideoEditTrackResults(videoEditTrackResults())
  return videoEditTrackerFollowTrack(tracker.key, tracker.tracker, videoEditClipSourceTimeUs(document, clip, frame), videoEditClipPictureSize(document, clip))
}
export async function readVideoEditTrackingGeometry(projectId: string, sequenceId: string, clipId: string, trackerId: string, frame: number) {
  const document=videoEditComposition(requireVideoEditInstance(projectId).document,sequenceId)
  const clip=document.clips.find(c=>c.id===clipId); const tracker=clip && videoEditClipTracker(document,clip,trackerId)
  if (!clip || !tracker) return undefined
  setVideoEditTrackResults(videoEditTrackResults())
  return videoEditTrackerGeometry(tracker.key,videoEditClipSourceTimeUs(document,clip,frame))
}
/**
 * Bind at the current frame without moving the element. Late reads cannot change a newer document or playhead.
 * 指定 frame（助手）时在那一帧建立绑定，不要求播放头停在那里；rotation 跟随旋转（两点及以上、平面）。
 */
export async function bindVideoEditTracking(projectId: string, sequenceId: string, sourceId: string, trackerId: string, target: { clipId: string; scale: boolean; rotation?: boolean; cornerPin?: boolean } | { effectId: string; shapeId: string }, at?: number): Promise<void> {
  const instance = requireVideoEditInstance(projectId); const before = instance.document; const contentVersion = instance.contentVersion; const frame = at ?? instance.frame
  const track = await readVideoEditTrackingFollow(projectId, sequenceId, sourceId, trackerId, frame)
  if (!track) throw new Error('这一帧还没有跟踪框，请先完成跟踪或换到跟踪覆盖的帧。')
  const box = track.box
  if ('clipId' in target && target.cornerPin) {
    const geometry = await readVideoEditTrackingGeometry(projectId, sequenceId, sourceId, trackerId, frame)
    if (!geometry?.quad && !(geometry?.points?.length === 4 && geometry.points.every(point => point[2] > 0))) throw new Error('这一帧还没有可用的四角（平面跟踪或四点跟踪），请先跟踪或纠错。')
  }
  const placement = await readVideoEditTrackingPlacement(projectId, sequenceId, sourceId, frame)
  const follower = 'clipId' in target ? await readVideoEditTrackingPlacement(projectId, sequenceId, target.clipId, frame) : undefined
  if (!isVideoEditContentCurrent(instance, contentVersion) || at === undefined && instance.frame !== frame || instance.activeSequenceId !== sequenceId && at === undefined) throw new Error('画面已变化，请在当前帧重新绑定。')
  editVideoSequence(projectId, sequenceId, sequence => {
    const source = sequence.clips.find(clip => clip.id === sourceId)!
    if ('clipId' in target) {
      const clip = sequence.clips.find(clip => clip.id === target.clipId)
      if (!clip) throw new Error('要跟随的片段已移除。')
      clip.follow = videoEditFollowBinding(follower ?? clip, { clipId: sourceId, trackerId, placement: placement ?? source, picture: videoEditClipPictureSize({ ...before, ...sequence }, source) }, videoEditComposition(before, sequenceId), track, { scale: target.scale, rotation: target.rotation })
      if (follower) { clip.scale = follower.scale; clip.rotation = follower.rotation }
      if (target.cornerPin) clip.follow = {clipId:sourceId,trackerId,offsetX:0,offsetY:0,mode:'corner_pin'}
      assertVideoEditClipFollow(sequence, clip)
    } else {
      const effect = source.effects?.find(effect => effect.id === target.effectId)
      if (!isShapesMask(effect?.mask)) throw new Error('请选择同一片段上的手绘遮罩。')
      effect.mask.shapes = effect.mask.shapes.map((shape): VideoEditMaskShape => shape.id === target.shapeId ? { ...shape, follow: { trackerId, reference: [box[0], box[1], box[2], box[3]] } } : shape)
      assertVideoEditMaskTrackers(source, effect.mask)
    }
    return sequence
  })
}

type VideoEditBakedKey = 'x' | 'y' | 'scale' | 'rotation'
/** 关键帧精简容差：位置与缩放 1/10000，旋转 0.01°（与逐帧值的差在一个像素以内）。 */
const BAKE_TOLERANCE: Readonly<Record<VideoEditBakedKey, number>> = { x: 1e-4, y: 1e-4, scale: 1e-4, rotation: 0.01 }
/** 逐帧值去掉可由相邻保留点线性插值得到的点（误差不超过容差），首尾保留。 */
export function simplifyVideoEditBakedSamples(samples: ReadonlyArray<readonly [number, number]>, tolerance: number): Array<[number, number]> {
  if (samples.length <= 2) return samples.map(([t, v]) => [t, v])
  const kept: Array<[number, number]> = [[samples[0][0], samples[0][1]]]
  let anchor = 0
  for (let end = anchor + 2; end < samples.length; end++) {
    const [t0, v0] = samples[anchor]; const [t1, v1] = samples[end]
    const fits = samples.slice(anchor + 1, end).every(([t, v]) => Math.abs(v0 + (v1 - v0) * (t - t0) / (t1 - t0) - v) <= tolerance)
    if (!fits) { anchor = end - 1; kept.push([samples[anchor][0], samples[anchor][1]]) }
  }
  const last = samples[samples.length - 1]
  kept.push([last[0], last[1]])
  return kept
}

/**
 * 跟踪“应用”为关键帧（对标 AE 跟踪器的“应用”到变换）：把跟随在片段每一帧算出的位置、缩放、旋转写成线性关键帧，
 * 去掉跟随绑定，一步撤销。写之前等跟踪覆盖片段；角点贴合是透视变换，不能写成这四项。
 */
export async function bakeVideoEditClipFollow(projectId: string, sequenceId: string, clipId: string, signal?: AbortSignal): Promise<{ frames: number; keyframes: Record<VideoEditBakedKey, number> }> {
  const instance = requireVideoEditInstance(projectId)
  const composition = videoEditComposition(instance.document, sequenceId)
  const clip = composition.clips.find(entry => entry.id === clipId)
  if (!clip?.follow) throw new Error('这个片段没有跟随跟踪器，没有可应用的跟踪；先用 follow_video_edit_tracker 建立跟随。')
  if (clip.follow.mode === 'corner_pin') throw new Error('角点贴合是透视变换，不能写成位置、缩放、旋转关键帧；请保留实时跟随。')
  const target = composition.clips.find(entry => entry.id === clip.follow!.clipId)
  const tracker = target?.trackers?.find(entry => entry.id === clip.follow!.trackerId)
  if (!target || !tracker) throw new Error('被跟随的跟踪器已移除。')
  const request = videoEditTrackingRequest(instance.document, composition.frameRate, target, tracker)
  if (request && !request.definition.recording) await waitVideoEditTrackingDefinitions([request], signal)
  const contentVersion = instance.contentVersion
  setVideoEditTrackResults(videoEditTrackResults())
  const samples: Record<VideoEditBakedKey, Array<[number, number]>> = { x: [], y: [], scale: [], rotation: [] }
  for (let offset = 0; offset < clip.duration; offset++) {
    signal?.throwIfAborted()
    const frame = clip.start + offset
    const evaluated = evaluateVideoEditClip((await applyVideoEditClipFollow(composition, [clip], frame))[0], frame)
    for (const key of ['x', 'y', 'scale', 'rotation'] as const) samples[key].push([offset, evaluated[key]])
  }
  if (!isVideoEditContentCurrent(instance, contentVersion)) throw new Error('剪辑在应用跟踪期间被修改，请重新应用。')
  const keyframes = { x: 0, y: 0, scale: 0, rotation: 0 }
  editVideoSequence(projectId, sequenceId, sequence => {
    const current = sequence.clips.find(entry => entry.id === clipId)
    if (!current?.follow) throw new Error('跟随已被取消。')
    const curves = { ...current.curves }
    for (const key of ['x', 'y', 'scale', 'rotation'] as const) {
      const points = simplifyVideoEditBakedSamples(samples[key], BAKE_TOLERANCE[key])
      curves[key] = points.map(([time, value]) => ({ time, value: videoEditClipAnimatedValueSchemas[key].parse(Math.round(value * 1e6) / 1e6), interpolation: 'linear' as const }))
      keyframes[key] = points.length
    }
    delete current.follow
    current.curves = curves
    return sequence
  })
  logger.info('跟踪已应用为关键帧', { event: 'video_edit.tracking.baked', context: { frames: clip.duration, keyframes } })
  return { frames: clip.duration, keyframes }
}

/**
 * 录屏事件跟踪：在片段的某一帧（默认播放头）建立光标或前台窗口跟踪器。提示里记下那一刻的光标位置或窗口区域，
 * 结果由录制事件直接换算，不做视觉跟踪；region 是窗口里要跟的区域（片段画面归一化），省略为整个窗口。
 */
export async function createVideoEditRecordingTracker(projectId: string, sequenceId: string, clipId: string, input: { kind: 'cursor' | 'window'; frame?: number; region?: [number, number, number, number]; size?: number; name?: string }, signal: AbortSignal = new AbortController().signal): Promise<VideoEditTracker> {
  const instance = requireVideoEditInstance(projectId)
  const composition = videoEditComposition(instance.document, sequenceId)
  const clip = composition.clips.find(entry => entry.id === clipId)
  const source = clip?.kind === 'video' ? videoEditClipMedia(instance.document, clip)?.recordingCursor : undefined
  if (!clip || !source) throw new Error('这个片段没有录制时的光标与窗口记录：请选择从录屏导入的屏幕片段。')
  const frame = Math.max(clip.start, Math.min(clip.start + clip.duration - 1, input.frame ?? instance.frame))
  const events = new VideoEditRecordingCursorSource(readRecordingPage)
  let timeUs = videoEditClipSourceTimeUs(composition, clip, frame)
  let prompt: VideoEditTrackPrompt
  let recording: NonNullable<VideoEditTracker['recording']>
  if (input.kind === 'cursor') {
    let point: [number, number] | null = null
    // 光标这一刻隐藏或移出画面时往后找，最多 3 秒。
    for (let step = 0; step <= 30 && !point; step++) {
      const at = timeUs + step * 100_000 + source.recordingStartUs
      point = recordingCursorPointAt(await events.window(source, at, 0, signal), at)
      if (point) timeUs += step * 100_000
    }
    if (!point) throw new Error('这附近光标隐藏或不在录制画面里，请换一帧再建立光标跟踪。')
    const size = Math.max(0.01, Math.min(0.3, input.size ?? RECORDING_CURSOR_REGION))
    prompt = { timeUs, points: [[Math.max(0, Math.min(1, point[0] / source.width)), Math.max(0, Math.min(1, point[1] / source.height)), 1]], window: { feature: size, search: Math.max(size, 0.2) } }
    recording = { kind: 'cursor' }
  } else {
    const at = timeUs + source.recordingStartUs
    const foreground = recordingForegroundWindowAt(await events.windowEvents(source, at, signal), at)
    if (!foreground) throw new Error('这一帧没有可识别的前台窗口（窗口被排除、最小化或录制时不可用），请换一帧再试。')
    const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
    const region = input.region ?? [foreground.bounds.x / source.width, foreground.bounds.y / source.height, foreground.bounds.width / source.width, foreground.bounds.height / source.height]
    const x = clamp(region[0], 0, 0.998); const y = clamp(region[1], 0, 0.998)
    prompt = { timeUs, box: [x, y, clamp(region[2] - (x - region[0]), 0.002, 1), clamp(region[3] - (y - region[1]), 0.002, 1)] }
    recording = { kind: 'window', windowId: foreground.windowId }
  }
  signal.throwIfAborted()
  const tracker: VideoEditTracker = { id: crypto.randomUUID(), name: input.name ?? (input.kind === 'cursor' ? '光标' : '窗口'), method: input.kind === 'cursor' ? 'point' : 'box', prompts: [prompt], recording }
  let created: VideoEditTracker | undefined
  editVideoSequence(projectId, sequenceId, sequence => {
    const current = sequence.clips.find(entry => entry.id === clipId)
    if (!current) throw new Error('片段已移除。')
    created = putVideoEditTracker(instance.document, current, tracker)
    return sequence
  })
  logger.info('录屏事件跟踪已建立', { event: 'video_edit.tracking.recording_created', context: { kind: input.kind, region: Boolean(input.region) } })
  return created!
}
