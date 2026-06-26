import { Blob } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { AiRuntimeError } from './errors'
import type { JsonObject, JsonValue } from './types'

const KIE_UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload'
const BIZYAIR_TOKEN_URL = 'https://api.bizyair.cn/x/v1/upload/token'
const BIZYAIR_COMMIT_URL = 'https://api.bizyair.cn/x/v1/input_resource/commit'

export interface PreparedMediaBinary {
  bytes: Uint8Array
  mimeType: string
  filename: string
}

export function uploadToFal(prepared: PreparedMediaBinary): string {
  return toDataUri(prepared.bytes, prepared.mimeType)
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

export async function uploadToBizyair(apiKey: string, prepared: PreparedMediaBinary): Promise<string> {
  const tokenData = await fetchUploadToken(apiKey, prepared.filename)
  const fileInfo = readObjectPointer(tokenData, '/data/file')
  const storage = readObjectPointer(tokenData, '/data/storage')

  const objectKey = readRequiredString(fileInfo, 'object_key')
  await uploadToAliyunOss(
    prepared,
    readRequiredString(storage, 'endpoint'),
    readRequiredString(storage, 'bucket'),
    objectKey,
    readRequiredString(fileInfo, 'access_key_id'),
    readRequiredString(fileInfo, 'access_key_secret'),
    readRequiredString(fileInfo, 'security_token')
  )

  return await commitResource(apiKey, prepared.filename, objectKey)
}

export function toDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

async function fetchUploadToken(apiKey: string, filename: string): Promise<JsonValue> {
  const url = new URL(BIZYAIR_TOKEN_URL)
  url.searchParams.set('file_name', filename)
  url.searchParams.set('file_type', 'inputs')
  const response = await fetch(url, {
    headers: { Authorization: toBearerAuth(apiKey) },
  })
  const payload = await readJson(response, 'BizyAir token')
  if (readBool(payload, 'status') !== true) {
    throw new AiRuntimeError('upload_failed', readString(payload, 'message') ?? 'BizyAir token request failed')
  }
  return payload
}

async function uploadToAliyunOss(
  prepared: PreparedMediaBinary,
  endpoint: string,
  bucket: string,
  objectKey: string,
  accessKeyId: string,
  accessKeySecret: string,
  securityToken: string
): Promise<void> {
  const contentType = inferMime(prepared.filename)
  const date = new Date().toUTCString()
  const canonicalOssHeaders = `x-oss-security-token:${securityToken}`
  const canonicalResource = `/${bucket}/${objectKey}`
  const stringToSign = `PUT\n\n${contentType}\n${date}\n${canonicalOssHeaders}\n${canonicalResource}`
  const signature = createHmac('sha1', accessKeySecret).update(stringToSign).digest('base64')
  const objectPath = objectKey.split('/').map(encodeURIComponent).join('/')

  const response = await fetch(`${normalizeOssUploadBase(endpoint, bucket)}/${objectPath}`, {
    method: 'PUT',
    headers: {
      Authorization: `OSS ${accessKeyId}:${signature}`,
      Date: date,
      'x-oss-security-token': securityToken,
      'Content-Type': contentType,
    },
    body: prepared.bytes,
  })

  if (!response.ok) {
    throw new AiRuntimeError('upload_failed', `OSS PUT HTTP ${response.status}: ${await response.text()}`)
  }
}

async function commitResource(apiKey: string, filename: string, objectKey: string): Promise<string> {
  const response = await fetch(BIZYAIR_COMMIT_URL, {
    method: 'POST',
    headers: {
      Authorization: toBearerAuth(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: filename, object_key: objectKey }),
  })
  const payload = await readJson(response, 'BizyAir commit')
  if (readBool(payload, 'status') !== true) {
    throw new AiRuntimeError('upload_failed', readString(payload, 'message') ?? 'BizyAir commit failed')
  }
  const url = readStringPointer(payload, '/data/url')
  if (!url) {
    throw new AiRuntimeError('upload_failed', `BizyAir commit missing data.url: ${JSON.stringify(payload)}`)
  }
  return url
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

function normalizeOssUploadBase(endpoint: string, bucket: string): string {
  const raw = endpoint.trim().replace(/\/+$/, '')
  if (!raw) {
    throw new AiRuntimeError('upload_failed', 'BizyAir storage endpoint is empty')
  }
  const stripped = raw.replace(/^https?:\/\//, '')
  return `https://${bucket}.${stripped}`
}

function toBearerAuth(apiKey: string): string {
  return apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`
}

function readObjectPointer(value: JsonValue, pointer: string): JsonObject {
  const target = getPointer(value, pointer)
  if (!isJsonObject(target)) {
    throw new AiRuntimeError('upload_failed', `BizyAir token missing ${pointer}`)
  }
  return target
}

function readRequiredString(source: JsonObject, key: string): string {
  const value = source[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new AiRuntimeError('upload_failed', `BizyAir token missing ${key}`)
  }
  return value
}

function readString(source: JsonValue, key: string): string | undefined {
  return isJsonObject(source) && typeof source[key] === 'string' ? source[key] : undefined
}

function readBool(source: JsonValue, key: string): boolean | undefined {
  return isJsonObject(source) && typeof source[key] === 'boolean' ? source[key] : undefined
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
