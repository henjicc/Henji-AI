import type { AiRuntimeTrace, JsonObject, JsonValue } from './types'

const MAX_DEPTH = 12
const DATA_URI_HEAD_LEN = 96
const DATA_URI_TAIL_LEN = 32
const LONG_STRING_HEAD_LEN = 1200
const LONG_STRING_TAIL_LEN = 240
const BASE64_HEAD_LEN = 160
const BASE64_TAIL_LEN = 48

export function buildGenerateTrace(
  modelId: string,
  providerId: string,
  requestId: string,
  route: string,
  method: string,
  requestBody: JsonValue,
  responseBody: JsonValue
): AiRuntimeTrace {
  return {
    modelId,
    providerId,
    requestId,
    phase: 'generate',
    route,
    method: method.toUpperCase(),
    requestBody: sanitizeJsonValue(requestBody, 0),
    responseBody: sanitizeJsonValue(responseBody, 0),
  }
}

export function buildContinuePollingTrace(
  modelId: string,
  providerId: string,
  requestId: string,
  route: string,
  taskId: string,
  responseBody: JsonValue
): AiRuntimeTrace {
  return {
    modelId,
    providerId,
    requestId,
    phase: 'continuePolling',
    route,
    method: 'GET',
    taskId: taskId.trim() || undefined,
    responseBody: sanitizeJsonValue(responseBody, 0),
  }
}

function sanitizeJsonValue(value: JsonValue, depth: number): JsonValue {
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

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return lower.includes('api_key') ||
    lower.includes('apikey') ||
    lower.includes('authorization') ||
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('password')
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
