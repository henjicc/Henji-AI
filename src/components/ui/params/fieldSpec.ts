import type { CodeGrade, CodeParameterDeclaration, CodeParameterTypeDefinition, CodeParameterValue, CodePoint, CodeRange } from '@/core/imaging/parameterTypes'
import { IMAGING_UNIT_LABELS, type ImagingParam } from '@/core/imaging/parameterDefinition'
import { encodeColorGradeCurve, colorGradeCurvePoints, parseColorGradeCurve } from '@/core/imaging/adjustments/curves'

type DisplayDeclaration<T> = T extends CodeParameterDeclaration ? Omit<T, 'description' | 'fields'> : never
/** Display metadata only. Assistant descriptions never enter a field. */
export type ParamFieldSpec = (DisplayDeclaration<CodeParameterDeclaration> | { type: 'lut'; key: string; title: string; tooltip?: string; default: string; animatable: boolean; group?: string; advanced?: boolean; visibleWhen?: never }) & {
  source: 'code' | 'builtin'
  bindingKeys: readonly string[]
  colorFormat?: 'rgba' | 'hex'
  curveFormat?: 'linear' | 'color_grade'
  layout?: CodeParameterTypeDefinition['layout']
  children?: readonly ParamFieldSpec[]
  step?: number
  rangeTrack?: 'hue' | 'saturation' | 'luminance'
  rangeWrap?: boolean
}

export function codeParameterFields(parameters: readonly CodeParameterDeclaration[], types: Record<string, CodeParameterTypeDefinition> = {}): ParamFieldSpec[] {
  return parameters.map(parameter => {
    const { description: _description, ...display } = parameter
    if (display.type === 'custom') {
      const { fields: _fields, ...custom } = display
      return { ...custom, source: 'code', bindingKeys: [parameter.key], layout: types[display.typeName]?.layout ?? 'stack', children: codeParameterFields(Object.values(display.fields), types) }
    }
    return { ...display, source: 'code', bindingKeys: [parameter.key] }
  })
}

export function builtinParameterFields(params: readonly ImagingParam[]): ParamFieldSpec[] {
  const used = new Set<string>()
  return params.flatMap<ParamFieldSpec>(param => {
    if (used.has(param.key)) return []
    used.add(param.key)
    const base = { key: param.key, title: param.name, tooltip: param.tooltip, animatable: param.animatable !== false, source: 'builtin' as const, bindingKeys: [param.key] }
    if (param.type === 'number') {
      const gradePrefix = param.key.endsWith('_hue') ? param.key.slice(0, -4) : undefined
      const strength = gradePrefix && params.find(item => item.key === `${gradePrefix}_strength` && item.type === 'number')
      const luminance = gradePrefix && params.find(item => item.key === `${gradePrefix}_luminance` && item.type === 'number')
      if (strength && luminance && strength.type === 'number' && luminance.type === 'number') {
        used.add(strength.key); used.add(luminance.key)
        return [{ ...base, key: `${gradePrefix}_grade`, title: param.name.replace(/(?:色轮)?色相$/, '色轮'), bindingKeys: [param.key, strength.key, luminance.key], type: 'grade', layout: 'wheel', default: { hue: param.default, strength: strength.default / 100, luminance: luminance.default / 100 } }]
      }
      const rangeChannel = /^hsl_(hue|saturation|luminance)_start$/.exec(param.key)?.[1] as ParamFieldSpec['rangeTrack']
      const end = rangeChannel && params.find(item => item.key === `hsl_${rangeChannel}_end` && item.type === 'number')
      if (end && end.type === 'number') {
        used.add(end.key)
        return [{ ...base, key: `hsl_${rangeChannel}_range`, title: param.name.replace(/起点$/, '区间'), bindingKeys: [param.key, end.key], type: 'range', min: param.min, max: param.max, step: param.step, default: [param.default, end.default], rangeTrack: rangeChannel, rangeWrap: rangeChannel === 'hue', unit: IMAGING_UNIT_LABELS[param.unit] }]
      }
      const positionKey = /_[xy]$/.test(param.key) && param.unit === 'percent' ? param.key.slice(0, -2) : undefined
      const x = positionKey && params.find(item => item.key === `${positionKey}_x` && item.type === 'number' && item.unit === 'percent')
      const y = positionKey && params.find(item => item.key === `${positionKey}_y` && item.type === 'number' && item.unit === 'percent')
      if (x && y && x.type === 'number' && y.type === 'number') {
        used.add(x.key); used.add(y.key)
        return [{ ...base, key: positionKey!, title: x.name.replace(/（水平）$/, ''), tooltip: x.tooltip, bindingKeys: [x.key, y.key], type: 'point' as const, space: 'frame' as const,
          default: { x: x.default / 100, y: y.default / 100 }, min: { x: x.min / 100, y: y.min / 100 }, max: { x: x.max / 100, y: y.max / 100 }, step: Math.min(x.step, y.step) / 100, animatable: x.animatable !== false && y.animatable !== false }]
      }
      if (param.unit === 'degrees') return [{ ...base, type: 'angle' as const, default: param.default, min: param.min, max: param.max, step: param.step }]
      return [{ ...base, type: 'number' as const, default: param.default, min: param.min, max: param.max, step: param.step, unit: IMAGING_UNIT_LABELS[param.unit], control: 'input' as const }]
    }
    if (param.type === 'enum') return [{ ...base, type: 'choice' as const, default: param.default, options: param.options.map(option => option.value), optionLabels: Object.fromEntries(param.options.map(option => [option.value, option.label])) }]
    if (param.type === 'color') return [{ ...base, type: 'color' as const, default: hexColor(param.default), colorFormat: 'hex' as const, alpha: param.alpha ?? false }]
    if (param.type === 'curve') return [{ ...base, type: 'curve' as const, default: [], kind: param.key.startsWith('curve_hue_') ? 'hue' as const : 'tone' as const, curveFormat: 'color_grade' as const }]
    if (param.type === 'boolean') return [{ ...base, type: 'boolean' as const, default: param.default }]
    return [{ ...base, type: 'lut' as const, default: param.default }]
  })
}

export function hexColor(hex: string): [number, number, number, number] {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1]
}
export function readBuiltinField(field: ParamFieldSpec, values: Readonly<Record<string, unknown>>): CodeParameterValue {
  if (field.type === 'grade') return { hue: Number(values[field.bindingKeys[0]]), strength: Number(values[field.bindingKeys[1]]) / 100, luminance: Number(values[field.bindingKeys[2]]) / 100 }
  if (field.type === 'range') return field.bindingKeys.map(key => Number(values[key])) as CodeRange
  if (field.type === 'point') return { x: Number(values[field.bindingKeys[0]]) / 100, y: Number(values[field.bindingKeys[1]]) / 100 }
  if (field.type === 'color') return hexColor(String(values[field.key]))
  if (field.type === 'curve') {
    const channel = field.key.slice(6, -7)
    const points = ['master', 'red', 'green', 'blue'].includes(channel) ? colorGradeCurvePoints(values, channel) : parseColorGradeCurve(values[field.key] || '')
    return (points.length ? points : [{ x: 0, y: 50 }, { x: 100, y: 50 }]).map(point => ({ x: point.x / 100, y: point.y / 100 }))
  }
  return (values[field.key] ?? field.default) as CodeParameterValue
}
export function writeBuiltinField(field: ParamFieldSpec, value: CodeParameterValue): Record<string, number | string | boolean> {
  if (field.type === 'grade') { const grade = value as CodeGrade; return { [field.bindingKeys[0]]: grade.hue, [field.bindingKeys[1]]: grade.strength * 100, [field.bindingKeys[2]]: grade.luminance * 100 } }
  if (field.type === 'range') { const range = value as CodeRange; return { [field.bindingKeys[0]]: range[0], [field.bindingKeys[1]]: range[1] } }
  if (field.type === 'point') { const point = value as CodePoint; return { [field.bindingKeys[0]]: point.x * 100, [field.bindingKeys[1]]: point.y * 100 } }
  if (field.type === 'color') { const color = value as number[]; return { [field.key]: `#${color.slice(0, field.alpha ? 4 : 3).map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}` } }
  if (field.type === 'curve') return { [field.key]: encodeColorGradeCurve((value as CodePoint[]).map(point => ({ x: point.x * 100, y: point.y * 100 }))) }
  return { [field.key]: value as number | string | boolean }
}
