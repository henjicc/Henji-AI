import { videoEditComposition, videoEditClipMedia, type VideoEditClip, type VideoEditDocument, type VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditTrackerSchema, normalizeVideoEditTracker, VIDEO_EDIT_MAX_TRACKERS, videoEditFollowBinding, type VideoEditTracker, type VideoEditTrackPrompt } from '@/core/videoEdit/tracking'
import { isShapesMask, type VideoEditEffectMask, type VideoEditMaskShape } from '@/core/videoEdit/effectMasks'
import { videoEditClipPictureSize } from '@/core/videoEdit/clipGeometry'
import { editVideoSequence, requireVideoEditInstance } from './videoEditService'
import { applyVideoEditClipFollow, setVideoEditTrackResults, videoEditClipSourceTimeUs, videoEditClipTracker, videoEditTrackerBox, videoEditTrackerGeometry } from '../engine/videoEditTrackResults'
import { videoEditTrackResults } from './videoEditTracking'
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
export function assertVideoEditMaskTrackers(clip: VideoEditClip, mask: VideoEditEffectMask | undefined): void {
  const ids = mask?.regionId === 'tracker' ? [mask.trackerId] : isShapesMask(mask) ? mask.shapes.flatMap(shape => shape.follow ? [shape.follow.trackerId] : []) : []
  for (const id of ids) if (!clip.trackers?.some(tracker => tracker.id === id)) throw new Error('跟踪器不属于此片段，请先在该片段下创建 video_edit.tracker。')
}
export function assertVideoEditClipFollow(sequence: VideoEditSequence, clip: VideoEditClip): void {
  if (!clip.follow) return
  if (clip.kind === 'audio' || clip.kind === 'adjustment') throw new Error('片段跟随只用于画面、文字或图形片段。')
  const target = sequence.clips.find(entry => entry.id === clip.follow!.clipId)
  if (!target?.trackers?.some(tracker => tracker.id === clip.follow!.trackerId)) throw new Error('follow 需要同一序列内已有跟踪器的片段，请先创建 video_edit.tracker。')
  if (clip.follow.mode === 'corner_pin' && ((clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'sequence') || target.trackers.find(t=>t.id===clip.follow!.trackerId)?.method !== 'planar')) throw new Error('角点贴合需要图片、视频或嵌套序列片段，以及平面跟踪器。')
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
    const xs = shape.points?.map(point => point[0]); const ys = shape.points?.map(point => point[1])
    const bounds = shape.box ?? [Math.min(...xs!), Math.min(...ys!), Math.max(...xs!) - Math.min(...xs!), Math.max(...ys!) - Math.min(...ys!)]
    const x = Math.max(0, bounds[0]); const y = Math.max(0, bounds[1]); const width = Math.min(1, bounds[0] + bounds[2]) - x; const height = Math.min(1, bounds[1] + bounds[3]) - y
    if (width < 0.002 || height < 0.002) throw new Error('遮罩需要覆盖画面内的物体才能跟踪。')
    const reference: [number, number, number, number] = [x, y, width, height]
    const tracker = putVideoEditTracker(instance.document, clip, { id: crypto.randomUUID(), name: '遮罩跟踪', method: 'box', prompts: [{ timeUs: videoEditClipSourceTimeUs(composition, clip, frame), box: reference }] })
    shape.follow = { trackerId: tracker.id, reference }
    return sequence
  })
}
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
export async function readVideoEditTrackingGeometry(projectId: string, sequenceId: string, clipId: string, trackerId: string, frame: number) {
  const document=videoEditComposition(requireVideoEditInstance(projectId).document,sequenceId)
  const clip=document.clips.find(c=>c.id===clipId); const tracker=clip && videoEditClipTracker(document,clip,trackerId)
  if (!clip || !tracker) return undefined
  setVideoEditTrackResults(videoEditTrackResults())
  return videoEditTrackerGeometry(tracker.key,videoEditClipSourceTimeUs(document,clip,frame))
}
/** Bind at the current frame without moving the element. Late reads cannot change a newer document or playhead. */
export async function bindVideoEditTracking(projectId: string, sequenceId: string, sourceId: string, trackerId: string, target: { clipId: string; scale: boolean; cornerPin?: boolean } | { effectId: string; shapeId: string }): Promise<void> {
  const instance = requireVideoEditInstance(projectId); const before = instance.document; const frame = instance.frame
  const box = await readVideoEditTrackingBox(projectId, sequenceId, sourceId, trackerId, frame)
  if (!box) throw new Error('这一帧还没有跟踪框，请先完成跟踪。')
  if ('clipId' in target && target.cornerPin && !(await readVideoEditTrackingGeometry(projectId,sequenceId,sourceId,trackerId,frame))?.quad) throw new Error('这一帧还没有可用的平面四角，请先跟踪或纠错。')
  const placement = await readVideoEditTrackingPlacement(projectId, sequenceId, sourceId, frame)
  const follower = 'clipId' in target ? await readVideoEditTrackingPlacement(projectId, sequenceId, target.clipId, frame) : undefined
  if (instance.document !== before || instance.frame !== frame || instance.activeSequenceId !== sequenceId) throw new Error('画面已变化，请在当前帧重新绑定。')
  editVideoSequence(projectId, sequenceId, sequence => {
    const source = sequence.clips.find(clip => clip.id === sourceId)!
    if ('clipId' in target) {
      const clip = sequence.clips.find(clip => clip.id === target.clipId)
      if (!clip) throw new Error('要跟随的片段已移除。')
      clip.follow = videoEditFollowBinding(follower ?? clip, { clipId: sourceId, trackerId, placement: placement ?? source, picture: videoEditClipPictureSize({ ...before, ...sequence }, source) }, videoEditComposition(before, sequenceId), box, target.scale)
      if (follower) clip.scale = follower.scale
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
