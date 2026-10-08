import type { CodeParameterValue, CodeColor } from './codeMaterial/contract'
import { codeCubicBezier } from './codeMaterial/motion'
import { z } from 'zod'

export const videoEditInterpolationSchema = z.enum(['linear', 'hold', 'ease', 'bezier'])
export const videoEditBezierSchema = z.tuple([z.number().finite().min(0).max(1), z.number().finite(), z.number().finite().min(0).max(1), z.number().finite()])
export type VideoEditInterpolation = z.infer<typeof videoEditInterpolationSchema>
export type VideoEditBezier = z.infer<typeof videoEditBezierSchema>
export const VIDEO_EDIT_DEFAULT_BEZIER: VideoEditBezier = [1 / 3, 0, 2 / 3, 1]

/** ease = cubic Bézier (1/3,0),(2/3,1): x=t, y=3t²−2t³. */
export function interpolateVideoEditKeyframe(left: CodeParameterValue, right: CodeParameterValue, fraction: number, interpolation: VideoEditInterpolation, easeRange: readonly [number, number] = [0, 1], bezier: VideoEditBezier = VIDEO_EDIT_DEFAULT_BEZIER, easeValues?: readonly [CodeParameterValue, CodeParameterValue]): CodeParameterValue {
  if (interpolation === 'hold') return left
  const t = Math.max(0, Math.min(1, fraction))
  // Repeated trims can differ by one ulp at a bisection boundary; canonicalize the input only.
  const smooth = (value: number): number => interpolation === 'bezier' ? codeCubicBezier(...bezier, Math.round(value * 1e14) / 1e14) : value * value * (3 - 2 * value)
  const [a, b] = easeRange
  const eased = interpolation === 'ease' || interpolation === 'bezier'
  const amount = eased ? easeValues ? smooth(a + (b - a) * t) : (smooth(a + (b - a) * t) - smooth(a)) / (smooth(b) - smooth(a)) : t
  if (eased && easeValues) [left, right] = easeValues
  if (typeof left === 'number' && typeof right === 'number') return left + (right - left) * amount
  if (Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every(channel => typeof channel === 'number') && right.every(channel => typeof channel === 'number')) return (left as number[]).map((channel, index) => channel + ((right as number[])[index] - channel) * amount) as CodeColor
  if (typeof left === 'string' && typeof right === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(left) && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(right) && left.length === right.length) {
    return '#' + (left.length === 9 ? [1, 3, 5, 7] : [1, 3, 5]).map(offset => {
      const a = parseInt(left.slice(offset, offset + 2), 16); const b = parseInt(right.slice(offset, offset + 2), 16)
      return Math.max(0, Math.min(255, Math.round(a + (b - a) * amount))).toString(16).padStart(2, '0')
    }).join('')
  }
  return left
}

/** Clamp overshoot to the existing value schema, without parsing on every rendered sample. */
export function clampVideoEditAnimationValue(value: CodeParameterValue, schema: z.ZodType): CodeParameterValue {
  if (schema instanceof z.ZodOptional) return clampVideoEditAnimationValue(value, schema.unwrap() as z.ZodType)
  if (schema instanceof z.ZodNumber && typeof value === 'number') return Math.max(schema.minValue ?? -Infinity, Math.min(schema.maxValue ?? Infinity, value))
  if (schema instanceof z.ZodTuple && Array.isArray(value)) return value.map((item, index) => clampVideoEditAnimationValue(item as CodeParameterValue, schema.def.items[index] as z.ZodType)) as CodeColor
  if (schema instanceof z.ZodObject && value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clampVideoEditAnimationValue(item as CodeParameterValue, schema.shape[key] as z.ZodType)])) as CodeParameterValue
  return value
}
