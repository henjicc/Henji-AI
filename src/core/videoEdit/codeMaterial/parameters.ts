import { CodeMaterialError, assertCodeMaterialKey, codeColor, codeImageReference, codeAudioReference, codeSceneReference, finiteCodeNumber } from './contract'
import type { CodeMaterialMetadata } from '../codeMaterialDocument'
import type { CodeParameterDeclaration, CodeParameterValue, CodeParameterValues } from './contract'
import { validateCodeMaterialV3ParameterValue } from './parameterTypes'

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CodeMaterialError('PARAMETERS', `${label}必须是静态对象。`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.length)) throw new CodeMaterialError('PARAMETERS', `${label}必须是长度不超过 ${max} 的文本。`)
  return value
}
export function validateCodeMaterialParameterValue(declaration: CodeParameterDeclaration, value: unknown): CodeParameterValue {
  const { key } = declaration
  if (declaration.type === 'number') { const number = finiteCodeNumber(value, key); if (number < declaration.min || number > declaration.max) throw new CodeMaterialError('PARAMETERS', `${key} 超出声明范围 ${declaration.min}–${declaration.max}，期望有限数值。`); return number }
  if (declaration.type === 'color') { const color = codeColor(value, key); if (declaration.alpha === false && color[3] !== 1) throw new CodeMaterialError('PARAMETERS', `${key} 期望 RGBA，alpha 固定为 1。`); return color }
  if (declaration.type === 'boolean' && typeof value === 'boolean') return value
  if (declaration.type === 'choice' && typeof value === 'string' && declaration.options.includes(value)) return value
  if (declaration.type === 'text') return text(value, key, declaration.maxLength, true)
  if (declaration.type === 'audio') return value === null ? null : codeAudioReference(value, key)
  if (declaration.type === 'image') return value === null ? null : codeImageReference(value, key)
  if (declaration.type === 'scene') return value === null ? null : codeSceneReference(value, key)
  return validateCodeMaterialV3ParameterValue(declaration, value)
}
export function validateCodeMaterialParameters(program: Pick<CodeMaterialMetadata, 'parameters'>, values: Readonly<Record<string, unknown>> = {}): CodeParameterValues {
  object(values, '参数实例')
  const declared = new Set(program.parameters.map(parameter => parameter.key))
  for (const key of Object.keys(values)) { assertCodeMaterialKey(key); if (!declared.has(key)) throw new CodeMaterialError('PARAMETERS', `实例包含未声明参数：${key}`) }
  return Object.fromEntries(program.parameters.map(declaration => [declaration.key, validateCodeMaterialParameterValue(declaration, Object.prototype.hasOwnProperty.call(values, declaration.key) ? values[declaration.key] : declaration.default)]))
}
