import { z } from 'zod'
import type { JsonValue } from '../identifiers'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** 从正式 JSON Schema 派生简短形状；截断只影响目录展示，完整 schema 仍可按属性读取。 */
export function describeJsonValueShape(schema: unknown, depth = 0): string {
  const value = object(schema)
  if (value.const !== undefined) return JSON.stringify(value.const)
  if (Array.isArray(value.enum)) return value.enum.slice(0, 5).map(item => JSON.stringify(item)).join(' | ') + (value.enum.length > 5 ? ' | …' : '')
  const branches = value.anyOf ?? value.oneOf
  if (Array.isArray(branches)) return branches.slice(0, 4).map(item => describeJsonValueShape(item, depth)).join(' | ')
  if (value.type === 'object' || value.properties) {
    if (depth >= 2) return 'object'
    const entries = Object.entries(object(value.properties))
    const required = Array.isArray(value.required) ? value.required : []
    return `{${entries.slice(0, 6).map(([key, child]) => `${key}${required.includes(key) ? '' : '?'}: ${describeJsonValueShape(child, depth + 1)}`).join(', ')}${entries.length > 6 ? ', …' : !entries.length && value.additionalProperties ? '[key]: value' : ''}}`
  }
  if (value.type === 'array') return `${describeJsonValueShape(value.items, depth + 1)}[]`
  return Array.isArray(value.type) ? value.type.join(' | ') : typeof value.type === 'string' ? value.type : 'JSON'
}

const validators = new WeakMap<object, z.ZodType>()

/** 使用现有 Zod 的 JSON Schema 实现，领域自定义 refine 仍由正式执行器复核。 */
export function validateJsonValueShape(propertyId: string, schema: JsonValue, value: JsonValue, domainValidator?: z.ZodType): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return
  let validator = domainValidator ?? validators.get(schema)
  if (!validator) {
    validator = z.fromJSONSchema(schema)
    validators.set(schema, validator)
  }
  const result = validator.safeParse(value)
  if (!result.success) {
    // 联合分支本身只说 Invalid input；展开叶子才能保留 shapes[0].points 等修正依据。
    const leaves = (issues: readonly z.core.$ZodIssue[]): z.core.$ZodIssue[] => issues.flatMap(issue =>
      issue.code === 'invalid_union' ? issue.errors.flatMap(leaves) : [issue])
    const issues = leaves(result.error.issues).map(issue => {
      const path = issue.path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${String(part)}`).join('')
      return `${path || '值'}: ${issue.message}`
    }).join('；')
    throw new Error(`INVALID_PROPERTY_VALUE:${propertyId} 需要 ${describeJsonValueShape(schema)}；${issues}。用 describe_application_entities 的 propertyIds 读取完整 schema。`)
  }
}
