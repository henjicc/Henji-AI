import { z } from 'zod'
import type { JsonValue } from '../identifiers'
import { jsonValueSchema } from '../identifiers'
import { propertyIssueMessage } from './propertyValidationErrors'

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
export function validateJsonValueShape(propertyId: string, schema: JsonValue, value: JsonValue, domainValidator?: z.ZodType, title = propertyId, unit?: string): JsonValue {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return value
  let validator = domainValidator ?? validators.get(schema)
  if (!validator) {
    validator = z.fromJSONSchema(schema)
    validators.set(schema, validator)
  }
  const result = validator.safeParse(value)
  if (!result.success) {
    // 联合分支本身只说 Invalid input；展开叶子才能保留 shapes[0].points 等修正依据。
    const leaves = (issues: readonly z.core.$ZodIssue[]): z.core.$ZodIssue[] => issues.flatMap(issue => {
      if (issue.code !== 'invalid_union') return [issue]
      const branches = issue.errors.map(leaves)
      // 嵌套字段已被识别时，不再附加另一分支（例如空字符串）的根类型错误。
      const nested = branches.filter(branch => branch.some(child => child.path.length > issue.path.length))
      return (nested.length ? nested : branches).flat()
    })
    const issues = [...new Set(leaves(result.error.issues).map(issue => propertyIssueMessage(issue, schema, value, title === propertyId ? title : `${title}（${propertyId}）`, unit)))].join('')
    throw new Error(`INVALID_PROPERTY_VALUE:${issues}`)
  }
  return jsonValueSchema.parse(result.data)
}

/** 对象中只有声明了默认值的缺项会补全，必填项仍须提供。 */
export function objectDefaultsDescription(schema: unknown): string {
  const root = object(schema)
  const hasDefaults = (node: unknown): boolean => {
    const value = object(node)
    return 'default' in value || Object.values(object(value.properties)).some(hasDefaults)
      || hasBranches(value).some(hasDefaults) || !!value.items && hasDefaults(value.items)
  }
  const hasObject = (node: unknown): boolean => {
    const value = object(node)
    return value.type === 'object' || hasBranches(value).some(hasObject)
  }
  return hasObject(root) && hasDefaults(root) ? '未提供的字段使用已声明的默认值；无默认值的必填字段仍须提供。' : ''
}

function hasBranches(value: Record<string, unknown>): unknown[] {
  const branches = value.anyOf ?? value.oneOf ?? value.allOf
  return Array.isArray(branches) ? branches : []
}
