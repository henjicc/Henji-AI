import { Blob } from 'node:buffer'
import { AiRuntimeError } from './errors'
import type { JsonObject, JsonValue } from './types'

const KIE_UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload'
const APIMART_IMAGE_UPLOAD_URL = 'https://api.apimart.ai/v1/uploads/images'
const APIMART_MAX_IMAGE_BYTES = 20 * 1024 * 1024
const APIMART_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export interface PreparedMediaBinary {
  bytes: Uint8Array
  mimeType: string
  filename: string
}

export function uploadToFal(prepared: PreparedMediaBinary): string {
  return toDataUri(prepared.bytes, prepared.mimeType)
}

export async function uploadToApiMart(apiKey: string, prepared: PreparedMediaBinary): Promise<string> {
  if (!APIMART_IMAGE_MIME_TYPES.has(prepared.mimeType)) {
    throw new AiRuntimeError(
      'unsupported_media_type',
      `APIMart 图片上传仅支持 JPEG、PNG、WebP、GIF，当前类型为 ${prepared.mimeType}。`
    )
  }
  if (prepared.bytes.byteLength > APIMART_MAX_IMAGE_BYTES) {
    throw new AiRuntimeError(
      'upload_too_large',
      `APIMart 图片上传上限为 20 MB，当前文件为 ${prepared.bytes.byteLength} bytes。`
    )
  }

  const form = new FormData()
  form.append('file', new Blob([prepared.bytes], { type: prepared.mimeType }), prepared.filename)

  const response = await fetch(APIMART_IMAGE_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  const payload = await readJson(response, 'APIMart image upload')
  const fileUrl = readStringPointer(payload, '/url') ?? readStringPointer(payload, '/data/url')
  if (!fileUrl) {
    throw new AiRuntimeError('upload_failed', `APIMart image upload missing file URL: ${JSON.stringify(payload)}`)
  }
  return fileUrl
}

export async function uploadToKie(apiKey: string, prepared: PreparedMediaBinary): Promise<string> {
  const form = new FormData()
  form.append('uploadPath', 'henji-uploads')
  form.append('fileName', prepared.filename)
  form.append('file', new Blob([prepared.bytes], { type: inferMime(prepared.filename) }), prepared.filename)

  const response = await fetch(KIE_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  const payload = await readJson(response, 'KIE upload')
  const fileUrl = readStringPointer(payload, '/data/fileUrl') ?? readStringPointer(payload, '/data/downloadUrl')
  if (!fileUrl) {
    throw new AiRuntimeError('upload_failed', `KIE upload missing file URL: ${JSON.stringify(payload)}`)
  }
  return fileUrl
}

export function toDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

async function readJson(response: Response, label: string): Promise<JsonValue> {
  const payload = await response.json().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    throw new AiRuntimeError('upload_failed', message)
  }) as JsonValue
  if (!response.ok) {
    throw new AiRuntimeError('upload_failed', `${label} HTTP ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

function readStringPointer(value: JsonValue, pointer: string): string | undefined {
  const target = getPointer(value, pointer)
  return typeof target === 'string' ? target : undefined
}

function getPointer(value: JsonValue, pointer: string): JsonValue | undefined {
  let current: JsonValue | undefined = value
  for (const rawPart of pointer.split('/').slice(1)) {
    if (!isJsonObject(current) && !Array.isArray(current)) return undefined
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~')
    current = Array.isArray(current) ? current[Number(part)] : current[part]
  }
  return current
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inferMime(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  return 'application/octet-stream'
}
