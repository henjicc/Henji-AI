import { resolveRuntimeContext, type RuntimeContext } from '../runtime'
import { AiRuntimeError } from '../runtime/errors'
import { resolvePpioMediaRewriteMode } from '../providers/ppio-media'
import type { RuntimeConstraints } from '../types/model'
import type { JsonObject, JsonValue } from '../types/runtime'

import {
  buildMediaSourceIndex,
  inheritMediaKind,
  isLocalMediaSource,
  isRemoteHttpUrl,
  normalizeLocalSource,
  resolveMediaKind,
  type MediaKind,
  type MediaSourceIndex,
} from './media-fields'
import { defaultFilename, parseDataUri } from './media-binary'
import {
  toBase64,
  toDataUri,
  uploadToApiMart,
  uploadToFal,
  uploadToKie,
  type PreparedMediaBinary,
} from './providers'

const PUBLIC_URL_UPLOAD_PROVIDERS = ['kie'] as const
const UPLOAD_PROVIDER_PRIORITY = ['kie', 'fal'] as const

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
  /** schema 显式声明的特殊上传字段，优先于通用字段名推断。 */
  mediaFields: ReadonlyMap<string, Exclude<MediaKind, 'unknown'>>
  requestId?: string
  /** 宿主运行时能力，`logger`/`tracer` 已补齐默认值，内部代码不需要再判空。 */
  runtime: Required<RuntimeContext>
}

/**
 * 遍历生成请求体，把本地媒体（本地路径 / `data:` URI）改写成各供应商能接受的形式
 * （上传后的公网 URL、内联 `data:` URI，或 PPIO 少数字段要求的裸 base64）。
 *
 * `runtime` 提供本次调用需要的全部宿主能力：`media` 读本地文件字节，`credentials` 取
 * 各供应商上传凭据，`transport` 发上传请求，`logger` 记录上传过程。
 */
export async function preprocessRequestBody(
  providerId: string,
  route: string,
  body: JsonValue,
  runtime: RuntimeContext,
  params: JsonObject = {},
  constraints?: RuntimeConstraints,
  requestId?: string
): Promise<JsonValue> {
  const next = cloneJson(body)
  const context: PreprocessContext = {
    providerId,
    route,
    strategy: resolveUploadStrategy(params),
    mediaSources: buildMediaSourceIndex(params),
    mediaFields: new Map((constraints?.mediaFields ?? []).map(({ field, kind }) => [field, kind])),
    requestId,
    runtime: resolveRuntimeContext(runtime),
  }
  await preprocessFieldValue(context, 'unknown', undefined, next)
  warnUnresolvedLocalMedia(context, next)
  return next
}

/**
 * 媒体字段靠字段名 hint 识别；hint 漏配时本地路径会原样发给上游，
 * 上游只会回一个含糊的参数无效错误。这里在发请求前把漏网字段打出来。
 */
function warnUnresolvedLocalMedia(context: PreprocessContext, body: JsonValue): void {
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
  context.runtime.logger.warn('请求体仍包含未上传的本地媒体路径，字段名可能未命中媒体 hint', {
    event: 'ai_runtime.upload.unresolved_local_media',
    context: { providerId: context.providerId, route: context.route, fields },
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
    const nextKind = context.mediaFields.get(key) ?? inheritMediaKind(mediaKind, key)
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

/**
 * 供应商专属特例：PPIO Wan 2.7 参考媒体（`reference_video`/`reference_image`/`first_frame`
 * 三种 `type`，外加独立的 `reference_voice` 音频字段）挂在同一个对象里，字段名与媒体类型的
 * 对应关系由 `type` 的取值决定，不是靠字段名 hint 能推出来的——`url` 这个字段名本身完全不携带
 * "这是图片还是视频" 的信息。这类"字段语义由同一对象里另一个字段的取值决定"的耦合关系无法用
 * 声明式的字段名/kind 映射表达，只能在这里手写判断（呼应 重要记录.md 记录 007：并非所有供应商
 * 特例都能收敛成 DSL，写死的专属处理是需要接受的例外，而不是要消灭的坏味道）。
 */
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

  const prepared = await prepareMediaBinary(context.runtime, trimmed, mediaKind)
  if (context.providerId === 'apimart') {
    if (mediaKind === 'image') return await uploadApimartImage(context, prepared)
    throw new AiRuntimeError(
      'public_media_url_required',
      `APIMart 没有通用的${mediaKind === 'video' ? '视频' : (mediaKind === 'audio' ? '音频' : '文件')}上传端点。`
    )
  }
  if (context.providerId === 'fal') {
    const apiKey = await context.runtime.credentials.get('generation', 'fal')
    if (!apiKey) throw new AiRuntimeError('missing_api_key', 'Fal 本地文件必须先上传，请先在设置中配置 Fal API Key。')
    return await uploadFalFile(context, apiKey, prepared)
  }
  if (context.providerId === 'ppio') {
    const mode = resolvePpioMediaRewriteMode(context.route, fieldName, mediaKind === 'video')
    if (mode === 'public-url') return await uploadForPublicUrl(context, prepared)
    if (mode === 'raw-base64') return toBase64(prepared.bytes)
    return toDataUri(prepared.bytes, prepared.mimeType)
  }
  if (context.providerId === 'kie' || context.providerId === 'modelscope') {
    return await uploadForHostedUrl(context, prepared)
  }
  if (context.providerId === 'grsai') {
    // Grsai 没有独立上传接口，图片字段直接接受 base64/URL；本地文件转 data URI 内联进请求体即可。
    return toDataUri(prepared.bytes, prepared.mimeType)
  }
  return toDataUri(prepared.bytes, prepared.mimeType)
}

async function uploadFalFile(
  context: PreprocessContext,
  apiKey: string,
  prepared: PreparedMediaBinary
): Promise<string> {
  const { logger } = context.runtime
  const logFields = { route: context.route, mimeType: prepared.mimeType, bytes: prepared.bytes.byteLength }
  logger.info('开始上传 Fal 本地文件', {
    event: 'ai_runtime.upload.fal_started',
    requestId: context.requestId,
    providerId: 'fal',
    context: logFields,
  })
  try {
    const url = await uploadToFal(apiKey, prepared)
    logger.info('Fal 本地文件上传完成', {
      event: 'ai_runtime.upload.fal_completed',
      requestId: context.requestId,
      providerId: 'fal',
      context: logFields,
    })
    return url
  } catch (error) {
    logger.error('Fal 本地文件上传失败', {
      event: 'ai_runtime.upload.fal_failed',
      requestId: context.requestId,
      providerId: 'fal',
      context: logFields,
      error,
    })
    throw error
  }
}

async function uploadApimartImage(
  context: PreprocessContext,
  prepared: PreparedMediaBinary
): Promise<string> {
  const apiKey = await context.runtime.credentials.get('generation', 'apimart')
  if (!apiKey) {
    throw new AiRuntimeError(
      'missing_api_key',
      'APIMart 本地图片必须先上传，请先在设置中配置 APIMart API Key。'
    )
  }

  const { logger } = context.runtime
  const logFields = { route: context.route, mimeType: prepared.mimeType, bytes: prepared.bytes.byteLength }
  logger.info('开始上传 APIMart 本地图片', {
    event: 'ai_runtime.upload.apimart_started',
    requestId: context.requestId,
    providerId: 'apimart',
    context: logFields,
  })
  try {
    const url = await uploadToApiMart(apiKey, prepared, context.runtime.transport)
    logger.info('APIMart 本地图片上传完成', {
      event: 'ai_runtime.upload.apimart_completed',
      requestId: context.requestId,
      providerId: 'apimart',
      context: logFields,
    })
    return url
  } catch (error) {
    logger.error('APIMart 本地图片上传失败', {
      event: 'ai_runtime.upload.apimart_failed',
      requestId: context.requestId,
      providerId: 'apimart',
      context: logFields,
      error,
    })
    throw error
  }
}

async function uploadForHostedUrl(context: PreprocessContext, prepared: PreparedMediaBinary): Promise<string> {
  const kieKey = await context.runtime.credentials.get('generation', 'kie')
  if (kieKey) {
    try {
      return await uploadToKie(kieKey, prepared, context.runtime.transport)
    } catch {
      // Fall back to data URI for backward compatibility.
    }
  }
  return toDataUri(prepared.bytes, prepared.mimeType)
}

async function uploadForPublicUrl(context: PreprocessContext, prepared: PreparedMediaBinary): Promise<string> {
  const providers = buildPublicUrlUploadCandidates(context.strategy)
  const failures: string[] = []
  for (const provider of providers) {
    const apiKey = await context.runtime.credentials.get('generation', provider)
    if (!apiKey) {
      failures.push(`${displayUploadProvider(provider)} 未配置`)
      continue
    }
    try {
      return await uploadToKie(apiKey, prepared, context.runtime.transport)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${displayUploadProvider(provider)} 上传失败: ${message}`)
    }
  }
  throw new AiRuntimeError(
    'public_media_url_required',
    `当前 PPIO 模型字段要求公网 HTTP/HTTPS 媒体 URL。请直接传入公网 URL，或配置 KIE API Key。${failures.join('；')}`
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

/**
 * 把媒体源转换成字节。`data:` URI 的解析不需要触碰文件系统，留在 SDK 内部；本地路径的字节
 * 读取在三个目标宿主里语义完全不同（本地文件系统 / Tauri 受限文件系统 API / UXP 文档导出，
 * 见 `runtime/MediaReader.ts` 顶部注释），必须交给宿主实现的 `MediaReader`。
 */
async function prepareMediaBinary(
  runtime: Required<RuntimeContext>,
  source: string,
  mediaKind: MediaKind
): Promise<PreparedMediaBinary> {
  const dataUri = parseDataUri(source)
  if (dataUri) {
    return {
      bytes: dataUri.bytes,
      mimeType: dataUri.mimeType,
      filename: defaultFilename(dataUri.mimeType, mediaKind),
    }
  }
  return await runtime.media.read(source)
}

function matchPublicUrlProvider(provider: string): PublicUrlUploadProvider | undefined {
  return PUBLIC_URL_UPLOAD_PROVIDERS.find((candidate) => candidate === provider)
}

function displayUploadProvider(provider: string): string {
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
