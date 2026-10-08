import type { CodeParameterDeclaration, CodeParameterTypeDefinition, CodeParameterValue, CodePoint } from '@/core/videoEdit/codeMaterial/contract'
import { VIDEO_EDIT_BUILTIN_UNIT_LABELS, type VideoEditBuiltinParam } from '@/core/videoEdit/builtinEffects'
import { encodeLumetriCurve, lumetriCurvePoints, parseLumetriCurve } from '@/core/videoEdit/lumetriCurves'

type DisplayDeclaration<T> = T extends CodeParameterDeclaration ? Omit<T, 'description' | 'fields'> : never
/** Display metadata only. Assistant descriptions never enter a field. */
export type ParamFieldSpec = (DisplayDeclaration<CodeParameterDeclaration> | { type: 'lut'; key: string; title: string; tooltip?: string; default: string; animatable: boolean; group?: string; advanced?: boolean; visibleWhen?: never }) & {
  source: 'code' | 'builtin'
  bindingKeys: readonly string[]
  colorFormat?: 'rgba' | 'hex'
  curveFormat?: 'linear' | 'lumetri'
  layout?: CodeParameterTypeDefinition['layout']
  children?: readonly ParamFieldSpec[]
  step?: number
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

export function builtinParameterFields(params: readonly VideoEditBuiltinParam[]): ParamFieldSpec[] {
  const used = new Set<string>()
  return params.flatMap<ParamFieldSpec>(param => {
    if (used.has(param.key)) return []
    used.add(param.key)
    const base = { key: param.key, title: param.name, tooltip: param.tooltip, animatable: param.animatable !== false, source: 'builtin' as const, bindingKeys: [param.key] }
    if (param.type === 'number') {
      const positionKey = /_[xy]$/.test(param.key) && param.unit === 'percent' ? param.key.slice(0, -2) : undefined
      const x = positionKey && params.find(item => item.key === `${positionKey}_x` && item.type === 'number' && item.unit === 'percent')
      const y = positionKey && params.find(item => item.key === `${positionKey}_y` && item.type === 'number' && item.unit === 'percent')
      if (x && y && x.type === 'number' && y.type === 'number') {
        used.add(x.key); used.add(y.key)
        return [{ ...base, key: positionKey!, title: x.name.replace(/（水平）$/, ''), tooltip: x.tooltip, bindingKeys: [x.key, y.key], type: 'point' as const, space: 'frame' as const,
          default: { x: x.default / 100, y: y.default / 100 }, min: { x: x.min / 100, y: y.min / 100 }, max: { x: x.max / 100, y: y.max / 100 }, step: Math.min(x.step, y.step) / 100, animatable: x.animatable !== false && y.animatable !== false }]
      }
      if (param.unit === 'degrees') return [{ ...base, type: 'angle' as const, default: param.default, min: param.min, max: param.max, step: param.step }]
      return [{ ...base, type: 'number' as const, default: param.default, min: param.min, max: param.max, step: param.step, unit: VIDEO_EDIT_BUILTIN_UNIT_LABELS[param.unit], control: 'input' as const }]
    }
    if (param.type === 'enum') return [{ ...base, type: 'choice' as const, default: param.default, options: param.options.map(option => option.value), optionLabels: Object.fromEntries(param.options.map(option => [option.value, option.label])) }]
    if (param.type === 'color') return [{ ...base, type: 'color' as const, default: hexColor(param.default), colorFormat: 'hex' as const, alpha: param.alpha ?? false }]
    if (param.type === 'curve') return [{ ...base, type: 'curve' as const, default: [], kind: param.key.startsWith('curve_hue_') ? 'hue' as const : 'tone' as const, curveFormat: 'lumetri' as const }]
    if (param.type === 'boolean') return [{ ...base, type: 'boolean' as const, default: param.default }]
    return [{ ...base, type: 'lut' as const, default: param.default }]
  })
}

export function hexColor(hex: string): [number, number, number, number] {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1]
}
export function readBuiltinField(field: ParamFieldSpec, values: Readonly<Record<string, unknown>>): CodeParameterValue {
  if (field.type === 'point') return { x: Number(values[field.bindingKeys[0]]) / 100, y: Number(values[field.bindingKeys[1]]) / 100 }
  if (field.type === 'color') return hexColor(String(values[field.key]))
  if (field.type === 'curve') {
    const channel = field.key.slice(6, -7)
    const points = ['master', 'red', 'green', 'blue'].includes(channel) ? lumetriCurvePoints(values, channel) : parseLumetriCurve(values[field.key] || '')
    return (points.length ? points : [{ x: 0, y: 50 }, { x: 100, y: 50 }]).map(point => ({ x: point.x / 100, y: point.y / 100 }))
  }
  return (values[field.key] ?? field.default) as CodeParameterValue
}
export function writeBuiltinField(field: ParamFieldSpec, value: CodeParameterValue): Record<string, number | string | boolean> {
  if (field.type === 'point') { const point = value as CodePoint; return { [field.bindingKeys[0]]: point.x * 100, [field.bindingKeys[1]]: point.y * 100 } }
  if (field.type === 'color') { const color = value as number[]; return { [field.key]: `#${color.slice(0, field.alpha ? 4 : 3).map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}` } }
  if (field.type === 'curve') return { [field.key]: encodeLumetriCurve((value as CodePoint[]).map(point => ({ x: point.x * 100, y: point.y * 100 }))) }
  return { [field.key]: value as number | string | boolean }
}
