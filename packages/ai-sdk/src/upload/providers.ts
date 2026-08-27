import { AiRuntimeError } from '../runtime/AiRuntimeError'
import type { Transport } from '../runtime/Transport'

import { buildApiMartEndpoints } from '../providers/endpoints/apimart'
import { fetchProvider } from '../providers/provider-fetch'
import type { JsonValue } from '../types/runtime'

const KIE_UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload'
const APIMART_MAX_IMAGE_BYTES = 20 * 1024 * 1024
const APIMART_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export interface PreparedMediaBinary {
  bytes: Uint8Array
  mimeType: string
  filename: string
}

/**
 * 把字节数组编码成 base64 字符串，不依赖 Node Buffer 或浏览器 btoa。
 */
export function toBase64(bytes: Uint8Array): string {
  let encoded = ''
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]
    const second = bytes[offset + 1]
    const third = bytes[offset + 2]
    encoded += BASE64_ALPHABET[first >> 2]
    encoded += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)]
    encoded += second === undefined
      ? '='
      : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]
    encoded += third === undefined ? '=' : BASE64_ALPHABET[third & 0x3f]
  }
  return encoded
}

/** `toBase64` 的逆运算，同样不依赖 Buffer 或浏览器 atob。 */
export function fromBase64(base64: string): Uint8Array {
  const normalized = base64.replace(/\s+/g, '')
  if (normalized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(normalized)) {
    throw new AiRuntimeError('invalid_base64', 'Invalid base64 payload')
  }
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((normalized.length / 4) * 3 - padding)
  let output = 0
  for (let offset = 0; offset < normalized.length; offset += 4) {
    const a = decodeBase64Char(normalized[offset])
    const b = decodeBase64Char(normalized[offset + 1])
    const c = normalized[offset + 2] === '=' ? 0 : decodeBase64Char(normalized[offset + 2])
    const d = normalized[offset + 3] === '=' ? 0 : decodeBase64Char(normalized[offset + 3])
    bytes[output++] = (a << 2) | (b >> 4)
    if (output < bytes.length) bytes[output++] = ((b & 0x0f) << 4) | (c >> 2)
    if (output < bytes.length) bytes[output++] = ((c & 0x03) << 6) | d
  }
  return bytes
}

function decodeBase64Char(value: string): number {
  const index = BASE64_ALPHABET.indexOf(value)
  if (index < 0) throw new AiRuntimeError('invalid_base64', 'Invalid base64 payload')
  return index
}

export function toDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${toBase64(bytes)}`
}

export async function uploadToApiMart(
  apiKey: string,
  prepared: PreparedMediaBinary,
  transport: Transport
): Promise<string> {
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
  form.append('file', new Blob([prepared.bytes as BlobPart], { type: prepared.mimeType }), prepared.filename)

  const endpoints = buildApiMartEndpoints('/v1/uploads/images')
  const response = await fetchProvider('APIMart image upload', endpoints[0], {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  }, {
    transport,
    retryPreconnectOnce: true,
    fallbackEndpoints: endpoints.slice(1),
  })
  const payload = await readJson(response, 'APIMart image upload')
  const fileUrl = readStringPointer(payload, '/url') ?? readStringPointer(payload, '/data/url')
  if (!fileUrl) {
    throw new AiRuntimeError('upload_failed', `APIMart image upload missing file URL: ${JSON.stringify(payload)}`)
  }
  return fileUrl
}

export async function uploadToKie(
  apiKey: string,
  prepared: PreparedMediaBinary,
  transport: Transport
): Promise<string> {
  const form = new FormData()
  form.append('uploadPath', 'henji-uploads')
  // 不指定 fileName，让 KIE 生成唯一文件名；同名覆盖会命中 CDN 缓存并短暂返回旧文件。
  form.append('file', new Blob([prepared.bytes as BlobPart], { type: inferUploadMime(prepared.filename) }), prepared.filename)

  const response = await fetchProvider('KIE upload', KIE_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  }, {
    transport,
    retryPreconnectOnce: true,
  })
  const payload = await readJson(response, 'KIE upload')
  const fileUrl = readStringPointer(payload, '/data/fileUrl') ?? readStringPointer(payload, '/data/downloadUrl')
  if (!fileUrl) {
    throw new AiRuntimeError('upload_failed', `KIE upload missing file URL: ${JSON.stringify(payload)}`)
  }
  return fileUrl
}

/**
 * 与 `providers/helpers.ts` 的 `readJsonResponse` 故意不复用：那个版本对非 2xx 响应抛
 * `provider_http_error`，用于生成任务这类"失败了要照实暴露供应商错误"的场景；上传失败
 * 统一按 `upload_failed` 归类，是既有对外契约（前端按这个 code 区分"上传失败"与"生成失败"
 * 两类用户提示），迁移时不应该悄悄改变错误码。
 */
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

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inferUploadMime(filename: string): string {
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
