import { z } from 'zod'
import { codeMaterialKeyframeSchema } from './codeMaterialAnimation'
import { interpolateVideoEditKeyframe } from './keyframeInterpolation'
import { requireVideoEditBuiltinEffect, validateVideoEditBuiltinParams, type VideoEditBuiltinParams } from './builtinEffects'
import type { VideoEditClip } from './document'
import type { VideoEditEffect } from './compositing'

/** Same value/interpolation contract as source curves; clip-relative integer frames replace source microseconds. */
export const videoEditKeyframeSchema = codeMaterialKeyframeSchema.omit({ id: true, sourceInUs: true, sourceRemainder: true }).extend({ time: z.number().int().min(0).max(108_000), source: z.enum(['ducking', 'reframe']).optional(), reframeOrigin: z.object({ time: z.number().int().min(0).max(108_000), value: z.number().finite(), interpolation: z.enum(['linear', 'hold']) }).strict().optional(), duckingOrigin: z.object({ time: z.number().int().min(0).max(108_000), value: z.number().finite().min(0).max(2) }).strict().optional(), easeRange: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).refine(([a, b]) => b > a, '缓动区间终点须大于起点。').optional() })
export const videoEditKeyframesSchema = z.array(videoEditKeyframeSchema).max(256).superRefine((points, ctx) => {
  if (points.some((point, i) => i > 0 && point.time <= points[i - 1].time)) ctx.addIssue({ code: 'custom', message: '关键帧 time 必须按片段内帧升序排列，不能重复。' })
})
export const VIDEO_EDIT_ANIMATABLE_KEYS = ['x', 'y', 'scale', 'rotation', 'anchorX', 'anchorY', 'opacity', 'volume'] as const
export type VideoEditAnimatableKey = typeof VIDEO_EDIT_ANIMATABLE_KEYS[number]
export type VideoEditKeyframe = z.infer<typeof videoEditKeyframeSchema>
export type VideoEditKeyframes = VideoEditKeyframe[]
export const videoEditCurvesSchema = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), videoEditKeyframesSchema).superRefine((curves, ctx) => {
  if (Object.keys(curves).length > 128 || Object.values(curves).reduce((n, points) => n + points.length, 0) > 4096) ctx.addIssue({ code: 'custom', message: '关键帧最多128项及4096个点，每项最多256个。' })
})
export const videoEditClipCurvesSchema = z.partialRecord(z.enum(VIDEO_EDIT_ANIMATABLE_KEYS), videoEditKeyframesSchema)
export type VideoEditCurves = z.infer<typeof videoEditCurvesSchema>

/** Sorted persisted tracks: bounded binary search, no per-sample sort/parse. */
export function evaluateVideoEditKeyframes<T extends VideoEditKeyframe['value']>(points: readonly VideoEditKeyframe[] | undefined, time: number, fallback: T): T {
  if (!points?.length) return fallback
  if (time <= points[0].time) return points[0].value as T
  const last = points[points.length - 1]
  if (time >= last.time) return last.value as T
  let low = 0; let high = points.length - 1
  while (high - low > 1) { const middle = (low + high) >> 1; if (points[middle].time <= time) low = middle; else high = middle }
  const left = points[low]; const right = points[high]
  return interpolateVideoEditKeyframe(left.value, right.value, (time - left.time) / (right.time - left.time), left.interpolation, left.easeRange) as T
}
export function putVideoEditKeyframe(points: readonly VideoEditKeyframe[] | undefined, point: VideoEditKeyframe): VideoEditKeyframes {
  return videoEditKeyframesSchema.parse([...(points ?? []).filter(value => value.time !== point.time), point].sort((a, b) => a.time - b.time))
}
/** Provenance includes its original value/time: generic read-modify-write remains exact, edited points become manual. */
export function isVideoEditDuckingKeyframe(point: VideoEditKeyframe): boolean {
  return point.source === 'ducking' && (!point.duckingOrigin || point.time === point.duckingOrigin.time && point.value === point.duckingOrigin.value && point.interpolation === 'linear' && !point.easeRange)
}
export function isVideoEditReframeKeyframe(point: VideoEditKeyframe): boolean {
  return point.source === 'reframe' && Boolean(point.reframeOrigin && point.time === point.reframeOrigin.time && point.value === point.reframeOrigin.value && point.interpolation === point.reframeOrigin.interpolation && !point.easeRange)
}
function remapVideoEditReframeOrigin(point: VideoEditKeyframe, time: number, value: VideoEditKeyframe['value'] = point.value): Partial<VideoEditKeyframe> {
  return isVideoEditReframeKeyframe(point) ? { source: 'reframe', reframeOrigin: { time, value: value as number, interpolation: point.interpolation as 'linear' | 'hold' } } : {}
}
/** Once a generated point is hand edited it belongs to the user, including interpolation edits. */
export function claimVideoEditManualKeyframes(points: VideoEditKeyframes, previous: VideoEditKeyframes | undefined): VideoEditKeyframes {
  return points.map(point => {
    const old = previous?.find(value => value.time === point.time)
    if (!point.source || old && JSON.stringify(old) === JSON.stringify(point)) return point
    const { source: _source, duckingOrigin: _origin, reframeOrigin: _reframeOrigin, ...manual } = point
    return manual
  })
}
/** Shared motion/curve write contract for UI and generated algorithms. */
export function writeVideoEditClipKeyframes(clip: VideoEditClip, key: VideoEditAnimatableKey, points: VideoEditKeyframes, manual = true): VideoEditClip {
  const parsed = videoEditKeyframesSchema.parse(points)
  const curves = { ...clip.curves, [key]: manual ? claimVideoEditManualKeyframes(parsed, clip.curves?.[key]) : parsed }
  if (!points.length) delete curves[key]
  return { ...clip, curves }
}
export function videoEditClipValue(clip: VideoEditClip, key: VideoEditAnimatableKey, timelineFrame: number): number {
  return evaluateVideoEditKeyframes(clip.curves?.[key], timelineFrame - clip.start, clip[key] ?? 0.5)
}
export function evaluateVideoEditEffect(effect: VideoEditEffect, time: number): VideoEditEffect {
  if (!effect.builtin || !effect.builtin.curves) return effect
  const params = evaluateVideoEditBuiltinParameters(effect.builtin, time)
  return { ...effect, builtin: { ...effect.builtin, params } }
}
/** Optional reusable output avoids allocating parameter objects in sample-level audio automation. */
export function evaluateVideoEditBuiltinParameters(builtin: { id: string; params: VideoEditBuiltinParams; curves?: VideoEditCurves }, time: number, params: VideoEditBuiltinParams = { ...builtin.params }): VideoEditBuiltinParams {
  for (const param of requireVideoEditBuiltinEffect(builtin.id).params) params[param.key] = evaluateVideoEditKeyframes(builtin.curves?.[param.key], time, builtin.params[param.key] ?? param.default)
  return params
}
/** Applied after tracking: animated x/y offset its live base; scale multiplies it. */
export function evaluateVideoEditClip(clip: VideoEditClip, timelineFrame: number): VideoEditClip {
  const values: Partial<Record<VideoEditAnimatableKey, number>> = {}
  for (const key of VIDEO_EDIT_ANIMATABLE_KEYS) if (clip.curves?.[key]?.length) {
    const value = videoEditClipValue(clip, key, timelineFrame)
    values[key] = clip.follow && (key === 'x' || key === 'y') ? clip[key] + value : clip.follow && key === 'scale' ? clip.scale * value : value
  }
  return { ...clip, ...values, ...(clip.effects ? { effects: clip.effects.map(effect => evaluateVideoEditEffect(effect, timelineFrame - clip.start)) } : {}) }
}
export function assertVideoEditKeyframeTimes(curves: VideoEditCurves | undefined, duration: number, title: string): void {
  for (const [key, points] of Object.entries(curves ?? {})) for (const point of points) if (point.time >= duration) throw new Error(`${title} ${key}.keyframes 的 time 越界：允许片段内 0–${duration - 1} 帧。`)
}
export function assertVideoEditBuiltinCurves(builtin: { id: string; curves?: VideoEditCurves }): void {
  const definition = requireVideoEditBuiltinEffect(builtin.id)
  for (const [key, points] of Object.entries(builtin.curves ?? {})) {
    const param = definition.params.find(param => param.key === key)
    if (!param) throw new Error(`参数 ${key}.keyframes 不存在；可用：${definition.params.map(param => param.key).join('、')}。`)
    for (const point of points) {
      validateVideoEditBuiltinParams(builtin.id, { [key]: point.value })
      if ((param.type === 'boolean' || param.type === 'enum' || param.type === 'curve' || param.type === 'lut') && point.interpolation !== 'hold') throw new Error(`${param.name}.keyframes 只能用 hold 定格插值。`)
    }
  }
}
/** Trim/split preserve evaluated boundary values; no out-of-range points enter persistence. */
export function sliceVideoEditCurves(curves: VideoEditCurves | undefined, offset: number, duration: number): VideoEditCurves | undefined {
  if (!curves) return undefined
  return Object.fromEntries(Object.entries(curves).map(([key, points]) => {
    if (!points.length) return [key, []]
    const at = (time: number): VideoEditKeyframe => {
      const left = [...points].reverse().find(point => point.time <= time) ?? points[0]
      const value = evaluateVideoEditKeyframes(points, time, points[0].value)
      return { time: time - offset, value, interpolation: left.interpolation, ...remapVideoEditReframeOrigin(left, time - offset, value), ...(isVideoEditDuckingKeyframe(left) ? { source: 'ducking' as const, duckingOrigin: { time: time - offset, value: value as number } } : {}) }
    }
    const end = offset + duration - 1
    const sliced = points.filter(point => point.time >= offset && point.time <= end).map(point => ({ ...point, time: point.time - offset, ...remapVideoEditReframeOrigin(point, point.time - offset), ...(isVideoEditDuckingKeyframe(point) ? { duckingOrigin: { time: point.time - offset, value: point.value as number } } : {}) }))
    if (points[0].time < offset && !sliced.some(point => point.time === 0)) sliced.unshift(at(offset))
    if (points[points.length - 1].time > end && !sliced.some(point => point.time === duration - 1)) sliced.push(at(end))
    if (!sliced.length) sliced.push(at(offset))
    for (let i = 0; i < sliced.length - 1; i++) {
      const time = sliced[i].time + offset
      let leftIndex = points.length - 1
      while (leftIndex >= 0 && points[leftIndex].time > time) leftIndex--
      const left = points[leftIndex]; const right = points[leftIndex + 1]
      if (left?.interpolation === 'ease' && right) {
        const [a, b] = left.easeRange ?? [0, 1]
        sliced[i].easeRange = [a + (b - a) * (time - left.time) / (right.time - left.time), a + (b - a) * (sliced[i + 1].time + offset - left.time) / (right.time - left.time)]
      }
    }
    return [key, sliced]
  }))
}
export function sliceVideoEditClipKeyframes(clip: VideoEditClip, offset: number, duration: number): VideoEditClip {
  if (offset === 0 && duration === clip.duration) return clip
  return { ...clip, ...(clip.curves ? { curves: sliceVideoEditCurves(clip.curves, offset, duration) } : {}), ...(clip.effects ? { effects: clip.effects.map(effect => effect.builtin?.curves ? { ...effect, builtin: { ...effect.builtin, curves: sliceVideoEditCurves(effect.builtin.curves, offset, duration) } } : effect) } : {}) }
}
export function rescaleVideoEditClipKeyframes(clip: VideoEditClip, convert: (time: number) => number, duration: number): VideoEditClip {
  const map = (curves: VideoEditCurves | undefined): VideoEditCurves | undefined => curves && Object.fromEntries(Object.entries(curves).map(([key, points]) => {
    const unique = new Map(points.map(point => { const time = Math.max(0, Math.min(duration - 1, convert(point.time))); return [time, { ...point, time, ...remapVideoEditReframeOrigin(point, time), ...(isVideoEditDuckingKeyframe(point) ? { duckingOrigin: { time, value: point.value as number } } : {}) }] }))
    return [key, [...unique.values()].sort((a, b) => a.time - b.time)]
  }))
  return { ...clip, ...(clip.curves ? { curves: map(clip.curves) } : {}), ...(clip.effects ? { effects: clip.effects.map(effect => effect.builtin?.curves ? { ...effect, builtin: { ...effect.builtin, curves: map(effect.builtin.curves) } } : effect) } : {}) }
}
