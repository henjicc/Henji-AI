import {
  agentTraceDetailSchema,
  type AgentTraceDetail,
  type AgentTraceHttpRequest,
  type AgentTraceHttpResponse,
} from './trace'

const TRACE_MAX_STRING_LENGTH = 8 * 1024 * 1024
const TRACE_BASE64_HEAD = 160
const TRACE_BASE64_TAIL = 48
const TRACE_DATA_HEAD = 96
const TRACE_DATA_TAIL = 32

export interface TraceSanitizeResult<T> {
  value: T
  originalBytes: number
  storedBytes: number
  truncated: boolean
  sections: string[]
}

export function sanitizeAgentTraceValue(value: unknown, depth = 0): unknown {
  if (depth > 20) return '[depth-limited]'
  if (Array.isArray(value)) return value.map((item) => sanitizeAgentTraceValue(item, depth + 1))
  if (isRecord(value)) {
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      next[key] = isSensitiveKey(key) ? '***' : sanitizeAgentTraceValue(item, depth + 1)
    }
    return next
  }
  if (typeof value === 'string') return sanitizeTraceString(value)
  return value
}

export function sanitizeAgentTraceHeaders(headers: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    next[key] = isSensitiveKey(key) ? '***' : sanitizeTraceString(value)
  }
  return next
}

export function sanitizeAgentTraceUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveKey(key)) url.searchParams.set(key, '***')
    }
    return url.toString()
  } catch {
    return sanitizeTraceString(rawUrl)
  }
}

export function sanitizeAgentTraceHttpRequest(request: AgentTraceHttpRequest): AgentTraceHttpRequest {
  return {
    method: request.method,
    url: sanitizeAgentTraceUrl(request.url),
    headers: sanitizeAgentTraceHeaders(request.headers),
    body: sanitizeAgentTraceValue(request.body),
  }
}

export function sanitizeAgentTraceHttpResponse(response: AgentTraceHttpResponse): AgentTraceHttpResponse {
  return {
    ...response,
    headers: response.headers ? sanitizeAgentTraceHeaders(response.headers) : undefined,
    errorBody: response.errorBody === undefined ? undefined : sanitizeAgentTraceValue(response.errorBody),
  }
}

export function sanitizeAgentTraceDetail(detail: AgentTraceDetail): AgentTraceDetail {
  const sanitized = sanitizeAgentTraceValue(detail) as AgentTraceDetail
  const next = agentTraceDetailSchema.parse({
    ...sanitized,
    httpRequest: sanitized.httpRequest
      ? sanitizeAgentTraceHttpRequest(sanitized.httpRequest)
      : undefined,
    httpResponse: sanitized.httpResponse
      ? sanitizeAgentTraceHttpResponse(sanitized.httpResponse)
      : undefined,
  })
  next.capture.storedBytes = serializedBytes(next)
  const actualBytes = serializedBytes(next)
  if (actualBytes !== next.capture.storedBytes) next.capture.storedBytes = actualBytes
  return next
}

export function fitAgentTraceDetail<T extends Record<string, unknown>>(
  value: T,
  maxBytes: number,
  sectionOrder: string[],
  protectedSections: string[] = []
): TraceSanitizeResult<T> {
  const originalBytes = serializedBytes(value)
  const sanitized = sanitizeAgentTraceValue(value) as T
  const sanitizedBytes = serializedBytes(sanitized)
  if (sanitizedBytes <= maxBytes) {
    return { value: sanitized, originalBytes, storedBytes: sanitizedBytes, truncated: false, sections: [] }
  }

  const next: Record<string, unknown> = { ...sanitized }
  const sections: string[] = []
  for (const section of sectionOrder) {
    if (serializedBytes(next) <= maxBytes) break
    if (!(section in next)) continue
    next[section] = '[trace-section-truncated]'
    sections.push(section)
  }

  if (serializedBytes(next) > maxBytes) {
    for (const key of Object.keys(next)) {
      if (serializedBytes(next) <= maxBytes) break
      if (sections.includes(key) || protectedSections.includes(key)) continue
      next[key] = '[trace-section-truncated]'
      sections.push(key)
    }
  }

  const storedBytes = serializedBytes(next)
  return { value: next as T, originalBytes, storedBytes, truncated: true, sections }
}

export function serializedBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return 0
  }
}

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return lower.includes('api_key') ||
    lower.includes('apikey') ||
    lower.includes('authorization') ||
    lower.includes('cookie') ||
    lower === 'token' ||
    lower.endsWith('_token') ||
    lower.endsWith('-token') ||
    lower === 'accesstoken' ||
    lower === 'refreshtoken' ||
    lower.includes('secret') ||
    lower.includes('password')
}

function sanitizeTraceString(value: string): string {
  if (value.startsWith('data:')) return summarize(value, TRACE_DATA_HEAD, TRACE_DATA_TAIL, 'data-uri')
  if (looksLikeBase64(value)) return summarize(value, TRACE_BASE64_HEAD, TRACE_BASE64_TAIL, 'base64')
  const redacted = redactInlineSecrets(value)
  if (redacted.length <= TRACE_MAX_STRING_LENGTH) return redacted
  return summarize(redacted, TRACE_MAX_STRING_LENGTH - 1024, 512, 'long-string')
}

function redactInlineSecrets(value: string): string {
  return value
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/giu, '$1 ***')
    .replace(
      /(["']?(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|authorization|cookie|secret|password)["']?\s*[:=]\s*)(["'])[^"'\r\n]*\2/giu,
      '$1$2***$2'
    )
    .replace(
      /(\b(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|authorization|cookie|secret|password)\b\s*[:=]\s*)[^\s&,;\r\n]+/giu,
      '$1***'
    )
}

function summarize(value: string, head: number, tail: number, label: string): string {
  if (value.length <= head + tail + 24) return value
  return `${value.slice(0, head)}...(len=${value.length}, ${label})...${value.slice(-tail)}`
}

function looksLikeBase64(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= 512 && /^[A-Za-z0-9+/=_\-\r\n]+$/.test(trimmed)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
