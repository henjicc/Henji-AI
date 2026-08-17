import { createHash } from 'node:crypto'

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])

export interface JsonLimitOptions {
  maxBytes: number
  maxDepth: number
  maxKeys: number
  maxStringLength: number
}

export const TOOL_INPUT_LIMITS: JsonLimitOptions = {
  maxBytes: 64 * 1024,
  maxDepth: 12,
  maxKeys: 500,
  maxStringLength: 32 * 1024,
}

/**
 * 只用于 modelVisible:false 的宿主持久化断点。Henji IR 本身会形成比普通工具输入更深的
 * 受控表达式树，但仍受总字节、键数和字符串长度限制；模型调用绝不能选择这组边界。
 */
export const INTERNAL_CHECKPOINT_INPUT_LIMITS: JsonLimitOptions = {
  maxBytes: 512 * 1024,
  maxDepth: 24,
  maxKeys: 10_000,
  maxStringLength: 32 * 1024,
}

export const TOOL_OUTPUT_LIMITS: JsonLimitOptions = {
  maxBytes: 1024 * 1024,
  maxDepth: 16,
  maxKeys: 5_000,
  maxStringLength: 256 * 1024,
}

/**
 * 仅供带受控解释器 checkpoint 的工具输出使用。
 *
 * checkpoint 会包含已经过编译器校验的 Henji IR，天然比普通业务 DTO 更深；仍然保留严格的
 * 总字节、键数与字符串上限，不能把这组边界用于任意应用工具输出。
 */
export const CHECKPOINT_OUTPUT_LIMITS: JsonLimitOptions = {
  maxBytes: 1024 * 1024,
  maxDepth: 24,
  maxKeys: 10_000,
  maxStringLength: 256 * 1024,
}

/**
 * 供**携带 JSON Schema** 的工具输出使用（能力发现、schema 回读）。
 *
 * JSON Schema 天然比业务 DTO 深：一个判别联合套判别联合就有十几层，再叠上投影本身的包装
 * （`scriptApi.actions[i].parameters.…`）轻松过 16。而这条限制一旦撞上，整个工具调用抛
 * INVALID_INPUT——模型连能力目录都拿不到，那个域对它等于不存在，比"结果太大被分页"严重得多。
 *
 * 实测 `image_edit` 就是这样：`create_image_edit_preview` 的 operations[] 里 kind='mark'
 * 那一支又嵌了一个七分支联合，投影后 17 层，于是该域的发现每次都失败。
 *
 * 只放宽深度，字节、键数与字符串上限与普通输出完全一致——深不等于大，放宽的是形状不是体量。
 * 与 `CHECKPOINT_OUTPUT_LIMITS` 同一思路（那条是给编译后的 Henji IR 开的）。
 */
export const SCHEMA_OUTPUT_LIMITS: JsonLimitOptions = {
  maxBytes: 1024 * 1024,
  maxDepth: 24,
  maxKeys: 5_000,
  maxStringLength: 256 * 1024,
}

export type ToolOutputLimitProfile = 'default' | 'checkpoint' | 'schema'

/**
 * 档位解析的**唯一入口**。Gateway 与门禁必须共用它。
 *
 * 分头写死档位就会变成两把尺子——门禁按一个上限判绿、生产按另一个上限抛异常，
 * 而两边都"通过"了。同类事故已经在卸载阈值上发生过一次（见
 * capability-discovery-size.test.ts 里那条"与生产一致"的断言）。
 */
export function resolveOutputLimits(profile: ToolOutputLimitProfile | undefined): JsonLimitOptions {
  if (profile === 'checkpoint') return CHECKPOINT_OUTPUT_LIMITS
  if (profile === 'schema') return SCHEMA_OUTPUT_LIMITS
  return TOOL_OUTPUT_LIMITS
}

export const TOOL_PREVIEW_LIMITS: JsonLimitOptions = {
  maxBytes: 32 * 1024,
  maxDepth: 8,
  maxKeys: 128,
  maxStringLength: 2_000,
}

/**
 * 超限错误必须带上**撞的是哪条线、实际多少、上限多少、在哪个字段**。
 *
 * 这些 `JSON_*` 会被 `toGatewayError` 翻译成一句给模型看的话。原先四条限制共用一句
 * "工具参数或预览超过安全限制"，模型收到后无从判断该缩短哪个字段、砍到多少才够——
 * 它只能整段重试，而重试的还是同一份超限载荷，于是死循环。规则里那条"容量不够就给出上限"
 * 说的就是这里。路径用点分表示，数组下标写成 [i]，够模型定位到具体字段。
 */
function limitError(code: string, detail: string, path: string[]): Error {
  const where = path.length > 0 ? path.join('.') : '(根)'
  return new Error(`${code}|${detail}|位置 ${where}`)
}

function describePath(path: string[], key: string): string[] {
  return path.length >= 8 ? path : [...path, key]
}

function inspectValue(
  value: unknown,
  options: JsonLimitOptions,
  depth: number,
  keyCount: { value: number },
  path: string[],
): void {
  if (depth > options.maxDepth) {
    throw limitError('JSON_DEPTH_LIMIT', `嵌套层级 ${depth} 超过上限 ${options.maxDepth}`, path)
  }
  if (typeof value === 'string' && value.length > options.maxStringLength) {
    throw limitError(
      'JSON_STRING_LIMIT',
      `字符串长度 ${value.length} 超过上限 ${options.maxStringLength}`,
      path,
    )
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      inspectValue(item, options, depth + 1, keyCount, describePath(path, `[${index}]`))
    }
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) {
      throw limitError('JSON_FORBIDDEN_KEY', `禁止的键名 ${key}`, path)
    }
    keyCount.value += 1
    if (keyCount.value > options.maxKeys) {
      throw limitError('JSON_KEY_LIMIT', `键总数超过上限 ${options.maxKeys}`, describePath(path, key))
    }
    inspectValue(item, options, depth + 1, keyCount, describePath(path, key))
  }
}

export function assertJsonWithinLimits(value: unknown, options: JsonLimitOptions): void {
  inspectValue(value, options, 0, { value: 0 }, [])
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > options.maxBytes) {
    throw limitError('JSON_BYTE_LIMIT', `总字节 ${bytes} 超过上限 ${options.maxBytes}`, [])
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)])
  )
}

export function digestJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export function redactAgentText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .replace(/\b(sk|pk|rk|key)-[A-Za-z0-9_-]{12,}\b/gi, '$1-***')
    .replace(/\b(set-cookie|cookie)\b\s*[:=]\s*[^\r\n]*/gi, '$1=***')
    .replace(
      /\b(api[\s_-]?key|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|token|secret|password)\b\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,"';]+)/gi,
      '$1=***'
    )
}

export function summarizeSafeText(value: string, maxLength = 2_000): string {
  const withoutSecrets = redactAgentText(value)
    .replace(/[A-Za-z]:\\[^\s"']+/g, '[本地路径]')
    .replace(/https?:\/\/[^\s]+/g, (url) => {
      try {
        const parsed = new URL(url)
        return `${parsed.origin}${parsed.pathname}`
      } catch {
        return '[URL]'
      }
    })
  return withoutSecrets.length <= maxLength ? withoutSecrets : `${withoutSecrets.slice(0, maxLength)}…`
}
