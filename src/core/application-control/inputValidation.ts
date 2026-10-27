import { z } from 'zod'

/** 所有公开工具实际接受的结果投影选项；目录与执行入口共用。 */
export const commonToolInputSchema = z.object({
  includeRevisions: z.boolean().optional(),
  includeEvidence: z.boolean().optional().describe('验证证据明细。'),
  includeDetails: z.boolean().optional().describe('完整元数据。'),
})

type InputSchema = z.ZodType | Record<string, unknown>
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const valueAt = (input: unknown, path: readonly PropertyKey[]): unknown => path.reduce<unknown>((value, key) => value !== null && typeof value === 'object' ? (value as Record<PropertyKey, unknown>)[key] : undefined, input)
const typeNames: Record<string, string> = { string: '字符串', number: '数字', integer: '整数', boolean: '布尔值', object: '对象', array: '数组', null: 'null' }
const receivedType = (value: unknown): string => value === null ? 'null' : Array.isArray(value) ? '数组' : typeNames[typeof value] ?? '未提供的值'

function resolveSchema(value: unknown, root: Record<string, unknown>): Record<string, unknown> {
  const schema = object(value)
  if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/')) return schema
  return object(schema.$ref.slice(2).split('/').reduce<unknown>((node, key) => object(node)[key.replace(/~1/g, '/').replace(/~0/g, '~')], root))
}

/** 联合类型（anyOf/oneOf）里与输入对应的分支：先按 const 判别字段匹配，再取含该字段的第一个分支。 */
function branchFor(schema: Record<string, unknown>, value: unknown, key: string, root: Record<string, unknown>): Record<string, unknown> {
  const alternatives = schema.anyOf ?? schema.oneOf
  if (!Array.isArray(alternatives)) return schema
  const branches = alternatives.map(item => resolveSchema(item, root))
  const input = object(value)
  const discriminated = branches.find(branch => {
    const consts = Object.entries(object(branch.properties)).filter(([, field]) => 'const' in object(field))
    return consts.length > 0 && consts.every(([name, field]) => object(field).const === input[name])
  })
  return discriminated ?? branches.find(branch => key in object(branch.properties)) ?? schema
}

function schemaAt(root: Record<string, unknown>, path: readonly PropertyKey[], input?: unknown): Record<string, unknown> {
  let schema = root, value = input
  for (const key of path) {
    const current = branchFor(resolveSchema(schema, root), value, String(key), root)
    schema = resolveSchema(current.type === 'array' ? current.items : object(current.properties)[String(key)], root)
    value = value !== null && typeof value === 'object' ? (value as Record<PropertyKey, unknown>)[key] : undefined
  }
  return schema
}

/** 收到的值：数组与字符串的长度错误报出实际项数或字数，其余只报类型。 */
const receivedDescription = (value: unknown, code: string): string => {
  if (code === 'too_small' || code === 'too_big') {
    if (Array.isArray(value)) return ` ${value.length} 项`
    if (typeof value === 'string') return ` ${[...value].length} 字符`
  }
  return receivedType(value)
}

function constraint(schema: Record<string, unknown>, fallback?: string): string {
  if (Array.isArray(schema.enum)) return `以下取值之一：${schema.enum.map(String).join('、')}`
  if ('const' in schema) return String(schema.const)
  const alternatives = schema.anyOf ?? schema.oneOf
  if (Array.isArray(alternatives)) return alternatives.map(item => constraint(object(item))).join('或')
  let label = typeNames[String(schema.type)] ?? typeNames[fallback ?? ''] ?? '符合参数约束的值'
  if (schema.type === 'object') {
    const keys = Array.isArray(schema.required) && schema.required.length ? schema.required.map(String) : Object.keys(object(schema.properties))
    if (keys.length) label += ` {${keys.join(', ')}}`
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof schema.minimum === 'number' && typeof schema.maximum === 'number') label = `${schema.minimum}–${schema.maximum} 的${label}`
    else if (typeof schema.minimum === 'number') label = `不小于 ${schema.minimum} 的${label}`
    else if (typeof schema.maximum === 'number') label = `不大于 ${schema.maximum} 的${label}`
    if (typeof schema.exclusiveMinimum === 'number') label = `大于 ${schema.exclusiveMinimum} 的${label}`
    if (typeof schema.exclusiveMaximum === 'number') label = `小于 ${schema.exclusiveMaximum} 的${label}`
    if (typeof schema.multipleOf === 'number') label += `（${schema.multipleOf} 的倍数）`
  }
  if (typeof schema.format === 'string') label += `（${schema.format} 格式）`
  if (typeof schema.pattern === 'string' && !schema.format) label += `（匹配 ${schema.pattern}）`
  for (const [min, max, unit] of [['minLength', 'maxLength', '字符'], ['minItems', 'maxItems', '项']] as const) {
    if (typeof schema[min] === 'number' || typeof schema[max] === 'number') {
      label += typeof schema[min] === 'number' && typeof schema[max] === 'number' ? `（${schema[min]}–${schema[max]} ${unit}）`
        : typeof schema[min] === 'number' ? `（至少 ${schema[min]} ${unit}）` : `（至多 ${schema[max]} ${unit}）`
    }
  }
  return typeof schema.description === 'string' ? `${label}；${schema.description}` : label
}

const jsonSchema = (schema?: InputSchema): Record<string, unknown> => schema instanceof z.ZodType ? z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown> : schema ?? {}

export function acceptedInputFields(schema: InputSchema, commonFields: readonly string[] = []): string {
  const root = jsonSchema(schema)
  const properties = object(root.properties)
  const required = new Set(Array.isArray(root.required) ? root.required as string[] : [])
  const accepts = Object.keys(properties).filter(key => !commonFields.includes(key)).map(key => `${key}${required.has(key) ? '（必填）' : ''}`)
  const common = commonFields.filter(key => key in properties)
  return [`这个工具接受：${accepts.join('、') || '无业务参数'}。`, ...(common.length ? [`通用：${common.join('、')}。`] : [])].join('\n')
}

/** 共用 Zod issue 投影；只披露字段、约束和收到的类型，不回显调用者输入值。 */
export function describeInputIssues(error: z.ZodError, schema?: InputSchema, input?: unknown, commonFields: readonly string[] = []): string {
  const root = jsonSchema(schema)
  const lines = error.issues.map(issue => {
    const field = issue.path.map(String).join('.') || '参数'
    if (issue.code === 'unrecognized_keys') return `不认识的参数：${issue.keys.map(key => issue.path.length ? `${field}.${key}` : key).join('、')}。`
    const fieldSchema = schemaAt(root, issue.path, input)
    const received = valueAt(input, issue.path)
    if (['invalid_type', 'invalid_value', 'invalid_union'].includes(issue.code) && input !== undefined && received === undefined) return `缺少必填参数 ${field}（${constraint(fieldSchema, issue.code === 'invalid_type' ? issue.expected : undefined)}）。`
    if (['invalid_type', 'invalid_value', 'invalid_union', 'too_small', 'too_big', 'invalid_format', 'not_multiple_of'].includes(issue.code)) {
      const expected = constraint(fieldSchema, issue.code === 'invalid_type' ? issue.expected : undefined)
      return `${field} 应为 ${expected}${input !== undefined ? `，收到${receivedDescription(received, issue.code)}` : ''}。`
    }
    return `${field}：${issue.message}`
  })
  if (schema) lines.push(acceptedInputFields(schema, commonFields))
  return lines.join('\n')
}

export function invalidInputMessage(error: unknown, schema?: InputSchema, input?: unknown, commonFields?: readonly string[]): string | null {
  return error instanceof z.ZodError ? `INVALID_INPUT:${describeInputIssues(error, schema, input, commonFields)}` : null
}
