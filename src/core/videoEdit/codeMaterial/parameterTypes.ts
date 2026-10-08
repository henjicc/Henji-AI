import { CODE_PARAMETER_TYPES, CodeMaterialError, assertCodeMaterialKey, codeColor, finiteCodeNumber } from './contract'
import type { CodeBasicParameterDeclaration, CodeBasicParameterValue, CodeParameterDeclaration, CodeParameterObject, CodeParameterTypeDefinition, CodeParameterValue, CodeParameterVisibility, CodePoint, CodeValueType } from './contract'
import { CODE_EASE_NAMES } from './motion'

function fail(label: string, expected: string): never { throw new CodeMaterialError('PARAMETERS', `${label} 期望${expected}。`) }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) fail(label, '静态 JSON 对象')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(value).length !== Object.keys(descriptors).length || Object.values(descriptors).some(field => !('value' in field) || !field.enumerable)) fail(label, '无访问器的 JSON 对象')
  return value as Record<string, unknown>
}
function fields(item: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(item)) if (!allowed.includes(key)) fail(`${label}.${key}`, `已声明字段（可用：${allowed.join('、')}）`)
}
function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || !empty && !value.length) fail(label, `${empty ? '0' : '1'}–${max} 字的字符串`)
  return value
}
function bool(value: unknown, label: string): boolean { if (typeof value !== 'boolean') fail(label, '布尔值'); return value }
function number(value: unknown, label: string, min: number, max: number, integer = false): number {
  const n = finiteCodeNumber(value, label)
  if (n < min || n > max || integer && !Number.isInteger(n)) fail(label, `${min}–${max} 的${integer ? '整数' : '有限数值'}`)
  return n
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(label, allowed.join(' | '))
  return value as T
}
function point(value: unknown, label: string): CodePoint {
  const raw = object(value, label); fields(raw, ['x', 'y'], label)
  return { x: finiteCodeNumber(raw.x, `${label}.x`), y: finiteCodeNumber(raw.y, `${label}.y`) }
}
const extras: Record<string, string[]> = {
  number: ['min', 'max', 'step', 'unit', 'control'], angle: ['min', 'max'], point: ['space', 'min', 'max'], range: ['min', 'max', 'step', 'unit'], color: ['alpha'],
  gradient: ['maxStops'], curve: ['kind'], grade: [], choice: ['options', 'control'], boolean: [], text: ['maxLength', 'multiline'], font: [], image: [], easing: [], seed: [],
}
function declaration(key: string, raw: unknown, types: Record<string, CodeParameterTypeDefinition>, field = false): CodeParameterDeclaration {
  assertCodeMaterialKey(key)
  const item = object(raw, key); const type = text(item.type, `${key}.type`, 64)
  const custom = Object.prototype.hasOwnProperty.call(types, type) ? types[type] : undefined
  if (!Object.prototype.hasOwnProperty.call(extras, type) && !custom) fail(`${key}.type`, `基础类型或已声明自定义类型（${[...CODE_PARAMETER_TYPES, ...Object.keys(types)].join('、')}）`)
  if (field && (type === 'image' || custom)) fail(`${key}.type`, '除 image 外的基础类型，不允许嵌套自定义类型')
  fields(item, ['type', 'title', 'description', 'tooltip', 'default', 'animatable', ...(field ? [] : ['group', 'advanced', 'visibleWhen']), ...(extras[type] ?? [])], key)
  const base = { key, title: text(item.title, `${key}.title`, 80), description: text(item.description ?? '', `${key}.description`, 1000, true), animatable: bool(item.animatable ?? false, `${key}.animatable`),
    ...(item.tooltip === undefined ? {} : { tooltip: text(item.tooltip, `${key}.tooltip`, 200, true) }),
    ...(field ? {} : { advanced: bool(item.advanced ?? false, `${key}.advanced`), ...(item.group === undefined ? {} : { group: text(item.group, `${key}.group`, 40) }) }) }
  let result: CodeParameterDeclaration
  if (custom) {
    const partial = object(item.default, `${key}.default`); fields(partial, Object.keys(custom.fields), `${key}.default`)
    const defaults: CodeParameterObject = Object.fromEntries(Object.entries(custom.fields).map(([name, field]) => [name, validateCodeMaterialV3ParameterValue(field, Object.prototype.hasOwnProperty.call(partial, name) ? partial[name] : field.default) as CodeBasicParameterValue]))
    result = { ...base, type: 'custom', typeName: type, fields: custom.fields, default: defaults }
  } else if (type === 'number' || type === 'range') {
    const min = number(item.min, `${key}.min`, -1e9, 1e9); const max = number(item.max, `${key}.max`, min, 1e9); const step = number(item.step, `${key}.step`, Number.MIN_VALUE, 1e9)
    const bounds = { min, max, step, unit: text(item.unit ?? '', `${key}.unit`, 32, true) }
    result = type === 'number' ? { ...base, type, ...bounds, default: finiteCodeNumber(item.default, `${key}.default`), ...(item.control === undefined ? {} : { control: enumValue(item.control, ['slider', 'knob', 'input'] as const, `${key}.control`) }) }
      : { ...base, type, ...bounds, default: item.default as [number, number] }
  } else if (type === 'angle') result = { ...base, type, min: number(item.min ?? -180, `${key}.min`, -1e9, 1e9), max: number(item.max ?? 180, `${key}.max`, -1e9, 1e9), default: finiteCodeNumber(item.default, `${key}.default`) }
  else if (type === 'point') {
    const space = enumValue(item.space ?? 'frame', ['frame', 'pixels'], `${key}.space`)
    const min = point(item.min ?? (space === 'frame' ? { x: 0, y: 0 } : { x: -1e9, y: -1e9 }), `${key}.min`)
    const max = point(item.max ?? (space === 'frame' ? { x: 1, y: 1 } : { x: 1e9, y: 1e9 }), `${key}.max`)
    if (min.x > max.x || min.y > max.y || [min.x, min.y, max.x, max.y].some(n => Math.abs(n) > 1e9) || space === 'frame' && [min.x, min.y, max.x, max.y].some(n => n < 0 || n > 1)) fail(key, '每轴 min≤max；frame 空间在 0–1，pixels 在 ±1e9')
    result = { ...base, type, space, min, max, default: point(item.default, `${key}.default`) }
  } else if (type === 'color') result = { ...base, type, default: codeColor(item.default, key), alpha: bool(item.alpha ?? true, `${key}.alpha`) }
  else if (type === 'gradient') result = { ...base, type, maxStops: number(item.maxStops ?? 8, `${key}.maxStops`, 2, 32, true), default: item.default as Extract<CodeBasicParameterDeclaration, { type: 'gradient' }>['default'] }
  else if (type === 'curve') result = { ...base, type, kind: enumValue(item.kind ?? 'tone', ['tone', 'hue'], `${key}.kind`), default: item.default as CodePoint[] }
  else if (type === 'grade') result = { ...base, type, default: item.default as Extract<CodeBasicParameterDeclaration, { type: 'grade' }>['default'] }
  else if (type === 'choice') {
    if (!Array.isArray(item.options) || item.options.length < 1 || item.options.length > 64) fail(`${key}.options`, '1–64 项字符串或 {value,label} 对象数组')
    const labels: Record<string, string> = {}; const objectOptions = typeof item.options[0] !== 'string'
    const options = item.options.map((value, index) => {
      if (!objectOptions) return text(value, `${key}.options[${index}]`, 128)
      const entry = object(value, `${key}.options[${index}]`); fields(entry, ['value', 'label'], `${key}.options[${index}]`)
      const option = text(entry.value, `${key}.options.value`, 128)
      Object.defineProperty(labels, option, { value: text(entry.label, `${key}.options.label`, 128), enumerable: true, configurable: true, writable: true }); return option
    })
    if (new Set(options).size !== options.length) fail(`${key}.options`, '没有重复 value 的选项')
    result = { ...base, type, options, default: text(item.default, `${key}.default`, 128), ...(objectOptions ? { optionLabels: labels } : {}), ...(item.control === undefined ? {} : { control: enumValue(item.control, ['dropdown', 'segmented'] as const, `${key}.control`) }) }
  } else if (type === 'text') result = { ...base, type, maxLength: number(item.maxLength, `${key}.maxLength`, 1, 4096, true), default: text(item.default, `${key}.default`, 4096, true), multiline: bool(item.multiline ?? false, `${key}.multiline`) }
  else if (type === 'font') result = { ...base, type, default: text(item.default, `${key}.default`, 200) }
  else if (type === 'boolean') result = { ...base, type, default: bool(item.default, `${key}.default`) }
  else if (type === 'seed') result = { ...base, type, default: number(item.default, `${key}.default`, 0, 4294967295, true) }
  else if (type === 'easing') result = { ...base, type, default: item.default as Extract<CodeBasicParameterDeclaration, { type: 'easing' }>['default'] }
  else {
    if (item.default !== null || base.animatable) fail(key, '图片 default:null 且 animatable:false')
    result = { ...base, type: 'image', default: null, animatable: false }
  }
  result.default = validateCodeMaterialV3ParameterValue(result, result.default) as typeof result.default
  return result
}

export function parseCodeMaterialTypes(raw: unknown): Record<string, CodeParameterTypeDefinition> {
  const result: Record<string, CodeParameterTypeDefinition> = {}
  for (const [name, rawType] of Object.entries(object(raw, 'types'))) {
    assertCodeMaterialKey(name)
    if (CODE_PARAMETER_TYPES.includes(name as typeof CODE_PARAMETER_TYPES[number])) fail(`types.${name}`, '不与基础类型重名的类型名')
    const item = object(rawType, `types.${name}`); fields(item, ['title', 'layout', 'fields'], `types.${name}`)
    const members = Object.entries(object(item.fields, `types.${name}.fields`))
    if (!members.length || members.length > 16) fail(`types.${name}.fields`, '1–16 个基础类型字段')
    const layout = enumValue(item.layout, ['stack', 'row', 'grid', 'wheel'], `types.${name}.layout`)
    const parsed = Object.fromEntries(members.map(([key, value]) => [key, declaration(key, value, {}, true) as CodeBasicParameterDeclaration]))
    if (layout === 'wheel' && Object.values(parsed).filter(field => field.type === 'grade').length !== 1) fail(`types.${name}.layout`, 'wheel 恰好包含一个 grade 字段')
    result[name] = { title: text(item.title, `types.${name}.title`, 80), layout, fields: parsed }
  }
  return result
}
export function parseCodeMaterialV3Parameters(raw: unknown, types: Record<string, CodeParameterTypeDefinition>): CodeParameterDeclaration[] {
  const result: CodeParameterDeclaration[] = []
  for (const [key, value] of Object.entries(object(raw, 'parameters'))) {
    const parsed = declaration(key, value, types)
    const condition = object(value, key).visibleWhen
    if (condition !== undefined) {
      const item = object(condition, `${key}.visibleWhen`); fields(item, ['param', 'equals', 'notEquals', 'in'], `${key}.visibleWhen`)
      const name = text(item.param, `${key}.visibleWhen.param`, 64)
      const target = result.find(parameter => parameter.key === name)
      if (!target || !['choice', 'boolean', 'number'].includes(target.type)) fail(`${key}.visibleWhen`, '仅引用声明顺序在前的 choice/boolean/number 参数')
      const tests = ['equals', 'notEquals', 'in'].filter(test => Object.prototype.hasOwnProperty.call(item, test))
      if (tests.length !== 1) fail(`${key}.visibleWhen`, 'equals、notEquals、in 中恰好一个条件')
      if (tests[0] === 'in' && (!Array.isArray(item.in) || !item.in.length)) fail(`${key}.visibleWhen.in`, '非空比较值数组')
      for (const comparison of tests[0] === 'in' ? item.in as unknown[] : [item[tests[0]]]) validateCodeMaterialV3ParameterValue(target, comparison)
      parsed.visibleWhen = { ...item } as unknown as CodeParameterVisibility
    }
    result.push(parsed)
  }
  return result
}
export function validateCodeMaterialV3ParameterValue(declaration: CodeParameterDeclaration, value: unknown): CodeParameterValue {
  const key = declaration.key
  switch (declaration.type) {
    case 'number': case 'angle': return number(value, key, declaration.min, declaration.max)
    case 'seed': return number(value, key, 0, 4294967295, true)
    case 'point': { const v = point(value, key); number(v.x, `${key}.x`, declaration.min.x, declaration.max.x); number(v.y, `${key}.y`, declaration.min.y, declaration.max.y); return v }
    case 'range': {
      if (!Array.isArray(value) || value.length !== 2) fail(key, '[a,b] 两个数值且 a≤b')
      return [number(value[0], `${key}[0]`, declaration.min, declaration.max), number(value[1], `${key}[1]`, Math.max(declaration.min, finiteCodeNumber(value[0], key)), declaration.max)]
    }
    case 'color': { const v = codeColor(value, key); if (declaration.alpha === false && v[3] !== 1) fail(key, 'RGBA 四元组且 alpha 固定 1'); return v }
    case 'grade': {
      const raw = object(value, key); fields(raw, ['hue', 'strength', 'luminance'], key)
      return { hue: number(raw.hue, `${key}.hue`, 0, 360), strength: number(raw.strength, `${key}.strength`, 0, 1), luminance: number(raw.luminance, `${key}.luminance`, -1, 1) }
    }
    case 'gradient': {
      if (!Array.isArray(value) || value.length < 2 || value.length > declaration.maxStops) fail(key, `2–${declaration.maxStops} 项 [{at:0–1,color:RGBA}]，at 非降序`)
      let previous = 0
      return value.map((entry, index) => { const raw = object(entry, `${key}[${index}]`); fields(raw, ['at', 'color'], key); const at = number(raw.at, `${key}[${index}].at`, previous, 1); previous = at; return { at, color: codeColor(raw.color, `${key}[${index}].color`) } })
    }
    case 'curve': {
      if (!Array.isArray(value) || value.length < 2 || value.length > 64) fail(key, '2–64 项 [{x:0–1,y:0–1}]，x 严格递增，首尾 x=0/1')
      const points = value.map((entry, index) => { const p = point(entry, `${key}[${index}]`); number(p.x, `${key}[${index}].x`, 0, 1); number(p.y, `${key}[${index}].y`, 0, 1); return p })
      if (points[0].x !== 0 || points.at(-1)!.x !== 1 || points.some((p, i) => i && p.x <= points[i - 1].x) || declaration.kind === 'hue' && points[0].y !== points.at(-1)!.y) fail(key, `x 严格递增、首尾 x=0/1${declaration.kind === 'hue' ? '，hue 两端 y 相等' : ''}`)
      return points
    }
    case 'easing': {
      if (typeof value === 'string') return enumValue(value, CODE_EASE_NAMES, key)
      if (!Array.isArray(value) || value.length !== 4) fail(key, `缓动名（${CODE_EASE_NAMES.join('、')}）或 [x1,y1,x2,y2]，x 在 0–1`)
      return [number(value[0], `${key}.x1`, 0, 1), finiteCodeNumber(value[1], `${key}.y1`), number(value[2], `${key}.x2`, 0, 1), finiteCodeNumber(value[3], `${key}.y2`)]
    }
    case 'boolean': return bool(value, key)
    case 'choice': return enumValue(value, declaration.options, key)
    case 'text': return text(value, key, declaration.maxLength, true)
    case 'font': { const font = text(value, key, 200); if (/[\r\n;{}]/.test(font)) fail(key, '有效字体族名，不能包含换行或 ;{}'); return font }
    case 'custom': {
      const raw = object(value, key); fields(raw, Object.keys(declaration.fields), key)
      return Object.fromEntries(Object.entries(declaration.fields).map(([name, field]) => [name, validateCodeMaterialV3ParameterValue({ ...field, key: `${key}.${name}` }, raw[name]) as CodeBasicParameterValue]))
    }
    case 'image': if (value === null) return null; fail(key, 'null；图片引用请走既有图片参数校验')
  }
}
export function codeParameterValueType(parameter: CodeParameterDeclaration): CodeValueType {
  if (['number', 'angle', 'seed'].includes(parameter.type)) return 'number'
  if (['choice', 'text', 'font'].includes(parameter.type)) return 'string'
  if (['point', 'grade', 'custom'].includes(parameter.type)) return 'object'
  if (['range', 'gradient', 'curve'].includes(parameter.type)) return 'array'
  if (parameter.type === 'easing') return typeof parameter.default === 'string' ? 'string' : 'array'
  return parameter.type as 'boolean' | 'color' | 'image'
}
export interface CodeParameterShape { type: CodeValueType; fields?: Record<string, CodeParameterShape>; element?: CodeParameterShape }
export function codeParameterShape(parameter: CodeParameterDeclaration): CodeParameterShape {
  const type = codeParameterValueType(parameter); const numeric: CodeParameterShape = { type: 'number' }
  if (parameter.type === 'point') return { type, fields: { x: numeric, y: numeric } }
  if (parameter.type === 'grade') return { type, fields: { hue: numeric, strength: numeric, luminance: numeric } }
  if (parameter.type === 'custom') return { type, fields: Object.fromEntries(Object.entries(parameter.fields).map(([key, field]) => [key, codeParameterShape(field)])) }
  if (parameter.type === 'gradient') return { type, element: { type: 'object', fields: { at: numeric, color: { type: 'color' } } } }
  if (parameter.type === 'curve') return { type, element: { type: 'object', fields: { x: numeric, y: numeric } } }
  if (type === 'array') return { type, element: numeric }
  return { type }
}
/** Metadata preserves the source spelling while the executable IR uses a closed custom tag. */
export function codeParameterMetadata(parameter: CodeParameterDeclaration): Record<string, unknown> {
  if (parameter.type !== 'custom') return parameter.type === 'choice' && parameter.optionLabels ? { ...parameter, options: parameter.options.map(value => ({ value, label: parameter.optionLabels![value] })) } : { ...parameter }
  const { typeName, fields: members, ...rest } = parameter
  return { ...rest, type: typeName, fields: Object.fromEntries(Object.entries(members).map(([key, field]) => [key, codeParameterMetadata(field)])) }
}
