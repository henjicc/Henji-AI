import { fetchProvider } from '../../../providers/provider-fetch'
import { AiRuntimeError } from '../../../runtime/AiRuntimeError'
import {
  defineTranslationDescriptor,
  type TranslationInput,
  type TranslationItem,
  type TranslationModule,
  type TranslationOutput,
  type TranslationUsage,
} from '../index'
import { readQwenMtSse } from './sse'
import {
  BAILIAN_QWEN_MT_PRESETS,
  DEFAULT_BAILIAN_QWEN_MT_ENDPOINT,
  type BailianQwenMtInputOptions,
  type BailianQwenMtModelId,
  type BailianQwenMtModuleConfig,
  type BailianQwenMtPreset,
  type BailianTranslationMemoryItem,
} from './types'
import { normalizeBailianQwenMtLanguage } from './languages'

interface NormalizedInputOptions {
  stream: boolean
  translationMemory?: readonly BailianTranslationMemoryItem[]
}

interface QwenMtItemResult {
  item: TranslationItem
  usage?: TranslationUsage
  metadata: {
    requestId?: string
    responseModel?: string
    finishReason?: string
  }
}

const ALLOWED_OPTION_KEYS = new Set(['stream', 'translationMemory'])

export function createBailianQwenMtTranslationModule(
  modelId: BailianQwenMtModelId,
  config: BailianQwenMtModuleConfig = {}
): TranslationModule {
  const preset = findPreset(modelId)
  const endpoint = normalizeEndpoint(config.endpoint)
  const defaultStream = config.defaultStream ?? true
  return {
    descriptor: {
      ...defineTranslationDescriptor({
        id: preset.moduleId,
        version: '1',
        providerIds: ['bailian'],
        modelId: preset.modelId,
        streaming: true,
        features: ['terminology', 'translation-memory', 'domain-hint', 'usage'],
        tags: ['bailian', 'qwen-mt'],
      }),
      executionModes: ['request-response', 'event-stream'],
    },
    execute: async (input, context) => {
      const source = normalizeSource(input)
      const options = normalizeOptions(input.options, defaultStream)
      const targetLanguage = normalizeBailianQwenMtLanguage(requireText(input.targetLanguage, 'targetLanguage'))
      const sourceLanguage = normalizeBailianQwenMtLanguage(input.sourceLanguage?.trim() || 'auto')
      const apiKey = await context.runtime.credentials.get('translation', 'bailian')
      if (!apiKey?.trim()) {
        throw new AiRuntimeError('api_key_missing', 'Bailian translation API key is not configured')
      }

      await context.emit({ type: 'started' })
      const translations: TranslationItem[] = []
      const metadata: QwenMtItemResult['metadata'][] = []
      let usage: TranslationUsage | undefined
      for (let index = 0; index < source.length; index += 1) {
        const entry = source[index]
        const result = entry.text.length === 0
          ? { item: { text: '', sourceText: entry.text, id: entry.id }, metadata: {} }
          : await executeItem({
              apiKey: apiKey.trim(), endpoint, preset, input, options,
              sourceLanguage, targetLanguage, entry, index, context,
            })
        translations.push(result.item)
        metadata.push(result.metadata)
        usage = addUsage(usage, result.usage)
        await context.emit({ type: 'item', index, item: result.item })
      }
      const output: TranslationOutput = {
        translations,
        usage,
        providerMetadata: { providerId: 'bailian', modelId: preset.modelId, items: metadata },
      }
      await context.emit({ type: 'completed', output })
      return output
    },
  }
}

export function createQwenMtFlashTranslationModule(
  config?: BailianQwenMtModuleConfig
): TranslationModule {
  return createBailianQwenMtTranslationModule('qwen-mt-flash', config)
}

export function createQwenMtPlusTranslationModule(
  config?: BailianQwenMtModuleConfig
): TranslationModule {
  return createBailianQwenMtTranslationModule('qwen-mt-plus', config)
}

export function createQwenMtLiteTranslationModule(
  config?: BailianQwenMtModuleConfig
): TranslationModule {
  return createBailianQwenMtTranslationModule('qwen-mt-lite', config)
}

async function executeItem(input: {
  apiKey: string
  endpoint: string
  preset: BailianQwenMtPreset
  input: TranslationInput
  options: NormalizedInputOptions
  sourceLanguage: string
  targetLanguage: string
  entry: { text: string; id?: string }
  index: number
  context: Parameters<TranslationModule['execute']>[1]
}): Promise<QwenMtItemResult> {
  const { context, preset, index, entry } = input
  const span = context.runtime.tracer.startSpan('bailian.translation.request', {
    requestId: context.requestId,
    providerId: 'bailian',
    modelId: preset.modelId,
    itemIndex: index,
  })
  context.runtime.logger.info('百炼翻译请求开始', {
    event: 'bailian.translation.request.start', requestId: context.requestId,
    providerId: 'bailian', modelId: preset.modelId, context: { itemIndex: index },
  })
  try {
    const response = await fetchProvider('Bailian Qwen-MT', input.endpoint, {
      method: 'POST',
      headers: {
        Accept: input.options.stream ? 'text/event-stream' : 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildRequestBody(input)),
      signal: context.signal,
    }, { transport: context.runtime.transport, retryPreconnectOnce: true })
    if (!response.ok) throw await createHttpError(response)

    const result = input.options.stream
      ? await parseStreamingResponse(response, input)
      : await parseCompleteResponse(response, entry)
    context.runtime.logger.info('百炼翻译请求完成', {
      event: 'bailian.translation.request.completed', requestId: context.requestId,
      providerId: 'bailian', modelId: preset.modelId,
      context: { itemIndex: index, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens },
    })
    span.end()
    return result
  } catch (error) {
    context.runtime.logger.error('百炼翻译请求失败', {
      event: 'bailian.translation.request.failed', requestId: context.requestId,
      providerId: 'bailian', modelId: preset.modelId, context: { itemIndex: index }, error,
    })
    span.end(error)
    throw error
  }
}

function buildRequestBody(input: Parameters<typeof executeItem>[0]): Record<string, unknown> {
  const terms = Object.entries(input.input.terminology ?? {}).map(([source, target], index) => ({
    source: requireText(source, `terminology[${index}].source`),
    target: requireText(target, `terminology[${index}].target`),
  }))
  const translationOptions: Record<string, unknown> = {
    source_lang: input.sourceLanguage,
    target_lang: input.targetLanguage,
  }
  if (terms.length > 0) translationOptions.terms = terms
  if (input.options.translationMemory?.length) translationOptions.tm_list = input.options.translationMemory
  if (input.input.context?.trim()) translationOptions.domains = input.input.context.trim()
  return {
    model: input.preset.modelId,
    messages: [{ role: 'user', content: input.entry.text }],
    translation_options: translationOptions,
    stream: input.options.stream,
    ...(input.options.stream ? { stream_options: { include_usage: true } } : {}),
  }
}

async function parseStreamingResponse(
  response: Response,
  input: Parameters<typeof executeItem>[0]
): Promise<QwenMtItemResult> {
  if (!response.body) {
    throw new AiRuntimeError('provider_response_invalid', 'Bailian Qwen-MT streaming response body is empty')
  }
  const result = await readQwenMtSse(
    response.body, input.preset.streamingContent, input.context.signal,
    {
      onDelta: async (delta) => await input.context.emit({
        type: 'delta', index: input.index, id: input.entry.id, ...delta,
      }),
      onUsage: async (usage) => await input.context.emit({
        type: 'usage', index: input.index, id: input.entry.id, usage,
      }),
    }
  )
  return {
    item: { text: result.text, sourceText: input.entry.text, id: input.entry.id },
    usage: result.usage,
    metadata: {
      requestId: result.requestId,
      responseModel: result.responseModel,
      finishReason: result.finishReason,
    },
  }
}

async function parseCompleteResponse(
  response: Response,
  entry: { text: string; id?: string }
): Promise<QwenMtItemResult> {
  const payload = await readJson(response)
  throwPayloadError(payload)
  const choice = Array.isArray(payload.choices) && isRecord(payload.choices[0])
    ? payload.choices[0]
    : undefined
  const message = isRecord(choice?.message) ? choice.message : undefined
  const text = typeof message?.content === 'string' ? message.content : undefined
  if (text === undefined) {
    throw new AiRuntimeError('empty_result', 'Bailian Qwen-MT response has no translated text')
  }
  return {
    item: { text, sourceText: entry.text, id: entry.id },
    usage: readUsage(payload.usage),
    metadata: {
      requestId: readNonEmptyString(payload.id),
      responseModel: readNonEmptyString(payload.model),
      finishReason: readNonEmptyString(choice?.finish_reason),
    },
  }
}

async function createHttpError(response: Response): Promise<AiRuntimeError> {
  const payload = await readJson(response, true)
  const error = isRecord(payload.error) ? payload.error : undefined
  const providerCode = readNonEmptyString(error?.code) ?? readNonEmptyString(payload.code)
  const message = readNonEmptyString(error?.message) ?? readNonEmptyString(payload.message)
    ?? `HTTP ${response.status}`
  const code = response.status === 401 || response.status === 403
    ? 'provider_auth_error'
    : response.status === 429
      ? 'provider_rate_limited'
      : response.status >= 500
        ? 'provider_http_error'
        : 'provider_request_failed'
  return new AiRuntimeError(code, `Bailian Qwen-MT ${providerCode ? `${providerCode}: ` : ''}${message}`)
}

async function readJson(response: Response, allowInvalid = false): Promise<Record<string, unknown>> {
  try {
    const value = await response.json() as unknown
    if (isRecord(value)) return value
  } catch {
    if (allowInvalid) return {}
  }
  if (allowInvalid) return {}
  throw new AiRuntimeError('provider_response_invalid', 'Bailian Qwen-MT response is not valid JSON')
}

function throwPayloadError(payload: Record<string, unknown>): void {
  const error = isRecord(payload.error) ? payload.error : undefined
  const code = readNonEmptyString(error?.code) ?? readNonEmptyString(payload.code)
  if (!code) return
  const message = readNonEmptyString(error?.message) ?? readNonEmptyString(payload.message) ?? code
  throw new AiRuntimeError('provider_task_failed', `Bailian Qwen-MT ${code}: ${message}`)
}

function normalizeSource(input: TranslationInput): Array<{ text: string; id?: string }> {
  if (typeof input.source === 'string') return [{ text: input.source }]
  return input.source.map((item) => ({ text: item.text, id: item.id }))
}

function normalizeOptions(
  value: Readonly<Record<string, unknown>> | undefined,
  defaultStream: boolean
): NormalizedInputOptions {
  if (!value) return { stream: defaultStream }
  const unknownKeys = Object.keys(value).filter((key) => !ALLOWED_OPTION_KEYS.has(key))
  if (unknownKeys.length > 0) {
    throw new AiRuntimeError(
      'invalid_translation_option',
      `Unsupported Bailian translation options: ${unknownKeys.join(', ')}; supported: stream, translationMemory`
    )
  }
  if (value.stream !== undefined && typeof value.stream !== 'boolean') {
    throw new AiRuntimeError('invalid_translation_option', 'Bailian translation option stream must be boolean')
  }
  const options = value as BailianQwenMtInputOptions
  const translationMemory = normalizeTranslationMemory(options.translationMemory)
  return { stream: options.stream ?? defaultStream, translationMemory }
}

function normalizeTranslationMemory(
  value: readonly BailianTranslationMemoryItem[] | undefined
): readonly BailianTranslationMemoryItem[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new AiRuntimeError('invalid_translation_option', 'translationMemory must be an array')
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new AiRuntimeError('invalid_translation_option', `translationMemory[${index}] must be an object`)
    }
    return {
      source: requireText(item.source, `translationMemory[${index}].source`),
      target: requireText(item.target, `translationMemory[${index}].target`),
    }
  })
}

function addUsage(current: TranslationUsage | undefined, next: TranslationUsage | undefined): TranslationUsage | undefined {
  if (!next) return current
  return {
    inputTokens: addOptional(current?.inputTokens, next.inputTokens),
    outputTokens: addOptional(current?.outputTokens, next.outputTokens),
    totalTokens: addOptional(current?.totalTokens, next.totalTokens),
  }
}

function addOptional(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)
}

function readUsage(value: unknown): TranslationUsage | undefined {
  if (!isRecord(value)) return undefined
  const inputTokens = readTokenCount(value.prompt_tokens ?? value.input_tokens)
  const outputTokens = readTokenCount(value.completion_tokens ?? value.output_tokens)
  const totalTokens = readTokenCount(value.total_tokens)
  return inputTokens === undefined && outputTokens === undefined && totalTokens === undefined
    ? undefined
    : { inputTokens, outputTokens, totalTokens }
}

function readTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function findPreset(modelId: BailianQwenMtModelId): BailianQwenMtPreset {
  const preset = Object.values(BAILIAN_QWEN_MT_PRESETS).find((item) => item.modelId === modelId)
  if (!preset) throw new AiRuntimeError('unsupported_model', `Unsupported Bailian Qwen-MT model: ${modelId}`)
  return preset
}

function normalizeEndpoint(value: string | undefined): string {
  const endpoint = value?.trim() || DEFAULT_BAILIAN_QWEN_MT_ENDPOINT
  let parsed: URL
  try { parsed = new URL(endpoint) } catch {
    throw new AiRuntimeError('invalid_endpoint', `Bailian Qwen-MT endpoint is invalid: ${endpoint}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AiRuntimeError('invalid_endpoint', 'Bailian Qwen-MT endpoint must use HTTP(S)')
  }
  return endpoint
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AiRuntimeError('invalid_translation_input', `${field} must be a non-empty string`)
  }
  return value.trim()
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
