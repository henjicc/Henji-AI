import { combineWheelTints, COLOR_GRADE_V1_REMOVED_KEYS, legacyWhiteBalanceToKelvin, migrateColorGradeParamsV1 } from '../imaging/adjustments/colorGradeMigration'
import { interpolateVideoEditKeyframe } from './keyframeInterpolation'
import type { VideoEditCurves, VideoEditKeyframe } from './keyframes'

/** Same evaluation as `keyframes.ts::evaluateVideoEditKeyframes`, kept local so persistence migrations stay import-light. */
function evaluateVideoEditKeyframes(points: readonly VideoEditKeyframe[], time: number, fallback: number): number {
  if (!points.length) return fallback
  if (time <= points[0].time) return points[0].value as number
  const last = points[points.length - 1]
  if (time >= last.time) return last.value as number
  let low = 0; let high = points.length - 1
  while (high - low > 1) { const middle = (low + high) >> 1; if (points[middle].time <= time) low = middle; else high = middle }
  const left = points[low]; const right = points[high]
  return interpolateVideoEditKeyframe(left.value, right.value, (time - left.time) / (right.time - left.time), left.interpolation, left.easeRange, left.bezier, left.easeValues) as number
}

type Instance = { id: string; params: Record<string, unknown>; curves?: VideoEditCurves; [key: string]: unknown }
type Values = Record<string, number>
const num = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback

/**
 * Converts animated v1 inputs into v2 outputs. When no input is animated the static conversion applies. Otherwise every
 * output gets keyframes at the union of the input keyframe times; a point keeps the interpolation of the input point at
 * that time (first animated input), otherwise it is linear. Trimmed Bézier anchors (`easeValues`) convert with the
 * counterpart values evaluated at the same time.
 */
function convertAnimated(params: Record<string, unknown>, curves: VideoEditCurves, inputs: readonly string[], outputs: readonly string[], convert: (values: Values) => Values): { params: Record<string, number>; curves: Record<string, VideoEditKeyframe[]> } {
  const animated = inputs.filter(key => curves[key]?.length)
  const valueAt = (key: string, time: number): number => num(curves[key]?.length ? evaluateVideoEditKeyframes(curves[key], time, num(params[key])) : params[key])
  const at = (time: number): Values => convert(Object.fromEntries(inputs.map(key => [key, valueAt(key, time)])))
  const staticValues = convert(Object.fromEntries(inputs.map(key => [key, num(params[key])])))
  if (!animated.length) return { params: staticValues, curves: {} }
  const times = [...new Set(animated.flatMap(key => curves[key]!.map(point => point.time)))].sort((a, b) => a - b)
  const result: Record<string, VideoEditKeyframe[]> = Object.fromEntries(outputs.map(key => [key, []]))
  for (const time of times) {
    const values = at(time)
    const owner = animated.map(key => curves[key]!.find(point => point.time === time)).find(Boolean)
    for (const key of outputs) {
      const base: VideoEditKeyframe = owner ? { ...owner, value: values[key] } : { time, value: values[key], interpolation: 'linear' }
      if (owner?.easeValues) {
        // easeValues anchor the original segment ends; convert each anchor at its own time, inputs evaluated there.
        const ownerKey = animated.find(input => curves[input]!.includes(owner))!
        const points = curves[ownerKey]!; const index = points.indexOf(owner)
        const next = points[index + 1]
        base.easeValues = owner.easeValues.map((_anchor, j) => at(j === 0 ? time : next?.time ?? time)[key]) as typeof owner.easeValues
      }
      delete base.source; delete base.reframeOrigin; delete base.duckingOrigin
      result[key].push(base)
    }
  }
  return { params: at(times[0]), curves: result }
}

/** Video `color_grade` instance v1 → v2, including keyframes of every converted parameter. */
export function migrateVideoColorGradeInstanceV1<T extends Instance>(instance: T): T {
  if (instance.id !== 'color_grade') return instance
  const curves: VideoEditCurves = { ...(instance.curves ?? {}) }
  const params: Record<string, unknown> = migrateColorGradeParamsV1(instance.params)
  const removeCurves = (keys: readonly string[]): void => { for (const key of keys) delete curves[key] }
  if (instance.curves?.temperature?.length || instance.curves?.tint?.length) {
    const converted = convertAnimated(instance.params, instance.curves, ['temperature', 'tint'], ['temperature_kelvin', 'tint'], values => legacyWhiteBalanceToKelvin(values.temperature, values.tint))
    removeCurves(['temperature', 'tint'])
    Object.assign(params, converted.params); Object.assign(curves, converted.curves)
  }
  for (const zone of ['shadow', 'highlight'] as const) {
    const inputs = [`${zone}_hue`, `${zone}_strength`, `creative_${zone}_hue`, `creative_${zone}_strength`]
    if (!inputs.some(key => instance.curves?.[key]?.length) || !num(instance.params[`creative_${zone}_strength`]) && !instance.curves?.[`creative_${zone}_strength`]?.length) continue
    const converted = convertAnimated(instance.params, instance.curves!, inputs, [`${zone}_hue`, `${zone}_strength`], values => {
      const merged = combineWheelTints({ hue: values[inputs[0]], strength: values[inputs[1]] }, { hue: values[inputs[2]], strength: values[inputs[3]] })
      return { [`${zone}_hue`]: merged.hue, [`${zone}_strength`]: merged.strength }
    })
    removeCurves(inputs)
    Object.assign(params, converted.params); Object.assign(curves, converted.curves)
  }
  removeCurves(COLOR_GRADE_V1_REMOVED_KEYS)
  const next = { ...instance, params }
  if (instance.curves) next.curves = curves
  return next
}

/** Walks any JSON value and migrates every embedded `builtin` color grade (documents, presets, preset packages). */
export function migrateEmbeddedVideoColorGradesV1(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(migrateEmbeddedVideoColorGradesV1)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(record)) {
    const builtin = key === 'builtin' && child && typeof child === 'object' && !Array.isArray(child) && (child as Instance).id === 'color_grade' && typeof (child as Instance).params === 'object'
    result[key] = builtin ? migrateVideoColorGradeInstanceV1(child as Instance) : migrateEmbeddedVideoColorGradesV1(child)
  }
  return result
}
