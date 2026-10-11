import { videoEditMaskPathAnimationSchema, videoEditMaskPointSchema, samePathWinding, type VideoEditMaskPathAnimation, type VideoEditMaskPoint } from '../videoEdit/maskPathAnimation'
import { z } from 'zod'
import { videoEditClipSourceTimeAt, type VideoEditClipTiming } from '../videoEdit/clipSpeed'
import { videoEditSourceSeconds, type VideoEditRatio } from '../videoEdit/time'
import { fitPropertySamples, orderedPropertySamples, type PropertySample } from './propertyAdapter'
import { checkCancelled, CreativeIntentError, type ComputationControl } from './sampling'

export interface MaskPathPose { pointIds: string[]; points: VideoEditMaskPoint[] }
const poseSchema = z.object({ pointIds: z.array(z.string().min(1)).min(3), points: z.array(videoEditMaskPointSchema).min(3) }).strict()
export function compileMaskPathTake(clip: VideoEditClipTiming, rate: VideoEditRatio, picture: { width: number; height: number }, input: readonly PropertySample<MaskPathPose>[], control: ComputationControl = {}): VideoEditMaskPathAnimation {
  checkCancelled(control)
  if (!(picture.width > 0 && picture.height > 0 && Number.isFinite(picture.width) && Number.isFinite(picture.height))) throw new CreativeIntentError('picture-size', [], '路径需要有效的素材画面尺寸')
  const samples = orderedPropertySamples(input).map(s => ({ ...s, value: poseSchema.parse(s.value) }))
  const ids = samples[0].value.pointIds
  for (const s of samples) {
    checkCancelled(control)
    if (s.frame < clip.start || s.frame >= clip.start + clip.duration) throw new CreativeIntentError('clip-time', [], '示范帧必须位于目标片段内')
    if (JSON.stringify(s.value.pointIds) !== JSON.stringify(ids) || s.value.points.length !== ids.length) throw new CreativeIntentError('path-topology', [], '路径点数或点对应顺序变化，请重建或分段')
  }
  const ordered = clip.reverse ? [...samples].reverse() : samples
  const raw: VideoEditMaskPathAnimation = { pointIds: ids, keys: ordered.map(s => ({ sourceTimeUs: videoEditSourceSeconds(videoEditClipSourceTimeAt(clip, s.frame - clip.start, rate)) * 1e6, points: s.value.points, interpolation: 'linear' })) }
  videoEditMaskPathAnimationSchema.parse(raw)
  const short = Math.min(picture.width, picture.height)
  // Each cubic control uses vertex + handle; allocate half the Euclidean error budget to each.
  const tolerances = ids.flatMap(() => [0, 1, 0, 1, 0, 1].map(axis => .0005 * short / (2 * Math.SQRT2 * (axis === 0 ? picture.width : picture.height))))
  const kept = new Set(fitPropertySamples(samples.map(s => ({ ...s, value: s.value.points.flat() })), tolerances, control))
  const selected = ordered.flatMap((s, i) => kept.has(s.frame) ? [raw.keys[i]] : [])
  // Sparse chords may cross a degeneracy absent from the original segmented take.
  const safe = selected.every((key, i) => !i || samePathWinding(selected[i - 1].points, key.points))
  return videoEditMaskPathAnimationSchema.parse({ pointIds: ids, keys: safe ? selected : raw.keys })
}
