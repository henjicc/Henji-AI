import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { resolveRuntimeContext, type RuntimeContext } from '../runtime/RuntimeContext'
import type { RuntimeConstraints } from '../types/model'
import type { JsonObject, JsonValue } from '../types/runtime'
import { defaultFilename, parseDataUri } from './media-binary'
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
import type { PreparedMediaBinary } from './prepared-media'

export interface ProviderPreprocessInput {
  providerId: string
  route: string
  body: JsonValue
  runtime: RuntimeContext
  params?: JsonObject
  constraints?: RuntimeConstraints
  requestId?: string
  signal?: AbortSignal
}

export interface ProviderMediaRewriteInput {
  providerId: string
  route: string
  mediaKind: Exclude<MediaKind, 'unknown'>
  fieldName?: string
  source: string
  prepared: PreparedMediaBinary
  params: JsonObject
  requestId?: string
  signal?: AbortSignal
  runtime: Required<RuntimeContext>
}

export interface ProviderObjectPreprocessInput {
  providerId: string
  route: string
  object: JsonObject
  params: JsonObject
  rewrite(
    mediaKind: Exclude<MediaKind, 'unknown'>,
    fieldName: string,
    source: string
  ): Promise<string>
}

export interface ProviderPreprocessStrategy {
  rewrite(input: ProviderMediaRewriteInput): Promise<string>
  preprocessObject?(input: ProviderObjectPreprocessInput): Promise<void>
}

interface TraversalContext {
  providerId: string
  route: string
  params: JsonObject
  mediaSources: MediaSourceIndex
  mediaFields: ReadonlyMap<string, Exclude<MediaKind, 'unknown'>>
  requestId?: string
  signal?: AbortSignal
  runtime: Required<RuntimeContext>
  strategy: ProviderPreprocessStrategy
}

/** 供应商无关的唯一媒体遍历与本地字节读取内核。 */
export async function preprocessWithProviderStrategy(
  input: ProviderPreprocessInput,
  strategy: ProviderPreprocessStrategy
): Promise<JsonValue> {
  const body = cloneJson(input.body)
  const params = input.params ?? {}
  const context: TraversalContext = {
    providerId: input.providerId,
    route: input.route,
    params,
    mediaSources: buildMediaSourceIndex(params),
    mediaFields: new Map((input.constraints?.mediaFields ?? []).map(({ field, kind }) => [field, kind])),
    requestId: input.requestId,
    signal: input.signal,
    runtime: resolveRuntimeContext(input.runtime),
    strategy,
  }
  await preprocessValue(context, 'unknown', undefined, body)
  warnUnresolvedLocalMedia(context, body)
  return body
}

async function preprocessValue(
  context: TraversalContext,
  mediaKind: MediaKind,
  fieldName: string | undefined,
  value: JsonValue
): Promise<void> {
  if (typeof value === 'string') return
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index]
      if (typeof item === 'string') {
        const kind = resolveMediaKind(context.mediaSources, mediaKind, item)
        if (kind !== 'unknown') value[index] = await rewriteMediaSource(context, kind, fieldName, item)
      } else {
        await preprocessValue(context, mediaKind, fieldName, item)
      }
    }
    return
  }
  if (!isJsonObject(value)) return

  await context.strategy.preprocessObject?.({
    providerId: context.providerId,
    route: context.route,
    object: value,
    params: context.params,
    rewrite: async (kind, field, source) => await rewriteMediaSource(context, kind, field, source),
  })
  for (const [key, nestedValue] of Object.entries(value)) {
    const nextKind = context.mediaFields.get(key) ?? inheritMediaKind(mediaKind, key)
    if (typeof nestedValue === 'string') {
      const kind = resolveMediaKind(context.mediaSources, nextKind, nestedValue)
      if (kind !== 'unknown') value[key] = await rewriteMediaSource(context, kind, key, nestedValue)
    } else {
      await preprocessValue(context, nextKind, key, nestedValue)
    }
  }
}

async function rewriteMediaSource(
  context: TraversalContext,
  mediaKind: Exclude<MediaKind, 'unknown'>,
  fieldName: string | undefined,
  source: string
): Promise<string> {
  const trimmed = source.trim()
  if (!trimmed || isRemoteHttpUrl(trimmed)) return source
  if (trimmed.startsWith('blob:')) {
    throw new AiRuntimeError(
      'unsupported_media_source',
      `Blob URL is not supported by backend runtime for field ${fieldName ?? '<unknown>'}.`
    )
  }
  if (!trimmed.startsWith('data:') && normalizeLocalSource(trimmed) === undefined) return source

  const prepared = await prepareMediaBinary(context.runtime, trimmed, mediaKind)
  return await context.strategy.rewrite({
    providerId: context.providerId,
    route: context.route,
    mediaKind,
    fieldName,
    source,
    prepared,
    params: context.params,
    requestId: context.requestId,
    signal: context.signal,
    runtime: context.runtime,
  })
}

async function prepareMediaBinary(
  runtime: Required<RuntimeContext>,
  source: string,
  mediaKind: Exclude<MediaKind, 'unknown'>
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

function warnUnresolvedLocalMedia(context: TraversalContext, body: JsonValue): void {
  const fields: string[] = []
  const visit = (value: JsonValue, fieldName: string | undefined): void => {
    if (typeof value === 'string') {
      if (fieldName && value.trim() && isLocalMediaSource(value.trim()) && !fields.includes(fieldName)) {
        fields.push(fieldName)
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
  if (fields.length > 0) {
    context.runtime.logger.warn('请求体仍包含未上传的本地媒体路径，字段名可能未命中媒体 hint', {
      event: 'ai_runtime.upload.unresolved_local_media',
      requestId: context.requestId,
      providerId: context.providerId,
      context: { route: context.route, fields },
    })
  }
}

function cloneJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
