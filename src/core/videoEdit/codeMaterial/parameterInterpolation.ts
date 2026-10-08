import type { CodeParameterDeclaration, CodeParameterValue, CodeBasicParameterValue } from './contract'
import { codeMaterialGradeValueSchema } from './parameterValueSchema'
import { clampVideoEditAnimationValue, interpolateVideoEditKeyframe, type VideoEditBezier, type VideoEditInterpolation } from '../keyframeInterpolation'

export function codeParameterSupportsInterpolation(parameter: CodeParameterDeclaration): boolean {
  return ['number', 'angle', 'color', 'point', 'range', 'grade'].includes(parameter.type) || parameter.type === 'custom' && Object.values(parameter.fields).some(codeParameterSupportsInterpolation)
}
/** Angles and grade.hue use numeric interpolation, with no wrapping or shortest-path correction. */
export function interpolateCodeMaterialParameter(parameter: CodeParameterDeclaration, left: CodeParameterValue, right: CodeParameterValue, fraction: number, interpolation: VideoEditInterpolation, bezier?: VideoEditBezier): CodeParameterValue {
  if (interpolation === 'hold' || !codeParameterSupportsInterpolation(parameter)) return structuredClone(left)
  if (parameter.type === 'custom') {
    const a = left as Record<string, CodeBasicParameterValue>; const b = right as Record<string, CodeBasicParameterValue>
    return Object.fromEntries(Object.entries(parameter.fields).map(([key, field]) => [key, interpolateCodeMaterialParameter(field, a[key], b[key], fraction, interpolation, bezier) as CodeBasicParameterValue]))
  }
  if (parameter.type === 'point' || parameter.type === 'grade') {
    const a = left as unknown as Record<string, number>; const b = right as unknown as Record<string, number>
    const value = Object.fromEntries(Object.entries(a).map(([key, value]) => [key, interpolateVideoEditKeyframe(value, b[key], fraction, interpolation, undefined, bezier)])) as Record<string, number>
    if (parameter.type === 'grade') return clampVideoEditAnimationValue(value, codeMaterialGradeValueSchema)
    return { x: Math.max(parameter.min.x, Math.min(parameter.max.x, value.x)), y: Math.max(parameter.min.y, Math.min(parameter.max.y, value.y)) }
  }
  const value = interpolateVideoEditKeyframe(left, right, fraction, interpolation, undefined, bezier)
  if ((parameter.type === 'number' || parameter.type === 'angle') && typeof value === 'number') return Math.max(parameter.min, Math.min(parameter.max, value))
  if (parameter.type === 'range' && Array.isArray(value)) return (value as number[]).map(channel => Math.max(parameter.min, Math.min(parameter.max, channel))).sort((a, b) => a - b) as [number, number]
  if (parameter.type === 'color' && Array.isArray(value)) return (value as number[]).map(channel => Math.max(0, Math.min(1, channel))) as [number, number, number, number]
  return value
}
