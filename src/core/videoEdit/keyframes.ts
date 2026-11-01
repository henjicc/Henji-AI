import { z } from 'zod'
import { SPATIAL_KEYS } from './spatialSchema'
import { videoEditKeyframesSchema, type VideoEditKeyframe, type VideoEditKeyframes } from './keyframeSchema'
export { videoEditKeyframeSchema, videoEditKeyframesSchema, type VideoEditKeyframe, type VideoEditKeyframes } from './keyframeSchema'
import { clampVideoEditAnimationValue, interpolateVideoEditKeyframe, VIDEO_EDIT_DEFAULT_BEZIER } from './keyframeInterpolation'
import { isRemovedVideoEditBuiltinEffect, requireVideoEditBuiltinEffect, videoEditBuiltinParamValue, type VideoEditBuiltinParams } from './builtinEffects'
import type { VideoEditClip } from './document'
import type { VideoEditEffect } from './compositing'

export const videoEditClipAnimatedValueSchemas = {
  depth: z.number().finite(), rotationX: z.number().finite(), rotationY: z.number().finite(), anchorDepth: z.number().finite(),
  x: z.number().finite().min(-2).max(2), y: z.number().finite().min(-2).max(2),
  scale: z.number().min(.01).max(4), rotation: z.number().min(-360).max(360),
  anchorX: z.number().min(0).max(1), anchorY: z.number().min(0).max(1),
  opacity: z.number().min(0).max(1), volume: z.number().min(0).max(2),
}
export function videoEditKeyframeValues(point: VideoEditKeyframe): VideoEditKeyframe['value'][] { return [point.value, ...(point.easeValues ?? [])] }
export const VIDEO_EDIT_ANIMATABLE_KEYS = ['x', 'y', 'scale', 'rotation', 'anchorX', 'anchorY', 'opacity', 'volume', ...SPATIAL_KEYS] as const
export type VideoEditAnimatableKey = typeof VIDEO_EDIT_ANIMATABLE_KEYS[number]
export const videoEditCurvesSchema = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), videoEditKeyframesSchema)
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
  return interpolateVideoEditKeyframe(left.value, right.value, (time - left.time) / (right.time - left.time), left.interpolation, left.easeRange, left.bezier, left.easeValues) as T
}
export function putVideoEditKeyframe(points: readonly VideoEditKeyframe[] | undefined, point: VideoEditKeyframe): VideoEditKeyframes {
  return videoEditKeyframesSchema.parse([...(points ?? []).filter(value => value.time !== point.time), point].sort((a, b) => a.time - b.time))
}
/** Provenance includes its original value/time: generic read-modify-write remains exact, edited points become manual. */
export function isVideoEditDuckingKeyframe(point: VideoEditKeyframe): boolean {
  return point.source === 'ducking' && (!point.duckingOrigin || point.time === point.duckingOrigin.time && point.value === point.duckingOrigin.value && point.interpolation === 'linear' && !point.easeRange && !point.bezier && !point.easeValues)
}
export function isVideoEditReframeKeyframe(point: VideoEditKeyframe): boolean {
  return isVideoEditMotionKeyframe(point, 'reframe')
}
export function isVideoEditMotionKeyframe(point: VideoEditKeyframe, source: 'reframe' | 'screen_attention'): boolean {
  return point.source === source && Boolean(point.reframeOrigin && point.time === point.reframeOrigin.time && point.value === point.reframeOrigin.value && point.interpolation === point.reframeOrigin.interpolation && !point.easeRange && !point.bezier && !point.easeValues)
}
function remapVideoEditMotionOrigin(point: VideoEditKeyframe, time: number, value: VideoEditKeyframe['value'] = point.value): Partial<VideoEditKeyframe> {
  return (isVideoEditReframeKeyframe(point) || isVideoEditMotionKeyframe(point, 'screen_attention')) ? { source: point.source, reframeOrigin: { time, value: value as number, interpolation: point.interpolation as 'linear' | 'hold' } } : {}
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
  const section = key === 'volume' ? 'audio' : key === 'opacity' ? 'opacity' : 'motion'
  if (clip.disabledIntrinsicSections?.includes(section)) return key === 'scale' || key === 'opacity' ? 1 : key === 'volume' ? (clip.kind === 'adjustment' ? 0 : 1) : key === 'anchorX' || key === 'anchorY' ? 0.5 : 0
  const spatial = (SPATIAL_KEYS as readonly string[]).includes(key)
  if (spatial && clip.spatial?.enabled !== true) return 0
  return clampVideoEditAnimationValue(evaluateVideoEditKeyframes(clip.curves?.[key], timelineFrame - clip.start, clip[key] ?? (spatial ? 0 : 0.5)), videoEditClipAnimatedValueSchemas[key]) as number
}
export function evaluateVideoEditEffect(effect: VideoEditEffect, time: number): VideoEditEffect {
  if (!effect.builtin || !effect.builtin.curves) return effect
  const params = evaluateVideoEditBuiltinParameters(effect.builtin, time)
  return { ...effect, builtin: { ...effect.builtin, params } }
}
/** Optional reusable output avoids allocating parameter objects in sample-level audio automation. */
export function evaluateVideoEditBuiltinParameters(builtin: { id: string; params: VideoEditBuiltinParams; curves?: VideoEditCurves }, time: number, params: VideoEditBuiltinParams = { ...builtin.params }): VideoEditBuiltinParams {
  // 已移除的效果不渲染，参数原样保留。
  if (isRemovedVideoEditBuiltinEffect(builtin.id)) return params
  for (const param of requireVideoEditBuiltinEffect(builtin.id).params) {
    const points = builtin.curves?.[param.key]
    const value = param.storedKeyframes === 'first' && points?.length ? points[0].value as VideoEditBuiltinParams[string] : evaluateVideoEditKeyframes(points, time, builtin.params[param.key] ?? param.default)
    params[param.key] = param.type === 'number' && typeof value === 'number' ? Math.max(param.min, Math.min(param.max, value)) : value
  }
  return params
}
/** Applied after tracking: animated x/y offset its live base; scale multiplies it. */
export function evaluateVideoEditClip(clip: VideoEditClip, timelineFrame: number): VideoEditClip {
  const values: Partial<Record<VideoEditAnimatableKey, number>> = {}
  for (const key of VIDEO_EDIT_ANIMATABLE_KEYS) {
    if ((SPATIAL_KEYS as readonly string[]).includes(key) && clip[key] === undefined && !clip.curves?.[key]?.length) continue
    if (!clip.disabledIntrinsicSections?.includes(key === 'volume' ? 'audio' : key === 'opacity' ? 'opacity' : 'motion') && !clip.curves?.[key]?.length) continue
    const value = videoEditClipValue(clip, key, timelineFrame)
    const followed = !clip.disabledIntrinsicSections?.includes('motion') && clip.follow
    // 跟随带来的旋转增量（变换跟随）叠加在旋转关键帧之上，与 x/y 偏移、缩放倍率同一规则。
    values[key] = followed && (key === 'x' || key === 'y') ? clip[key] + value : followed && key === 'scale' ? clip.scale * value : followed && key === 'rotation' ? value + ((clip as VideoEditClip & { trackingRotation?: number }).trackingRotation ?? 0) : value
  }
  const result = { ...clip, ...values, ...(clip.effects ? { effects: clip.effects.map(effect => evaluateVideoEditEffect(effect, timelineFrame - clip.start)) } : {}) }
  if (clip.disabledIntrinsicSections?.includes('text')) result.text = ''
  if (clip.disabledIntrinsicSections?.includes('textStyle')) delete result.textStyle
  if (clip.disabledIntrinsicSections?.includes('motion')) { delete result.follow; delete (result as VideoEditClip & { trackingQuad?: unknown }).trackingQuad; delete (result as VideoEditClip & { trackingRotation?: unknown }).trackingRotation }
  return result
}
export function assertVideoEditKeyframeTimes(curves: VideoEditCurves | undefined, duration: number, title: string): void {
  for (const [key, points] of Object.entries(curves ?? {})) for (const point of points) if (point.time > duration) throw new Error(`${title} ${key}.keyframes 的 time 越界：允许 0–${duration} 帧（末点只用于片段右边界插值）。`)
}
/**
 * 写入内置效果关键帧时的严格校验：参数必须存在、可动画，值在硬范围内，选项类参数只能定格插值。
 * `stored` 是写入前存着的关键帧：`storedKeyframes: 'first'` 的参数，存档留下的关键帧原样带回可以（改别的参数时整表写回），新写或改动不行。
 */
export function validateVideoEditBuiltinCurves(builtin: { id: string; curves?: VideoEditCurves }, stored?: VideoEditCurves): void {
  const definition = requireVideoEditBuiltinEffect(builtin.id)
  for (const [key, points] of Object.entries(builtin.curves ?? {})) {
    const param = definition.params.find(param => param.key === key)
    if (!param) throw new Error(`参数 ${key}.keyframes 不存在；可用：${definition.params.map(param => param.key).join('、')}。`)
    if (param.storedKeyframes === 'first' && points.length && JSON.stringify(points) !== JSON.stringify(stored?.[key] ?? [])) throw new Error(`${param.name}（${key}）不支持关键帧，请直接修改参数。`)
    for (const point of points) for (const value of videoEditKeyframeValues(point)) videoEditBuiltinParamValue(param, value)
  }
  assertVideoEditBuiltinCurves(builtin)
}
/**
 * 存档里内置效果关键帧的校验，与 `videoEditBuiltinEffectIssue` 同一个口径：已移除的效果、已不存在的参数原样读入，
 * 超出当前范围的值求值时钳制，`storedKeyframes: 'first'` 的参数上的关键帧照样读入（求值取第一个关键帧）；类型不对或插值不合规才报错。
 */
export function assertVideoEditBuiltinCurves(builtin: { id: string; curves?: VideoEditCurves }): void {
  if (isRemovedVideoEditBuiltinEffect(builtin.id)) return
  const definition = requireVideoEditBuiltinEffect(builtin.id)
  for (const [key, points] of Object.entries(builtin.curves ?? {})) {
    const param = definition.params.find(param => param.key === key)
    if (!param) continue
    if (param.animatable === false && param.storedKeyframes !== 'first' && points.length) throw new Error(`${param.name}（${key}）不支持关键帧，请直接修改参数。`)
    for (const point of points) {
      for (const value of videoEditKeyframeValues(point)) videoEditBuiltinParamValue(param, value, true)
      if ((param.type === 'boolean' || param.type === 'enum' || param.type === 'curve' || param.type === 'lut') && point.interpolation !== 'hold') throw new Error(`${param.name}.keyframes 只能用 hold 定格插值。`)
    }
  }
}
/** 连续范围保留右边界控制点及独立原值锚点，切点两侧可以有不同的值。 */
export function sliceVideoEditCurves(curves: VideoEditCurves | undefined, offset: number, duration: number, clamp: (key: string, value: VideoEditKeyframe['value']) => VideoEditKeyframe['value'] = (_key, value) => value, extent: 'frames' | 'continuous' | 'independent' = 'frames'): VideoEditCurves | undefined {
  if (!curves) return undefined
  return Object.fromEntries(Object.entries(curves).map(([key, points]) => {
    if (!points.length) return [key, []]
    const at = (time: number): VideoEditKeyframe => {
      const left = [...points].reverse().find(point => point.time <= time) ?? points[0]
      const value = clamp(key, evaluateVideoEditKeyframes(points, time, points[0].value))
      return { time: time - offset, value, interpolation: left.interpolation, ...remapVideoEditMotionOrigin(left, time - offset, value), ...(isVideoEditDuckingKeyframe(left) ? { source: 'ducking' as const, duckingOrigin: { time: time - offset, value: value as number } } : {}) }
    }
    const endTime = extent === 'frames' ? duration - 1 : duration
    const end = offset + endTime
    const sliced = points.filter(point => point.time >= offset && point.time <= end).map(point => ({ ...point, time: point.time - offset, ...remapVideoEditMotionOrigin(point, point.time - offset), ...(isVideoEditDuckingKeyframe(point) ? { duckingOrigin: { time: point.time - offset, value: point.value as number } } : {}) }))
    if ((points[0].time < offset || extent !== 'frames') && !sliced.some(point => point.time === 0)) sliced.unshift(at(offset))
    if (points[points.length - 1].time > end && !sliced.some(point => point.time === endTime)) sliced.push(at(end))
    if (!sliced.length) sliced.push(at(offset))
    for (let i = 0; i < sliced.length - 1; i++) {
      const time = sliced[i].time + offset
      let leftIndex = points.length - 1
      while (leftIndex >= 0 && points[leftIndex].time > time) leftIndex--
      const left = points[leftIndex]; const right = points[leftIndex + 1]
      if (extent === 'independent') {
        const point = sliced[i]
        delete point.easeRange; delete point.easeValues; delete point.bezier
        if (!left || !right || left.interpolation === 'hold') { point.interpolation = 'hold'; continue }
        let [a, b] = left.interpolation === 'linear' ? [0, 1] : left.easeRange ?? [0, 1]
        point.interpolation = left.interpolation === 'bezier' ? 'bezier' : 'ease'
        point.bezier = left.interpolation === 'linear' ? [1 / 3, 1 / 3, 2 / 3, 2 / 3] : left.bezier ?? VIDEO_EDIT_DEFAULT_BEZIER
        if (left.interpolation === 'ease' && !left.easeValues) {
          // easeRange 的两端值是归一化端值，用端点导数转成同一段三次贝塞尔。
          const scale = (b - a) / (b * b * (3 - 2 * b) - a * a * (3 - 2 * a))
          point.bezier = [1 / 3, scale * 2 * a * (1 - a), 2 / 3, 1 - scale * 2 * b * (1 - b)]
          a = 0; b = 1
        }
        point.easeValues = left.easeValues ?? [left.value, right.value]
        point.easeRange = [a + (b - a) * (time - left.time) / (right.time - left.time), a + (b - a) * (sliced[i + 1].time + offset - left.time) / (right.time - left.time)]
      } else if ((left?.interpolation === 'ease' || left?.interpolation === 'bezier') && right) {
        const [a, b] = left.easeRange ?? [0, 1]
        if (left.bezier) sliced[i].bezier = left.bezier
        if (left.easeValues || left.interpolation === 'bezier') sliced[i].easeValues = left.easeValues ?? [left.value, right.value]
        sliced[i].easeRange = [a + (b - a) * (time - left.time) / (right.time - left.time), a + (b - a) * (sliced[i + 1].time + offset - left.time) / (right.time - left.time)]
      }
    }
    if (extent === 'independent' && sliced.at(-1)!.time < endTime) {
      const last = sliced.at(-1)!
      last.interpolation = 'hold'; delete last.easeRange; delete last.easeValues; delete last.bezier
    }
    return [key, sliced]
  }))
}
export function sliceVideoEditBuiltinCurves(builtin: { id: string; curves?: VideoEditCurves }, offset: number, duration: number): VideoEditCurves | undefined {
  const params = isRemovedVideoEditBuiltinEffect(builtin.id) ? [] : requireVideoEditBuiltinEffect(builtin.id).params
  return sliceVideoEditCurves(builtin.curves, offset, duration, (key, value) => {
    const param = params.find(param => param.key === key)
    if (!param) return value
    return param.type === 'number' && typeof value === 'number' ? Math.max(param.min, Math.min(param.max, value)) : value
  }, 'continuous')
}
export function sliceVideoEditClipKeyframes(clip: VideoEditClip, offset: number, duration: number): VideoEditClip {
  if (offset === 0 && duration === clip.duration) return clip
  return { ...clip, ...(clip.curves ? { curves: sliceVideoEditCurves(clip.curves, offset, duration, (key, value) => clampVideoEditAnimationValue(value, videoEditClipAnimatedValueSchemas[key as VideoEditAnimatableKey]) as VideoEditKeyframe['value'], 'continuous') } : {}), ...(clip.effects ? { effects: clip.effects.map(effect => effect.builtin?.curves ? { ...effect, builtin: { ...effect.builtin, curves: sliceVideoEditBuiltinCurves(effect.builtin, offset, duration) } } : effect) } : {}) }
}
export function rescaleVideoEditCurves(curves: VideoEditCurves | undefined, convert: (time: number) => number, duration: number): VideoEditCurves | undefined {
  return curves && Object.fromEntries(Object.entries(curves).map(([key, points]) => {
    const unique = new Map(points.map(point => { const time = Math.max(0, Math.min(duration - 1, convert(point.time))); return [time, { ...point, time, ...remapVideoEditMotionOrigin(point, time), ...(isVideoEditDuckingKeyframe(point) ? { duckingOrigin: { time, value: point.value as number } } : {}) }] }))
    return [key, [...unique.values()].sort((a, b) => a.time - b.time)]
  }))
}
export interface VideoEditCurveTimeMap {
  sourceRange: readonly [number, number]
  targetRange: readonly [number, number] | null
}
/** 片段与序列事件共用切片/缩放；零长来源表示插入的静止时间，不用 epsilon 表达切口。 */
export function mapVideoEditCurvesClock(curves: VideoEditCurves | undefined, maps: readonly VideoEditCurveTimeMap[]): VideoEditCurves | undefined {
  if (!curves || !maps.length) return curves
  return Object.fromEntries(Object.entries(curves).map(([key, points]) => {
    if (!points.length) return [key, []]
    const spans: VideoEditCurveTimeMap[] = []
    let cursor = 0
    for (const map of [...maps].sort((a, b) => a.sourceRange[0] - b.sourceRange[0])) {
      if (map.sourceRange[0] > cursor) spans.push({ sourceRange: [cursor, map.sourceRange[0]], targetRange: [cursor, map.sourceRange[0]] })
      spans.push(map)
      cursor = Math.max(cursor, map.sourceRange[1])
    }
    if (cursor <= points.at(-1)!.time) spans.push({ sourceRange: [cursor, points.at(-1)!.time + 1], targetRange: [cursor, points.at(-1)!.time + 1] })
    const collected = new Map<number, VideoEditKeyframe>()
    for (const map of spans.filter(span => span.targetRange).sort((a, b) => a.targetRange![0] - b.targetRange![0])) {
      const [from, to] = map.sourceRange, [start, end] = map.targetRange!
      const sliced = from === to
        ? { [key]: [{ time: 0, value: evaluateVideoEditKeyframes(points, from, points[0].value), interpolation: 'hold' as const }] }
        : sliceVideoEditCurves({ [key]: points }, from, to - from, undefined, 'independent')
      const moved = rescaleVideoEditCurves(sliced, time => from === to ? start : Math.round(start + time * (end - start) / (to - from)), end + 1)
      for (const point of moved?.[key] ?? []) collected.set(point.time, point)
    }
    return [key, [...collected.values()].sort((a, b) => a.time - b.time)]
  }))
}
export function rescaleVideoEditClipKeyframes(clip: VideoEditClip, convert: (time: number) => number, duration: number): VideoEditClip {
  const map = (curves: VideoEditCurves | undefined): VideoEditCurves | undefined => rescaleVideoEditCurves(curves, convert, duration + 1)
  return { ...clip, ...(clip.curves ? { curves: map(clip.curves) } : {}), ...(clip.effects ? { effects: clip.effects.map(effect => effect.builtin?.curves ? { ...effect, builtin: { ...effect.builtin, curves: map(effect.builtin.curves) } } : effect) } : {}) }
}
