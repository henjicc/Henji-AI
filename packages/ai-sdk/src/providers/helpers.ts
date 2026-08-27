import { AiRuntimeError } from '../runtime/errors'
import type { JsonObject, JsonValue } from '../types/runtime'

export function normalizeEndpoint(base: string, route: string): string {
  if (route.startsWith('http://') || route.startsWith('https://')) {
    return route
  }
  if (route.startsWith('/')) {
    return `${base}${route}`
  }
  return `${base}/${route}`
}

export async function readJsonResponse(response: Response, provider: string): Promise<JsonValue> {
  const payload = await response.json().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    throw new AiRuntimeError('invalid_json', message)
  }) as JsonValue

  if (!response.ok) {
    throw new AiRuntimeError('provider_http_error', `${provider} HTTP ${response.status}: ${JSON.stringify(payload)}`)
  }

  return payload
}

export function asObject(value: JsonValue): JsonObject {
  return isJsonObject(value) ? value : {}
}

export function getPointer(value: JsonValue, pointer: string): JsonValue | undefined {
  if (pointer === '') {
    return value
  }
  let current: JsonValue | undefined = value
  for (const rawPart of pointer.split('/').slice(1)) {
    if (!isJsonObject(current) && !Array.isArray(current)) {
      return undefined
    }
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~')
    current = Array.isArray(current) ? current[Number(part)] : current[part]
  }
  return current
}

export function stringAt(value: JsonValue, pointer: string): string | undefined {
  const target = getPointer(value, pointer)
  return typeof target === 'string' ? target : undefined
}

export function numberAt(value: JsonValue, pointer: string): number | undefined {
  const target = getPointer(value, pointer)
  return typeof target === 'number' ? target : undefined
}

export function pushUniqueUrl(target: string[], url: string): void {
  if (!url.trim() || target.includes(url)) {
    return
  }
  target.push(url)
}

export function collectDeepUrls(value: JsonValue, target: string[]): void {
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value)) pushUniqueUrl(target, value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectDeepUrls(item, target)
    }
    return
  }
  if (!isJsonObject(value)) {
    return
  }
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase().includes('url') && typeof item === 'string' && /^https?:\/\//.test(item)) {
      pushUniqueUrl(target, item)
    }
    collectDeepUrls(item, target)
  }
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
