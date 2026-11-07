import { z } from 'zod'

/** 官方输入格式快照与比对，Fal、KIE 两份官方格式测试共用。只在测试里使用。 */

export type JsonSchema = Record<string, unknown>

// 只留校验要用的关键字；说明、示例与界面提示占了快照的大半体积，校验用不到。
const DROPPED_KEYS = new Set(['description', 'examples', 'example', 'title', 'x-fal-order-properties', 'ui', 'metadata'])

/** 把 components 里的引用展开成一份自包含的输入格式，顺带去掉校验用不到的关键字。 */
export function resolveRefs(value: unknown, schemas: Record<string, unknown>, seen: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, schemas, seen))
  if (!value || typeof value !== 'object') return value
  const ref = (value as { $ref?: unknown }).$ref
  if (typeof ref === 'string') {
    const name = ref.split('/').pop() ?? ''
    if (seen.includes(name)) return {}
    return resolveRefs(schemas[name], schemas, [...seen, name])
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !DROPPED_KEYS.has(key) && !key.startsWith('x-'))
    .map(([key, item]) => [key, key === 'properties' ? Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([name, child]) => [name, resolveRefs(child, schemas, seen)])) : resolveRefs(item, schemas, seen)]))
}

// Zod 不支持的 JSON Schema 关键字：not（“不能同时传”一类互斥）与旧式 dependencies。这两类约束不参与校验，其余照常核对。
const UNSUPPORTED_KEYS = new Set(['not', 'dependencies'])

// KIE 文档生成器会在对象上留下 anyOf: [{ type: string }, ...] 这类与对象自身类型矛盾的分支（本意多是“二选一”），
// 照它校验任何对象都过不了，去掉。
function isContradictingBranches(parentType: unknown, branches: unknown): boolean {
  return parentType === 'object' && Array.isArray(branches) && branches.length > 0
    && branches.every((branch) => branch && typeof branch === 'object' && Object.keys(branch).length === 1 && (branch as { type?: unknown }).type !== undefined && (branch as { type?: unknown }).type !== 'object')
}

const COMPOSITE_KEYS = ['anyOf', 'oneOf', 'allOf']

/** 组合分支没写类型时沿用所在对象的类型，嵌套几层的矛盾分支也能认出来。 */
function withoutUnsupportedKeywords(value: unknown, inheritedType?: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutUnsupportedKeywords(item, inheritedType))
  if (!value || typeof value !== 'object') return value
  const type = (value as { type?: unknown }).type ?? inheritedType
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => !UNSUPPORTED_KEYS.has(key) && !(COMPOSITE_KEYS.includes(key) && isContradictingBranches(type, item)))
    .map(([key, item]) => [key, key === 'properties'
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([name, child]) => [name, withoutUnsupportedKeywords(child)]))
      : withoutUnsupportedKeywords(item, COMPOSITE_KEYS.includes(key) ? type : undefined)]))
}

/** 按官方格式校验一批请求：字段名、取值范围、枚举与必填项，外加官方没列的字段；同类问题只报一次。 */
export function officialSchemaProblems(
  key: string,
  schema: JsonSchema,
  requests: ReadonlyArray<{ modelId: string; label: string; body: Record<string, unknown> }>,
  nested: readonly string[] = [],
): string[] {
  const validator = z.fromJSONSchema(withoutUnsupportedKeywords(schema) as Parameters<typeof z.fromJSONSchema>[0])
  // 字段可能分在 oneOf / anyOf / allOf 的各个形态里，合起来才是官方列出的全部字段。
  const propertiesOf = (value: JsonSchema): Record<string, JsonSchema> => Object.assign({},
    ...['oneOf', 'anyOf', 'allOf'].flatMap((key) => (Array.isArray(value[key]) ? value[key] as JsonSchema[] : []).map(propertiesOf)),
    value.properties ?? {}) as Record<string, JsonSchema>
  const documented = new Set(Object.keys(propertiesOf(schema)))
  const seen = new Set<string>()
  const problems: string[] = []
  for (const { modelId, label, body } of requests) {
    const parsed = validator.safeParse(body)
    const undocumented = [
      ...Object.keys(body).filter((field) => !documented.has(field)),
      // 嵌套一层的对象（KIE 的 input）也逐个字段核对，严格模式外的格式同样能查出多余字段。
      ...nested.flatMap((parent) => {
        const child = body[parent]
        const childSchema = propertiesOf(schema)[parent]
        if (!child || typeof child !== 'object' || Array.isArray(child) || !childSchema) return []
        const known = new Set(Object.keys(propertiesOf(childSchema)))
        return Object.keys(child).filter((field) => !known.has(field)).map((field) => `${parent}.${field}`)
      }),
    ]
    const issues = [
      ...(parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.') || '(根)'} ${issue.message}`)),
      ...undocumented.map((field) => `${field} 官方未列出`),
    ]
    for (const issue of issues) {
      if (seen.has(issue)) continue
      seen.add(issue)
      problems.push(`${key}（${modelId} [${label}]）：${issue}`)
    }
  }
  return problems
}
