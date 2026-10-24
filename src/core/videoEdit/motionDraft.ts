import type { Pose } from '../creativeIntent/contracts'
import type { CompiledMotion, MotionCurveKey } from '../creativeIntent/motionCompiler'
import type { VideoEditClip, VideoEditComposition } from './document'
import { videoEditClipPictureSize } from './clipGeometry'
import { sliceVideoEditCurves, videoEditClipValue, writeVideoEditClipKeyframes, type VideoEditKeyframe } from './keyframes'

export function motionClipBase(clip: VideoEditClip): unknown {
  return { id: clip.id, itemId: clip.itemId, kind: clip.kind, start: clip.start, duration: clip.duration, sourceInUs: clip.sourceInUs, sourceRemainder: clip.sourceRemainder, speed: clip.speed, timeRemap: clip.timeRemap, x: clip.x, y: clip.y, rotation: clip.rotation, scale: clip.scale, scaleAspect: clip.scaleAspect, anchorX: clip.anchorX, anchorY: clip.anchorY, curves: clip.curves, follow: clip.follow, disabledIntrinsicSections: clip.disabledIntrinsicSections }
}
/** Include resolved source dimensions: fitting and ghost geometry must share the same picture. */
export function motionClipGeometry(composition: Pick<VideoEditComposition, 'width' | 'height' | 'pixelAspectRatio' | 'frameRate' | 'items' | 'media' | 'sequences'>, clip: VideoEditClip): unknown {
  return [composition.width, composition.height, composition.pixelAspectRatio, composition.frameRate, videoEditClipPictureSize(composition, clip)]
}
/** Clip offsets are measured from the composition center; they are not pointer coordinates. */
export function motionClipPose(clip: VideoEditClip, frame: number): Pose {
  const scale = videoEditClipValue(clip, 'scale', frame)
  return { position: [.5 + videoEditClipValue(clip, 'x', frame), .5 + videoEditClipValue(clip, 'y', frame)], rotationTurns: videoEditClipValue(clip, 'rotation', frame) / 360, scaleXY: [scale, scale * (clip.scaleAspect ?? 1)], pivot: [videoEditClipValue(clip, 'anchorX', frame), videoEditClipValue(clip, 'anchorY', frame)] }
}
/** Entire candidate is validated before the caller's single document transaction is committed. */
export function mergeMotionClipCurves(clip: VideoEditClip, motions: readonly CompiledMotion[]): VideoEditClip {
  let next = clip
  const occupied = new Map<MotionCurveKey, number>()
  for (const motion of [...motions].sort((a, b) => a.range[0] - b.range[0])) {
    const [start, end] = motion.range
    if (start < 0 || end < start || end >= clip.duration) throw new Error('示范超出片段范围，请缩短示范或延长片段后重试。')
    for (const key of Object.keys(motion.curves) as MotionCurveKey[]) {
      if ((occupied.get(key) ?? -1) >= start) throw new Error('两次示范覆盖同一时间，请选择采用哪一次。')
      occupied.set(key, end)
      const original = next.curves?.[key]
      const fallback = videoEditClipValue(next, key, next.start)
      const before: VideoEditKeyframe[] = start > 0 ? (original?.length ? sliceVideoEditCurves({ [key]: original }, 0, start)?.[key] ?? [] : [{ time: 0, value: fallback, interpolation: 'hold' }, ...(start > 1 ? [{ time: start - 1, value: fallback, interpolation: 'linear' as const }] : [])]) : []
      const after = end < clip.duration - 1 ? (original?.length ? (sliceVideoEditCurves({ [key]: original }, end + 1, clip.duration - end - 1)?.[key] ?? []).map(p => ({ ...p, time: p.time + end + 1 })) : [{ time: end + 1, value: fallback, interpolation: 'hold' as const }]) : []
      next = writeVideoEditClipKeyframes(next, key, [...before, ...motion.curves[key]!, ...after])
    }
  }
  return next
}
