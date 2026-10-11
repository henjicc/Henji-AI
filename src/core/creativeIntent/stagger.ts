import type { VideoEditClip } from '../videoEdit/document'
import { evaluateVideoEditKeyframes, sliceVideoEditCurves, videoEditClipAnimatedValueSchemas, type VideoEditKeyframe } from '../videoEdit/keyframes'
import { mergeMotionClipCurves } from '../videoEdit/motionDraft'
import type { CompiledMotion, MotionCurveKey } from './motionCompiler'

const KEYS: readonly MotionCurveKey[] = ['x', 'y', 'rotation', 'scale', 'anchorX', 'anchorY']

export function hasStaggerMotion(clip: VideoEditClip): boolean {
  return KEYS.some(key => (clip.curves?.[key]?.length ?? 0) > 1)
}

export function staggerMotionRange(clip: VideoEditClip): [number, number] | undefined {
  let start = Infinity, end = -Infinity
  for (const key of KEYS) for (const point of clip.curves?.[key] ?? []) { start = Math.min(start, point.time); end = Math.max(end, point.time) }
  return end > start ? [start, end] : undefined
}

/** Source-local interval; the first destination is delayed by one step, in caller-supplied order. */
export function staggerMotion(source: VideoEditClip, targets: readonly VideoEditClip[], range: readonly [number, number], stepFrames: number): VideoEditClip[] {
  const [start, end] = range
  if (!Number.isSafeInteger(stepFrames) || stepFrames < 0) throw new Error('错开帧数须为非负整数。')
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end >= source.duration) throw new Error('请选择源片段内有动作的有效区间。')
  if (!hasStaggerMotion(source)) throw new Error('源片段还没有动作。')
  if (new Set(targets.map(clip => clip.id)).size !== targets.length || targets.some(clip => clip.id === source.id)) throw new Error('目标片段不能重复或包含源片段。')
  const sliced = sliceVideoEditCurves(source.curves, start, end - start + 1)
  return targets.map((target, index) => {
    const delay = (index + 1) * stepFrames
    const span: [number, number] = [start + delay, end + delay]
    if (!Number.isSafeInteger(span[1]) || span[1] >= target.duration) throw new Error(`“${target.name}”放不下错开的动作，请延长片段或缩短区间。`)
    const curves: CompiledMotion['curves'] = {}
    for (const key of KEYS) {
      if (!source.curves?.[key]?.length) continue
      const convert = (value: VideoEditKeyframe['value']): number => {
        if (typeof value !== 'number') throw new Error('动作曲线须为数值。')
        const converted = key === 'scale' ? target.scale * value / source.scale : (target[key] ?? .5) + value - (source[key] ?? .5)
        if (!videoEditClipAnimatedValueSchemas[key].safeParse(converted).success) throw new Error(`“${target.name}”的动作超出可编辑范围，请调整基态。`)
        return converted
      }
      const points = sliced?.[key] ?? []
      curves[key] = points.map(point => ({ ...point, time: point.time + start + delay, value: convert(point.value), ...(point.easeValues ? { easeValues: point.easeValues.map(convert) as [number, number] } : {}) }))
      const at = (time: number): VideoEditKeyframe => ({ time: time + delay, value: convert(evaluateVideoEditKeyframes(source.curves?.[key], time, source[key] ?? .5)), interpolation: 'hold' })
      if (curves[key]![0]?.time !== span[0]) curves[key]!.unshift(at(start))
      if (curves[key]!.at(-1)?.time !== span[1]) curves[key]!.push(at(end))
    }
    return mergeMotionClipCurves(target, [{ takeId: source.id, range: span, curves, keyCount: Object.values(curves).reduce((sum, points) => sum + points.length, 0), maxErrors: {} }])
  })
}
