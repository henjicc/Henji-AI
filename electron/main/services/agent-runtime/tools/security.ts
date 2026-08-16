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

export const TOOL_PREVIEW_LIMITS: JsonLimitOptions = {
  maxBytes: 32 * 1024,
  maxDepth: 8,
  maxKeys: 128,
  maxStringLength: 2_000,
}

function inspectValue(value: unknown, options: JsonLimitOptions, depth: number, keyCount: { value: number }): void {
  if (depth > options.maxDepth) throw new Error('JSON_DEPTH_LIMIT')
  if (typeof value === 'string' && value.length > options.maxStringLength) throw new Error('JSON_STRING_LIMIT')
  if (Array.isArray(value)) {
    for (const item of value) inspectValue(item, options, depth + 1, keyCount)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) throw new Error('JSON_FORBIDDEN_KEY')
    keyCount.value += 1
    if (keyCount.value > options.maxKeys) throw new Error('JSON_KEY_LIMIT')
    inspectValue(item, options, depth + 1, keyCount)
  }
}

export function assertJsonWithinLimits(value: unknown, options: JsonLimitOptions): void {
  inspectValue(value, options, 0, { value: 0 })
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > options.maxBytes) throw new Error('JSON_BYTE_LIMIT')
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
