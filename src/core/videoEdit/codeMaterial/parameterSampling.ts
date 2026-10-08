import { CodeMaterialError, finiteCodeNumber } from './contract'
import type { CodeColor, CodeEasing, CodeGradientStop, CodePoint } from './contract'
import { codeCubicBezier, codeEase } from './motion'
import { validateCodeMaterialV3ParameterValue } from './parameterTypes'

const base = { key: '采样参数', title: '采样参数', description: '', animatable: false }
export const CODE_PARAMETER_FUNCTION_COSTS: Readonly<Record<string, number>> = { sampleGradient: 32 * 20, sampleCurve: 64 * 8, ease: 128 }
/** Linear RGBA interpolation; at ties the last stop wins, so hard transitions stay deterministic. */
export function sampleCodeGradient(value: unknown, input: number): CodeColor {
  const stops = validateCodeMaterialV3ParameterValue({ ...base, type: 'gradient', maxStops: 32, default: [] }, value) as CodeGradientStop[]
  const t = Math.min(1, Math.max(0, finiteCodeNumber(input, 'sampleGradient.t')))
  if (t < stops[0].at) return [...stops[0].color]
  const upper = stops.findIndex(stop => stop.at > t)
  if (upper < 0) return [...stops.at(-1)!.color]
  const left = stops[upper - 1]; const right = stops[upper]; const fraction = (t - left.at) / (right.at - left.at)
  return left.color.map((channel, i) => channel + (right.color[i] - channel) * fraction) as CodeColor
}
/** Piecewise linear, matching the contract used by the curve editor; no cubic overshoot. */
export function sampleCodeCurve(value: unknown, input: number): number {
  const points = validateCodeMaterialV3ParameterValue({ ...base, type: 'curve', kind: 'tone', default: [] }, value) as CodePoint[]
  const x = Math.min(1, Math.max(0, finiteCodeNumber(input, 'sampleCurve.x')))
  if (x <= 0) return points[0].y
  if (x >= 1) return points.at(-1)!.y
  const upper = points.findIndex(point => point.x >= x); const left = points[upper - 1]; const right = points[upper]
  return left.y + (right.y - left.y) * (x - left.x) / (right.x - left.x)
}
export function easeCodeParameter(value: unknown, input: number): number {
  const easing = validateCodeMaterialV3ParameterValue({ ...base, type: 'easing', default: 'linear' }, value) as CodeEasing
  const t = finiteCodeNumber(input, 'ease.t')
  const result = typeof easing === 'string' ? codeEase(easing, t) : codeCubicBezier(easing[0], easing[1], easing[2], easing[3], t)
  if (!Number.isFinite(result)) throw new CodeMaterialError('NON_FINITE', 'ease 结果必须是有限数值。')
  return result
}
