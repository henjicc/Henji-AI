import { getLogCaptureMode, type LogCaptureMode } from './capture-config'
import type { MainLogEvent } from './types'
import type { JsonObject, JsonValue } from '../ai-runtime/types'

/**
 * 请求/响应体脱敏 + 截断工具。
 *
 * 从 `ai-runtime/trace.ts` 抽出，供 LLM Runtime（`services/llm/runtime.ts`）与
 * AI Runtime（`services/ai-runtime/trace.ts`）共用，避免同一套脱敏规则维护两份。
 *
 * 截断行为按 `capture-config.ts` 的捕获模式分档（见 1.3 任务）：
 * - 脱敏（`isSensitiveKey`）任何模式下都强制生效，不受捕获模式影响。
 * - `standard` 模式：行为与改动前一致（长字符串/深度/base64 均按固定阈值截断）。
 * - `full` 模式：跳过长字符串截断与深度截断，`data:image/*` 原文完整保留；
 *   但音频/视频（`data:audio/*`、`data:video/*`）及无法识别类型的超长裸 base64
 *   （不带 `data:` 前缀、只是形似 base64 的长字符串）仍强制走"头尾摘要 + 长度标注"，
 *   因为这类内容对人工排查没有可读价值，完整保留只会让日志文件迅速膨胀。
 */

const MAX_DEPTH = 12
const DATA_URI_HEAD_LEN = 96
const DATA_URI_TAIL_LEN = 32
const LONG_STRING_HEAD_LEN = 1200
const LONG_STRING_TAIL_LEN = 240
const BASE64_HEAD_LEN = 160
const BASE64_TAIL_LEN = 48

/** 单条日志事件体积保险丝（字节）：无论捕获模式如何，超限一律强制截断，防止拖垮写入与页面渲染。 */
export const MAIN_LOG_EVENT_MAX_BYTES = 2 * 1024 * 1024

export function sanitizeJsonValue(value: JsonValue, depth = 0): JsonValue {
  const mode = getLogCaptureMode()
  if (mode === 'standard' && depth >= MAX_DEPTH) {
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
    return sanitizeString(value, mode)
  }
  return value
}

/**
 * 单条事件体积保险丝：序列化后超过 `MAIN_LOG_EVENT_MAX_BYTES` 时，强制丢弃
 * `context`/`error`（这两个字段是唯一可能无界增长的字段），并标注 `truncatedByLimit: true`。
 * 由 `push.ts` 的 `appendLogEvents` 统一调用，覆盖前端桥接事件与主进程自身事件。
 */
export function applyEventSizeFuse(event: MainLogEvent): MainLogEvent {
  const byteLength = Buffer.byteLength(JSON.stringify(event), 'utf8')
  if (byteLength <= MAIN_LOG_EVENT_MAX_BYTES) {
    return event
  }
  return {
    ...event,
    context: { truncatedByLimit: true, originalBytes: byteLength },
    error: undefined,
    truncatedByLimit: true,
  }
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

function sanitizeString(value: string, mode: LogCaptureMode): string {
  if (value.startsWith('data:')) {
    // 完整捕获模式下只有图片保留原文；音频/视频及其他无法识别的 data: 类型仍摘要。
    if (mode === 'full' && isImageDataUri(value)) {
      return value
    }
    return summarizeDataUri(value)
  }
  // 不带 data: 前缀、形似 base64 的长字符串属于"无法识别类型"，任何模式下都摘要。
  if (looksLikeBase64(value)) {
    return summarizeCompactString(value, BASE64_HEAD_LEN, BASE64_TAIL_LEN, 'base64')
  }
  if (mode === 'full') {
    return value
  }
  if ([...value].length > LONG_STRING_HEAD_LEN + LONG_STRING_TAIL_LEN) {
    return summarizeCompactString(value, LONG_STRING_HEAD_LEN, LONG_STRING_TAIL_LEN, 'truncated')
  }
  return value
}

function isImageDataUri(value: string): boolean {
  return /^data:image\//i.test(value)
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
