import { CodeMaterialError, finiteCodeNumber } from './contract'
import type { CodePoint } from './contract'

/** 作者声明（参数与片子数据结构）的从严读取：只认静态 JSON 数据，未声明的键直接拒绝。 */
export function declarationFail(label: string, expected: string): never { throw new CodeMaterialError('PARAMETERS', `${label} 期望${expected}。`) }
export function declarationObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) declarationFail(label, '静态 JSON 对象')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(value).length !== Object.keys(descriptors).length || Object.values(descriptors).some(field => !('value' in field) || !field.enumerable)) declarationFail(label, '无访问器的 JSON 对象')
  return value as Record<string, unknown>
}
export function declarationFields(item: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(item)) if (!allowed.includes(key)) declarationFail(`${label}.${key}`, `已声明字段（可用：${allowed.join('、')}）`)
}
export function declarationText(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || !empty && !value.length) declarationFail(label, `${empty ? '0' : '1'}–${max} 字的字符串`)
  return value
}
export function declarationBoolean(value: unknown, label: string): boolean { if (typeof value !== 'boolean') declarationFail(label, '布尔值'); return value }
export function declarationNumber(value: unknown, label: string, min: number, max: number, integer = false): number {
  const n = finiteCodeNumber(value, label)
  if (n < min || n > max || integer && !Number.isInteger(n)) declarationFail(label, `${min}–${max} 的${integer ? '整数' : '有限数值'}`)
  return n
}
export function declarationEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) declarationFail(label, allowed.join(' | '))
  return value as T
}
export function declarationPoint(value: unknown, label: string): CodePoint {
  const raw = declarationObject(value, label); declarationFields(raw, ['x', 'y'], label)
  return { x: finiteCodeNumber(raw.x, `${label}.x`), y: finiteCodeNumber(raw.y, `${label}.y`) }
}
