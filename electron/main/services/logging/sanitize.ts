import type { JsonObject, JsonValue } from '../ai-runtime/types'

/**
 * 请求/响应体脱敏 + 截断工具。
 *
 * 从 `ai-runtime/trace.ts` 抽出，供 LLM Runtime（`services/llm/runtime.ts`）与
 * AI Runtime（`services/ai-runtime/trace.ts`）共用，避免同一套脱敏规则维护两份。
 * 1.3 任务（捕获开关与脱敏策略统一）会在此基础上扩展可配置项，新增逻辑时优先扩展
 * 这里而不是在调用方各写一份。
 */

const MAX_DEPTH = 12
const DATA_URI_HEAD_LEN = 96
const DATA_URI_TAIL_LEN = 32
const LONG_STRING_HEAD_LEN = 1200
const LONG_STRING_TAIL_LEN = 240
const BASE64_HEAD_LEN = 160
const BASE64_TAIL_LEN = 48

export function sanitizeJsonValue(value: JsonValue, depth = 0): JsonValue {
  if (depth >= MAX_DEPTH) {
    return '[depth-limited]'
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item, depth + 1))
  }
  if (isJsonObject(value)) {
    const next: JsonObject = {}
    for (const [key, item] of Object.entries(value)) {
      next[key] = isSensitiveKey(key) ? '***' : sanitizeJsonValue(item, depth + 1)
    }
    return next
  }
  if (typeof value === 'string') {
    return sanitizeString(value)
  }
  return value
}

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return lower.includes('api_key') ||
    lower.includes('apikey') ||
    lower.includes('authorization') ||
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('password')
}

function sanitizeString(value: string): string {
  if (value.startsWith('data:')) {
    return summarizeDataUri(value)
  }
  if (looksLikeBase64(value)) {
    return summarizeCompactString(value, BASE64_HEAD_LEN, BASE64_TAIL_LEN, 'base64')
  }
  if ([...value].length > LONG_STRING_HEAD_LEN + LONG_STRING_TAIL_LEN) {
    return summarizeCompactString(value, LONG_STRING_HEAD_LEN, LONG_STRING_TAIL_LEN, 'truncated')
  }
  return value
}

function summarizeDataUri(value: string): string {
  const commaIndex = value.indexOf(',')
  if (commaIndex < 0) {
    return summarizeCompactString(value, DATA_URI_HEAD_LEN, DATA_URI_TAIL_LEN, 'data-uri')
  }
  return `${value.slice(0, commaIndex + 1)}${summarizeCompactString(
    value.slice(commaIndex + 1),
    DATA_URI_HEAD_LEN,
    DATA_URI_TAIL_LEN,
    'data-uri'
  )}`
}

function summarizeCompactString(value: string, head: number, tail: number, label: string): string {
  const chars = [...value]
  if (chars.length <= head + tail + 24) {
    return value
  }
  return `${chars.slice(0, head).join('')}...(len=${chars.length}, ${label})...${chars.slice(-tail).join('')}`
}

function looksLikeBase64(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= 512 && /^[A-Za-z0-9+/=_\-\r\n]+$/.test(trimmed)
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
