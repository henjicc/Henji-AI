import type { z } from 'zod'
import type { JsonValue } from '../identifiers'
import { HEX_COLOR_EXAMPLE } from '../../theme/colorTokens'

export const schemaObject = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function receivedPropertyValue(value: unknown): string {
  if (value === undefined) return '未提供'
  if (Array.isArray(value)) return `数组（${value.length} 项）`
  if (value && typeof value === 'object') return '对象'
  return JSON.stringify(value)
}

export function propertySchemaAtPath(schema: unknown, path: readonly PropertyKey[]): Record<string, unknown> {
  let current = schemaObject(schema)
  for (const key of path) {
    const branches = current.anyOf ?? current.oneOf
    if (Array.isArray(branches)) current = schemaObject(branches.find(branch => {
      const candidate = schemaObject(branch)
      return typeof key === 'number' ? candidate.items : schemaObject(candidate.properties)[String(key)]
    }))
    current = schemaObject(typeof key === 'number' ? current.items : schemaObject(current.properties)[String(key)] ?? current.additionalProperties)
  }
  return current
}

export function isHexColorSchema(schema: unknown): boolean {
  const value = schemaObject(schema)
  return value['x-value-format'] === 'hex-color'
    || typeof value.pattern === 'string' && ['^#[\\da-f]{6}$', '^#[0-9a-fA-F]{6}$', '^#[0-9A-Fa-f]{6}$'].includes(value.pattern)
}

/** 格式提示只进入属性发现 schema，不改变用户文档的持久格式。 */
export function annotatePropertyValueFormats(schema: JsonValue): JsonValue {
  if (Array.isArray(schema)) return schema.map(annotatePropertyValueFormats)
  if (!schema || typeof schema !== 'object') return schema
  const value = Object.fromEntries(Object.entries(schema).map(([key, child]) => {
    if (['properties', '$defs', 'definitions', 'patternProperties'].includes(key) && child && typeof child === 'object' && !Array.isArray(child)) {
      return [key, Object.fromEntries(Object.entries(child).map(([name, field]) => [name, annotatePropertyValueFormats(field)]))]
    }
    return [key, ['items', 'prefixItems', 'additionalProperties', 'anyOf', 'oneOf', 'allOf', 'not', 'if', 'then', 'else'].includes(key) ? annotatePropertyValueFormats(child) : child]
  }))
  return isHexColorSchema(value) ? { ...value, 'x-value-format': 'hex-color' } : value
}

/** 只投影属性值的约束，不复用表单提示或工具输入错误。 */
export function propertyIssueMessage(issue: z.core.$ZodIssue, schema: unknown, input: unknown, title: string, unit?: string): string {
  const path = issue.path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${String(part)}`).join('')
  const field = path ? `${title}的 ${path} ` : title
  const shape = propertySchemaAtPath(schema, issue.path)
  const received = issue.path.reduce<unknown>((value, key) => value && typeof value === 'object' ? Reflect.get(value, key) : undefined, input)
  let constraint: string
  switch (issue.code) {
    case 'too_small':
    case 'too_big': {
      const small = issue.code === 'too_small'
      const bound = small ? issue.minimum : issue.maximum
      const amount = `${String(bound)}${issue.origin === 'string' ? ' 个字符' : issue.origin === 'array' ? ' 项' : unit ? ` ${unit}` : ''}`
      if (issue.origin === 'number' && typeof shape.minimum === 'number' && typeof shape.maximum === 'number') {
        constraint = `应在 ${shape.minimum} 到 ${shape.maximum}${unit ? ` ${unit}` : ''} 之间`
        break
      }
      constraint = issue.origin === 'number'
        ? small ? issue.inclusive ? bound === 0 ? '不能小于 0' : `至少 ${amount}` : `必须大于 ${amount}` : issue.inclusive ? `不能大于 ${amount}` : `必须小于 ${amount}`
        : `${issue.origin === 'string' ? '长度' : '数量'}${small ? '至少' : '最多'} ${amount}`
      break
    }
    case 'invalid_type': {
      const types: Record<string, string> = { string: '字符串', number: '数字', int: '整数', integer: '整数', boolean: '布尔值', object: '对象', array: '数组', null: 'null' }
      constraint = `应为${types[issue.expected] ?? '符合声明类型的值'}`
      if (issue.expected === 'object' && Array.isArray(shape.required) && shape.required.length) constraint += `，必填字段为 ${shape.required.join('、')}`
      break
    }
    case 'invalid_value': constraint = `只能取 ${issue.values.map(value => JSON.stringify(value)).join('、')}`; break
    case 'invalid_format': constraint = isHexColorSchema(shape) ? `应为 6 位十六进制颜色，例如 ${HEX_COLOR_EXAMPLE}` : issue.format === 'regex' ? `应符合格式 ${String(shape.pattern ?? issue.pattern)}` : `应为有效的 ${issue.format} 格式`; break
    case 'not_multiple_of': constraint = `应为 ${issue.divisor} 的整数倍`; break
    case 'unrecognized_keys': constraint = `包含未定义字段 ${issue.keys.join('、')}`; break
    case 'custom': constraint = /[\u3400-\u9fff]/.test(issue.message) && !/请选择|请输入/.test(issue.message) ? issue.message.replace(/[。；;.!！]+$/u, '') : '不符合该字段的取值约束'; break
    default: constraint = '不符合该字段的取值约束'
  }
  return `${field}${constraint}，收到 ${receivedPropertyValue(received)}。`
}
