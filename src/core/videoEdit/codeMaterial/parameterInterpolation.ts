import type { CodeParameterDeclaration, CodeParameterValue, CodeBasicParameterValue } from './contract'
import { interpolateVideoEditKeyframe } from '../keyframeInterpolation'

export function codeParameterSupportsInterpolation(parameter: CodeParameterDeclaration): boolean {
  return ['number', 'angle', 'color', 'point', 'range', 'grade'].includes(parameter.type) || parameter.type === 'custom' && Object.values(parameter.fields).some(codeParameterSupportsInterpolation)
}
/** Angles and grade.hue use numeric interpolation, with no wrapping or shortest-path correction. */
export function interpolateCodeMaterialParameter(parameter: CodeParameterDeclaration, left: CodeParameterValue, right: CodeParameterValue, fraction: number, interpolation: 'linear' | 'hold' | 'ease'): CodeParameterValue {
  if (interpolation === 'hold' || !codeParameterSupportsInterpolation(parameter)) return structuredClone(left)
  if (parameter.type === 'custom') {
    const a = left as Record<string, CodeBasicParameterValue>; const b = right as Record<string, CodeBasicParameterValue>
    return Object.fromEntries(Object.entries(parameter.fields).map(([key, field]) => [key, interpolateCodeMaterialParameter(field, a[key], b[key], fraction, interpolation) as CodeBasicParameterValue]))
  }
  if (parameter.type === 'point' || parameter.type === 'grade') {
    const a = left as unknown as Record<string, number>; const b = right as unknown as Record<string, number>
    return Object.fromEntries(Object.entries(a).map(([key, value]) => [key, interpolateVideoEditKeyframe(value, b[key], fraction, interpolation)])) as CodeParameterValue
  }
  return interpolateVideoEditKeyframe(left, right, fraction, interpolation)
}
