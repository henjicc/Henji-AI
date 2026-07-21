import fs from 'node:fs'
import path from 'node:path'
import { getAiProviderApiKey } from '../keystore'
import { createMainLogger } from '../logging'
import { AiRuntimeError } from './errors'
import {
  type MediaKind,
  type MediaSourceIndex,
  buildMediaSourceIndex,
  inheritMediaKind,
  isLocalMediaSource,
  isRemoteHttpUrl,
  normalizeLocalSource,
  resolveMediaKind,
} from './media-fields'
import { resolvePpioMediaRewriteMode } from './ppio-media'
import type { JsonObject, JsonValue } from './types'
import {
  type PreparedMediaBinary,
  toBase64,
  toDataUri,
  uploadToBizyair,
  uploadToFal,
  uploadToKie,
} from './upload-providers'

const logger = createMainLogger('ai-runtime')
const PUBLIC_URL_UPLOAD_PROVIDERS = ['bizyair', 'kie'] as const
const UPLOAD_PROVIDER_PRIORITY = ['bizyair', 'kie', 'fal'] as const

type PublicUrlUploadProvider = typeof PUBLIC_URL_UPLOAD_PROVIDERS[number]

interface UploadStrategy {
  primaryProvider?: string
  fallbackEnabled: boolean
}

interface PreprocessContext {
  providerId: string
  route: string
  strategy: UploadStrategy
  /** 值 → 媒体类型。由 params 里的媒体源反查，不依赖 builder 起的字段名。 */
  mediaSources: MediaSourceIndex
}

export async function preprocessRequestBody(
  providerId: string,
  route: string,
  body: JsonValue,
  params: JsonObject = {}
): Promise<JsonValue> {
  const next = cloneJson(body)
  const context: PreprocessContext = {
    providerId,
    route,
    strategy: resolveUploadStrategy(params),
    mediaSources: buildMediaSourceIndex(params),
  }
  await preprocessFieldValue(context, 'unknown', undefined, next)
  warnUnresolvedLocalMedia(providerId, route, next)
  return next
}

/**
 * 媒体字段靠字段名 hint 识别；hint 漏配时本地路径会原样发给上游，
 * 上游只会回一个含糊的参数无效错误。这里在发请求前把漏网字段打出来。
 */
function warnUnresolvedLocalMedia(providerId: string, route: string, body: JsonValue): void {
  const fields: string[] = []
  const visit = (value: JsonValue, fieldName: string | undefined): void => {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (fieldName && trimmed && isLocalMediaSource(trimmed)) {
        pushUnique(fields, fieldName)
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, fieldName)
      return
    }
    if (isJsonObject(value)) {
      for (const [key, nested] of Object.entries(value)) visit(nested, key)
    }
  }
  visit(body, undefined)
  if (fields.length === 0) {
    return
  }
  logger.warn('请求体仍包含未上传的本地媒体路径，字段名可能未命中媒体 hint', {
    event: 'ai_runtime.upload.unresolved_local_media',
    context: { providerId, route, fields },
  })
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value)
}

function resolveUploadStrategy(body: JsonValue): UploadStrategy {
  const source = isJsonObject(body) ? body : {}
  const primaryProvider = typeof source.__upload_provider === 'string' && source.__upload_provider.trim()
    ? source.__upload_provider.trim()
    : undefined
  const fallbackEnabled = typeof source.__upload_fallback === 'boolean' ? source.__upload_fallback : true
  return { primaryProvider, fallbackEnabled }
}

async function preprocessFieldValue(
  context: PreprocessContext,
  mediaKind: MediaKind,
  fieldName: string | undefined,
  value: JsonValue
): Promise<void> {
  if (typeof value === 'string') {
    return
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index]
      if (typeof item === 'string') {
        const kind = resolveMediaKind(context.mediaSources, mediaKind, item)
        if (kind !== 'unknown') {
          value[index] = await rewriteMediaSource(context, kind, fieldName, item)
        }
      } else {
        await preprocessFieldValue(context, mediaKind, fieldName, item)
      }
    }
    return
  }

  if (!isJsonObject(value)) {
    return
  }

  await preprocessPpioWan27ReferenceMediaObject(context, value)
  for (const [key, nestedValue] of Object.entries(value)) {
    const nextKind = inheritMediaKind(mediaKind, key)
    if (typeof nestedValue === 'string') {
      const kind = resolveMediaKind(context.mediaSources, nextKind, nestedValue)
      if (kind !== 'unknown') {
        value[key] = await rewriteMediaSource(context, kind, key, nestedValue)
      }
    } else {
      await preprocessFieldValue(context, nextKind, key, nestedValue)
    }
  }
}

async function preprocessPpioWan27ReferenceMediaObject(
  context: PreprocessContext,
  obj: JsonObject
): Promise<void> {
  if (context.providerId !== 'ppio' || context.route !== '/async/wan2.7-r2v') {
    return
  }
  const type = typeof obj.type === 'string' ? obj.type : ''
  const mediaKind: MediaKind = type === 'reference_video'
    ? 'video'
    : (type === 'reference_image' || type === 'first_frame' ? 'image' : 'unknown')

  if (mediaKind !== 'unknown' && typeof obj.url === 'string') {
    obj.url = await rewriteMediaSource(context, mediaKind, 'url', obj.url)
  }
  if (typeof obj.reference_voice === 'string') {
    obj.reference_voice = await rewriteMediaSource(context, 'audio', 'reference_voice', obj.reference_voice)
  }
}

async function rewriteMediaSource(
  context: PreprocessContext,
  mediaKind: MediaKind,
  fieldName: string | undefined,
  source: string
): Promise<string> {
  const trimmed = source.trim()
  if (!trimmed || isRemoteHttpUrl(trimmed)) {
    return source
  }
  if (trimmed.startsWith('blob:')) {
    throw new AiRuntimeError('unsupported_media_source', `Blob URL is not supported by backend runtime for field ${fieldName ?? '<unknown>'}.`)
  }
  if (!trimmed.startsWith('data:') && normalizeLocalSource(trimmed) === undefined) {
    return source
  }

  const prepared = prepareMediaBinary(trimmed, mediaKind)
  if (context.providerId === 'fal') {
    return uploadToFal(prepared)
  }
  if (context.providerId === 'ppio') {
    const mode = resolvePpioMediaRewriteMode(context.route, fieldName, mediaKind === 'video')
    if (mode === 'public-url') return await uploadForPublicUrl(prepared, context.strategy)
    if (mode === 'raw-base64') return toBase64(prepared.bytes)
    return toDataUri(prepared.bytes, prepared.mimeType)
  }
  if (context.providerId === 'kie' || context.providerId === 'modelscope') {
    return await uploadForHostedUrl(prepared)
  }
  return toDataUri(prepared.bytes, prepared.mimeType)
}

async function uploadForHostedUrl(prepared: PreparedMediaBinary): Promise<string> {
  const kieKey = getAiProviderApiKey('kie')
  if (kieKey) {
    try {
      return await uploadToKie(kieKey, prepared)
    } catch {
      // Fall through to BizyAir, matching the legacy fallback order.
    }
  }
  const bizyairKey = getAiProviderApiKey('bizyair')
  if (bizyairKey) {
    try {
      return await uploadToBizyair(bizyairKey, prepared)
    } catch {
      // Fall back to data URI for backward compatibility.
    }
  }
  return toDataUri(prepared.bytes, prepared.mimeType)
}

async function uploadForPublicUrl(prepared: PreparedMediaBinary, strategy: UploadStrategy): Promise<string> {
  const providers = buildPublicUrlUploadCandidates(strategy)
  const failures: string[] = []
  for (const provider of providers) {
    const apiKey = getAiProviderApiKey(provider)
    if (!apiKey) {
      failures.push(`${displayUploadProvider(provider)} 未配置`)
      continue
    }
    try {
      return provider === 'bizyair'
        ? await uploadToBizyair(apiKey, prepared)
        : await uploadToKie(apiKey, prepared)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${displayUploadProvider(provider)} 上传失败: ${message}`)
    }
  }
  throw new AiRuntimeError(
    'public_media_url_required',
    `当前 PPIO 模型字段要求公网 HTTP/HTTPS 媒体 URL。请直接传入公网 URL，或配置 BizyAir / KIE API Key。${failures.join('；')}`
  )
}

function buildPublicUrlUploadCandidates(strategy: UploadStrategy): PublicUrlUploadProvider[] {
  const candidates: PublicUrlUploadProvider[] = []
  if (strategy.primaryProvider) {
    const primary = matchPublicUrlProvider(strategy.primaryProvider)
    if (primary) candidates.push(primary)
    else if (!strategy.fallbackEnabled) return []
  }
  if (strategy.fallbackEnabled) {
    for (const provider of UPLOAD_PROVIDER_PRIORITY) {
      const publicProvider = matchPublicUrlProvider(provider)
      if (publicProvider && !candidates.includes(publicProvider)) {
        candidates.push(publicProvider)
      }
    }
  }
  return candidates
}

function prepareMediaBinary(source: string, mediaKind: MediaKind): PreparedMediaBinary {
  const dataUri = parseDataUri(source)
  if (dataUri) {
    return {
      bytes: dataUri.bytes,
      mimeType: dataUri.mimeType,
      filename: defaultFilename(mediaKind, dataUri.mimeType),
    }
  }

  const localPath = normalizeLocalSource(source)
  if (!localPath) {
    throw new AiRuntimeError('unsupported_media_source', `Unsupported media source: ${source}`)
  }
  const bytes = fs.readFileSync(localPath)
  const mimeType = inferMimeFromPath(localPath, mediaKind)
  return {
    bytes,
    mimeType,
    filename: path.basename(localPath) || defaultFilename(mediaKind, mimeType),
  }
}

function parseDataUri(input: string): { bytes: Uint8Array; mimeType: string } | undefined {
  if (!input.startsWith('data:')) return undefined
  const commaIndex = input.indexOf(',')
  if (commaIndex < 0) throw new AiRuntimeError('invalid_data_uri', 'Invalid data URI format')
  const header = input.slice(0, commaIndex)
  const payload = input.slice(commaIndex + 1)
  const mimeType = header.slice(5).split(';')[0] || 'application/octet-stream'
  const bytes = header.includes(';base64')
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload))
  return { bytes, mimeType }
}





function inferMimeFromPath(filePath: string, mediaKind: MediaKind): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.bmp') return 'image/bmp'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.m4a') return 'audio/mp4'
  if (ext === '.wav') return 'audio/wav'
  if (ext === '.flac') return 'audio/flac'
  if (ext === '.ogg') return 'audio/ogg'
  if (mediaKind === 'image') return 'image/jpeg'
  if (mediaKind === 'video') return 'video/mp4'
  if (mediaKind === 'audio') return 'audio/mpeg'
  return 'application/octet-stream'
}

function defaultFilename(mediaKind: MediaKind, mimeType: string): string {
  const ext = mimeType.includes('png') ? 'png'
    : mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg'
      : mimeType.includes('webp') ? 'webp'
        : mimeType.includes('audio/mp4') ? 'm4a'
          : mimeType.includes('mp4') ? 'mp4'
            : mimeType.includes('webm') ? 'webm'
              : mimeType.includes('mpeg') ? 'mp3'
                : mimeType.includes('wav') ? 'wav'
                  : 'bin'
  const prefix = mediaKind === 'unknown' ? 'file' : mediaKind
  return `${prefix}_${Date.now()}.${ext}`
}

function matchPublicUrlProvider(provider: string): PublicUrlUploadProvider | undefined {
  return PUBLIC_URL_UPLOAD_PROVIDERS.find((candidate) => candidate === provider)
}

function displayUploadProvider(provider: string): string {
  if (provider === 'bizyair') return 'BizyAir'
  if (provider === 'kie') return 'KIE'
  if (provider === 'fal') return 'Fal'
  return 'Upload provider'
}

function cloneJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}



function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
