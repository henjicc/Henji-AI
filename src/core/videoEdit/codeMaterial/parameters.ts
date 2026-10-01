import { CODE_MATERIAL_LIMITS, CodeMaterialError, assertCodeMaterialKey, codeColor, codeImageReference, finiteCodeNumber } from './contract'
import type { CodeMaterialProgram, CodeParameterDeclaration, CodeParameterValue, CodeParameterValues } from './contract'

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CodeMaterialError('PARAMETERS', `${label}必须是静态对象。`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.length)) throw new CodeMaterialError('PARAMETERS', `${label}必须是长度不超过 ${max} 的文本。`)
  return value
}
/** The only parameter declarations are extracted from the checked source object. */
export function parseCodeMaterialParameters(value: unknown): CodeParameterDeclaration[] {
  const entries = Object.entries(object(value, 'parameters'))
  if (entries.length > CODE_MATERIAL_LIMITS.parameters) throw new CodeMaterialError('BUDGET', '参数最多 32 项。')
  return entries.map(([key, raw]): CodeParameterDeclaration => {
    assertCodeMaterialKey(key)
    const item = object(raw, key)
    const animatable = item.animatable ?? false
    if (typeof animatable !== 'boolean') throw new CodeMaterialError('PARAMETERS', `${key}.animatable 必须是布尔值。`)
    const base = { key, title: text(item.title, `${key}.title`, 80), description: text(item.description ?? '', `${key}.description`, 1000, true), animatable }
    const extra = item.type === 'number' ? ['min', 'max', 'step', 'unit'] : item.type === 'choice' ? ['options'] : item.type === 'text' ? ['maxLength'] : []
    for (const name of Object.keys(item)) if (!['type', 'title', 'description', 'animatable', 'default', ...extra].includes(name)) throw new CodeMaterialError('PARAMETERS', `未知参数字段：${key}.${name}`)
    if (item.type === 'number') {
      const min = finiteCodeNumber(item.min, `${key}.min`); const max = finiteCodeNumber(item.max, `${key}.max`); const step = finiteCodeNumber(item.step, `${key}.step`)
      if (min > max || step <= 0 || Math.max(Math.abs(min), Math.abs(max), step) > 1e9) throw new CodeMaterialError('PARAMETERS', `${key} 的数值范围或步长无效。`)
      const declaration: CodeParameterDeclaration = { ...base, type: 'number', min, max, step, unit: text(item.unit ?? '', `${key}.unit`, 32, true), default: finiteCodeNumber(item.default, `${key}.default`) }
      validateCodeMaterialParameterValue(declaration, declaration.default); return declaration
    }
    if (item.type === 'color') return { ...base, type: 'color', default: codeColor(item.default, `${key}.default`) }
    if (item.type === 'boolean' && typeof item.default === 'boolean') return { ...base, type: 'boolean', default: item.default }
    if (item.type === 'choice') {
      if (!Array.isArray(item.options) || !item.options.length || item.options.length > 32) throw new CodeMaterialError('PARAMETERS', `${key}.options 必须有 1 到 32 项。`)
      const options = item.options.map(value => text(value, `${key}.options`, 128))
      if (new Set(options).size !== options.length) throw new CodeMaterialError('PARAMETERS', `${key}.options 有重复项。`)
      const declaration: CodeParameterDeclaration = { ...base, type: 'choice', options, default: text(item.default, `${key}.default`, 128) }
      validateCodeMaterialParameterValue(declaration, declaration.default); return declaration
    }
    if (item.type === 'text') {
      const maxLength = finiteCodeNumber(item.maxLength, `${key}.maxLength`)
      if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > CODE_MATERIAL_LIMITS.stringLength) throw new CodeMaterialError('PARAMETERS', `${key}.maxLength 超出范围。`)
      return { ...base, type: 'text', maxLength, default: text(item.default, `${key}.default`, maxLength, true) }
    }
    if (item.type === 'image') {
      if (item.default !== null || animatable) throw new CodeMaterialError('PARAMETERS', `${key} 的图片默认值必须为 null，且不可动画。`)
      return { ...base, type: 'image', default: null, animatable: false }
    }
    throw new CodeMaterialError('PARAMETERS', `${key} 的参数类型或默认值无效。`)
  })
}
export function validateCodeMaterialParameterValue(declaration: CodeParameterDeclaration, value: unknown): CodeParameterValue {
  const { key } = declaration
  if (declaration.type === 'number') { const number = finiteCodeNumber(value, key); if (number < declaration.min || number > declaration.max) throw new CodeMaterialError('PARAMETERS', `${key} 超出声明范围。`); return number }
  if (declaration.type === 'color') return codeColor(value, key)
  if (declaration.type === 'boolean' && typeof value === 'boolean') return value
  if (declaration.type === 'choice' && typeof value === 'string' && declaration.options.includes(value)) return value
  if (declaration.type === 'text') return text(value, key, declaration.maxLength, true)
  if (declaration.type === 'image') return value === null ? null : codeImageReference(value, key)
  throw new CodeMaterialError('PARAMETERS', `${key} 的实例值不符合声明。`)
}
export function validateCodeMaterialParameters(program: Pick<CodeMaterialProgram, 'parameters'>, values: Readonly<Record<string, unknown>> = {}): CodeParameterValues {
  object(values, '参数实例')
  const declared = new Set(program.parameters.map(parameter => parameter.key))
  for (const key of Object.keys(values)) { assertCodeMaterialKey(key); if (!declared.has(key)) throw new CodeMaterialError('PARAMETERS', `实例包含未声明参数：${key}`) }
  return Object.fromEntries(program.parameters.map(declaration => [declaration.key, validateCodeMaterialParameterValue(declaration, Object.prototype.hasOwnProperty.call(values, declaration.key) ? values[declaration.key] : declaration.default)]))
}
/** Refuse destructive source evolution rather than dropping or coercing saved instance values. */
export function checkCodeMaterialParameterCompatibility(previous: Pick<CodeMaterialProgram, 'parameters'>, next: Pick<CodeMaterialProgram, 'parameters'>, values: Readonly<Record<string, unknown>>): CodeParameterValues {
  for (const old of previous.parameters) {
    const current = next.parameters.find(item => item.key === old.key)
    if (!current || current.type !== old.type) throw new CodeMaterialError('COMPATIBILITY', `参数 ${old.key} 被删除或改变类型，需要显式迁移。`)
    if (old.type === 'number' && current.type === 'number' && (current.min > old.min || current.max < old.max)) throw new CodeMaterialError('COMPATIBILITY', `参数 ${old.key} 的范围缩小，需要显式迁移。`)
    if (old.type === 'text' && current.type === 'text' && current.maxLength < old.maxLength) throw new CodeMaterialError('COMPATIBILITY', `参数 ${old.key} 的文本上限缩小，需要显式迁移。`)
    if (old.type === 'choice' && current.type === 'choice' && old.options.some(option => !current.options.includes(option))) throw new CodeMaterialError('COMPATIBILITY', `参数 ${old.key} 的选项被删除，需要显式迁移。`)
  }
  return validateCodeMaterialParameters(next, validateCodeMaterialParameters(previous, values))
}
