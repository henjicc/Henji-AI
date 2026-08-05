/**
 * 工具 JSON Schema 的供应商规范化。
 *
 * 以 DeepSeek 文档为基准（strict 模式只支持 object/string/number/integer/boolean/array/enum/anyOf，
 * 明确不支持 minLength/maxLength/minItems/maxItems，且要求每个 object 都 additionalProperties:false
 * 并把全部属性列进 required），但规则本身不绑定供应商——OpenAI 的 structured outputs 是同一套
 * 约束，其他供应商要么同样接受，要么忽略。
 *
 * 之前 `toModelTool` 对每个工具都硬写 `strict: true`，而我们的 schema 里到处是可选属性和
 * min/max 约束，三条要求全违反。这类不一致不会在本地报错，只会在供应商侧变成一次难以归因的
 * 请求失败或参数被静默忽略。
 *
 * 处理方式是"如实声明"而不是"强行改造"：能满足 strict 的照常声明 strict 并剔除不支持的关键字；
 * 不满足的就老实降级成非 strict，把 min/max 之类的提示原样留给模型参考。绝不为了凑 strict 去
 * 篡改语义（例如把可选属性硬写成必填）。
 */

/** strict 模式下不被支持的校验关键字；仅在真正声明 strict 时才剔除。 */
const STRICT_UNSUPPORTED_KEYWORDS = ['minLength', 'maxLength', 'minItems', 'maxItems'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 每个 object 节点都必须显式 additionalProperties:false，且把全部属性列进 required。 */
function satisfiesStrictSubset(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(satisfiesStrictSubset)
  if (!isRecord(node)) return true
  if (isRecord(node.properties)) {
    if (node.additionalProperties !== false) return false
    const required = new Set(Array.isArray(node.required) ? node.required.map(String) : [])
    if (Object.keys(node.properties).some((key) => !required.has(key))) return false
  }
  return Object.values(node).every(satisfiesStrictSubset)
}

function stripStrictUnsupportedKeywords(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripStrictUnsupportedKeywords)
  if (!isRecord(node)) return node
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !(STRICT_UNSUPPORTED_KEYWORDS as readonly string[]).includes(key))
      .map(([key, value]) => [key, stripStrictUnsupportedKeywords(value)])
  )
}

export interface NormalizedToolSchema {
  schema: unknown
  strict: boolean
}

/**
 * 按 schema 的真实形状决定是否声明 strict，并在声明时剔除不被支持的关键字。
 *
 * @param requestedStrict 调用方期望的 strict；为 false 时直接原样透传，不做任何改写。
 */
export function normalizeProviderToolSchema(
  schema: unknown,
  requestedStrict: boolean | undefined
): NormalizedToolSchema {
  if (requestedStrict !== true) return { schema, strict: false }
  if (!satisfiesStrictSubset(schema)) return { schema, strict: false }
  return { schema: stripStrictUnsupportedKeywords(schema), strict: true }
}
