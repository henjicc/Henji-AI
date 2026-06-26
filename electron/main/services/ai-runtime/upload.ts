import type { JsonObject, JsonValue } from './types'

export async function preprocessRequestBody(
  _providerId: string,
  _route: string,
  body: JsonValue
): Promise<JsonValue> {
  assertNoLocalMediaReferences(body)
  return body
}

function assertNoLocalMediaReferences(value: JsonValue): void {
  if (typeof value === 'string') {
    if (looksLikeLocalPath(value)) {
      throw new Error('Electron AI Runtime local media upload is not migrated yet; use an already uploaded URL for this model.')
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoLocalMediaReferences(item)
    }
    return
  }
  if (isJsonObject(value)) {
    for (const item of Object.values(value)) {
      assertNoLocalMediaReferences(item)
    }
  }
}

function looksLikeLocalPath(value: string): boolean {
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) {
    return false
  }
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/')
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
