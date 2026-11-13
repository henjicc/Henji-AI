import { z } from 'zod'

const sortedEntries = (value: object): Array<[string, unknown]> => Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
const byJson = (a: unknown, b: unknown): number => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')

/** 数据（default、const、enum 的取值等）只排对象键，数组顺序就是数据本身。 */
function canonicalData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalData)
  if (value && typeof value === 'object') return Object.fromEntries(sortedEntries(value).map(([name, item]) => [name, canonicalData(item)]))
  return value
}

/** 只有 schema 位置上的 required、enum 是集合，排序后比较；元组与联合的顺序保留。 */
function canonicalSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(canonicalSchema)
  if (!schema || typeof schema !== 'object') return schema
  return Object.fromEntries(sortedEntries(schema).map(([key, value]) => {
    if ((key === 'required' || key === 'enum') && Array.isArray(value)) return [key, value.map(canonicalData).sort(byJson)]
    if (SCHEMA_MAP_KEYWORDS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) return [key, Object.fromEntries(sortedEntries(value).map(([name, item]) => [name, canonicalSchema(item)]))]
    if (SCHEMA_KEYWORDS.has(key) || SCHEMA_LIST_KEYWORDS.has(key)) return [key, canonicalSchema(value)]
    return [key, canonicalData(value)]
  }))
}

/**
 * JSON Schema 元数据词汇里不影响 zod 接受哪些输入、规范化出什么输出的注解。
 * default 虽属同一词汇，但决定规范化输出，必须保留。
 */
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'examples', '$comment', 'deprecated', 'readOnly', 'writeOnly'])
const SCHEMA_MAP_KEYWORDS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'])
const SCHEMA_KEYWORDS = new Set(['items', 'additionalProperties', 'not', 'propertyNames', 'contains', 'if', 'then', 'else', 'unevaluatedProperties', 'unevaluatedItems', 'contentSchema'])
const SCHEMA_LIST_KEYWORDS = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems'])

/**
 * 只在 schema 位置去掉注解：字段名（properties 的键）和 default/const/enum 里的数据可能恰好叫 description，必须原样保留。
 * 不认识的关键字连同其中的注解一并保留，宁可让说明改动被拦下，也不漏掉结构。
 */
function withoutAnnotations(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema
  return Object.fromEntries(Object.entries(schema).filter(([key]) => !ANNOTATION_KEYWORDS.has(key)).map(([key, value]) => {
    if (SCHEMA_MAP_KEYWORDS.has(key) && value && typeof value === 'object') return [key, Object.fromEntries(Object.entries(value).map(([name, item]) => [name, withoutAnnotations(item)]))]
    if (SCHEMA_KEYWORDS.has(key)) return [key, withoutAnnotations(value)]
    if (SCHEMA_LIST_KEYWORDS.has(key) && Array.isArray(value)) return [key, value.map(withoutAnnotations)]
    return [key, value]
  }))
}

/**
 * Both accepted input and normalized output matter (defaults, stripping, requiredness).
 * 说明文字不是数据结构，默认不计入；includeAnnotations 只供一次性核对算法切换前登记的指纹。
 */
export function persistenceSchemaStructure(schemas: Readonly<Record<string, z.ZodType>>, { includeAnnotations = false } = {}): string {
  const structure = (schema: z.ZodType, io: 'input' | 'output'): unknown => {
    const json = z.toJSONSchema(schema, { io, unrepresentable: 'throw', reused: 'inline' })
    return includeAnnotations ? json : withoutAnnotations(json)
  }
  return JSON.stringify(Object.fromEntries(Object.entries(schemas).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, schema]) => [name, {
    input: canonicalSchema(structure(schema, 'input')),
    output: canonicalSchema(structure(schema, 'output')),
  }])))
}
