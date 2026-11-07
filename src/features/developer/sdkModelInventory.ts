import {
  LLM_MODEL_CATALOG_ENTRIES,
  LLM_PROVIDER_PRESETS,
  buildRequest,
  normalizeRequestBody,
  type CapabilityDescriptor,
  type JsonObject,
} from '@henjicc/ai-sdk'
import { bailianRealtimeAsrPresets } from '@henjicc/ai-sdk/capabilities/speech-recognition/bailian/realtime'
import { volcengineRealtimeAsrPresets } from '@henjicc/ai-sdk/capabilities/speech-recognition/volcengine/realtime'
import { BAILIAN_QWEN_MT_PRESETS } from '@henjicc/ai-sdk/capabilities/translation/bailian'
import { registry } from '@/core/ModelRegistry'
import { ASR_CATALOG } from '@/core/audioEdit/asrCatalog'
import { HENJI_GENERATION_EXECUTION_PACKS, HENJI_GENERATION_MODELS, getHenjiGenerationModel } from '@/core/modelCatalog/applicationModelProfile'
import type { ModelDefinition } from '@/core/types'
import { getI18nText } from '@/core/types'
import i18n from '@/i18n'

/** 开发者面板的分类：生成模型按输出模态，其余按能力。 */
export type SdkModelCategory = 'image' | 'video' | 'audio' | 'tool' | 'llm' | 'asr' | 'translation'
export const SDK_MODEL_CATEGORIES: readonly SdkModelCategory[] = ['image', 'video', 'audio', 'tool', 'llm', 'asr', 'translation']

const GENERATION_TYPES = new Set<string>(['image', 'video', 'audio'])

export interface SdkModelRow {
  /** 表内唯一键：同一 Model ID 在不同供应商预设里各占一行。 */
  key: string
  category: SdkModelCategory
  name: string
  /** 发给供应商或写进配置的 Model ID。 */
  modelId: string
  providerId: string
  /** 列表与详情里显示的中文能力名。 */
  tags: readonly string[]
  /** 模型声明里的原始标签或特性，只在详情里给开发者核对。 */
  rawTags: readonly string[]
  /** 已过时的原因；用户界面已不再列出，只在这里留给开发者核对。 */
  deprecated?: string
  /** 只有生成模型能做请求预览与估价。 */
  generation?: { definition: ModelDefinition }
  llm?: { catalogId: string | null; protocol: 'responses' | 'chat' | null; note?: string; capabilities: readonly string[]; contextWindow: number | null; maxOutputTokens: number | null }
  capability?: { descriptor: CapabilityDescriptor }
}

/** 语音识别的特性是协议层面的另一套描述，不属于模型能力标签，在这里起中文名；不在表里的不显示。 */
const ASR_FEATURE_LABEL: Readonly<Record<string, string>> = {
  timestamps: '时间戳', 'short-audio': '短音频', 'file-transcription': '文件转写', 'async-polling': '异步任务',
  'remote-url': '网址输入', realtime: '实时', streaming: '流式', 'partial-results': '中间结果', 'pcm-s16le-16khz-mono': '16kHz PCM 输入',
}

const DEPRECATED_TAG = '已过时'

function generationRow(definition: ModelDefinition, tool: boolean): SdkModelRow {
  const deprecated = definition.meta.deprecated
  return {
    key: `generation:${definition.meta.id}`,
    category: tool || !GENERATION_TYPES.has(definition.meta.type) ? 'tool' : definition.meta.type as SdkModelCategory,
    name: getI18nText(definition.meta.name, 'zh-CN') || definition.meta.id,
    modelId: definition.meta.id,
    providerId: definition.meta.provider,
    tags: [...(deprecated ? [DEPRECATED_TAG] : []), ...(definition.meta.tags ?? []).map((tag) => i18n.t(`models:tags.${tag}`))],
    rawTags: definition.meta.tags ?? [],
    deprecated,
    generation: { definition },
  }
}

/** 只登记了能力、没放进任何供应商预设的大语言模型（用户可手动添加）。 */
export const LLM_CATALOG_ONLY_PROVIDER = 'llm-catalog'

/** 供应商显示名：生成供应商用统一中文名，只有大语言模型的供应商用预设名，都查不到就显示 ID。 */
export function sdkProviderName(providerId: string): string {
  if (providerId === LLM_CATALOG_ONLY_PROVIDER) return '仅能力目录'
  const key = `models:providers.${providerId}`
  if (i18n.exists(key)) return i18n.t(key)
  return LLM_PROVIDER_PRESETS.find((item) => item.providerId === providerId)?.displayName ?? providerId
}

function llmRows(): SdkModelRow[] {
  const rows: SdkModelRow[] = []
  const listed = new Set<string>()
  for (const preset of LLM_PROVIDER_PRESETS) {
    for (const modelId of preset.modelIds) {
      const entry = LLM_MODEL_CATALOG_ENTRIES.find((item) => item.id === catalogKey(modelId) || item.aliases?.some((alias) => catalogKey(alias) === catalogKey(modelId)))
      if (entry) listed.add(entry.id)
      rows.push(llmRow(`${preset.providerId}:${modelId}`, modelId, preset.providerId, entry, preset.responsesModelIds?.includes(modelId) ? 'responses' : 'chat'))
    }
  }
  // 目录里登记了能力、但没有放进任何预设的模型（用户可手动添加），供应商记为目录里的厂商。
  for (const entry of LLM_MODEL_CATALOG_ENTRIES) {
    if (!listed.has(entry.id)) rows.push(llmRow(`catalog:${entry.id}`, entry.id, LLM_CATALOG_ONLY_PROVIDER, entry, null))
  }
  return rows
}

function catalogKey(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase()
  return trimmed.slice(trimmed.lastIndexOf('/') + 1).split(':')[0].replace(/-latest$/, '').replace(/-(\d{4}-\d{2}-\d{2}|\d{6,8})$/, '')
}

function llmRow(key: string, modelId: string, providerId: string, entry: (typeof LLM_MODEL_CATALOG_ENTRIES)[number] | undefined, protocol: 'responses' | 'chat' | null): SdkModelRow {
  const capabilities = entry ? [
    entry.input.image ? '看图' : null, entry.input.video ? '看视频' : null, entry.input.audio ? '听音频' : null,
    entry.toolCall ? '工具调用' : null, entry.structuredOutputMode === 'none' ? null : entry.structuredOutputMode === 'json' ? 'JSON 输出' : 'Schema 输出', entry.reasoning ? '思考' : null,
  ].filter((value): value is string => value !== null) : []
  return {
    key: `llm:${key}`,
    category: 'llm',
    name: entry?.displayName ?? modelId,
    modelId,
    providerId,
    tags: [...(entry?.deprecated ? [DEPRECATED_TAG] : []), ...capabilities, ...(protocol === 'responses' ? ['Responses 接口'] : [])],
    rawTags: [],
    deprecated: entry?.deprecated,
    llm: { catalogId: entry?.id ?? null, protocol, note: entry?.note, capabilities, contextWindow: entry?.contextWindow ?? null, maxOutputTokens: entry?.maxOutputTokens ?? null },
  }
}

function capabilityRow(category: 'asr', descriptor: CapabilityDescriptor): SdkModelRow {
  return {
    key: `${category}:${descriptor.id}`,
    category,
    name: descriptor.modelId ?? descriptor.id,
    modelId: descriptor.modelId ?? descriptor.id,
    providerId: descriptor.providerIds?.[0] ?? '',
    tags: [...new Set([...(descriptor.features ?? []), ...(descriptor.executionModes?.includes('realtime') ? ['realtime'] : [])].flatMap((feature) => ASR_FEATURE_LABEL[feature] ?? []))],
    rawTags: descriptor.features ?? [],
    capability: { descriptor },
  }
}

/** 汇总 SDK 适配的全部模型：生成（含受控工具）、大语言模型预设与目录、语音识别、翻译。 */
export function listSdkModels(): SdkModelRow[] {
  // 已过时的模型不进普通注册索引，从 SDK 清单补回来，仍按自身模态分类
  const deprecated = HENJI_GENERATION_MODELS.filter((model) => model.meta.deprecated)
    .flatMap((model) => { const definition = registry.getModel(model.meta.id); return definition ? [definition] : [] })
  const generation = [...registry.listAllModels(), ...deprecated].map((definition) => generationRow(definition, false))
  const listed = new Set(generation.map((row) => row.modelId))
  const tools = HENJI_GENERATION_EXECUTION_PACKS.flatMap((pack) => pack.models)
    .filter((model) => !listed.has(model.meta.id))
    .flatMap((model) => {
      const definition = registry.getModel(model.meta.id)
      return definition ? [generationRow(definition, true)] : []
    })
  const asr = [
    ...ASR_CATALOG.map((entry) => entry.descriptor),
    ...bailianRealtimeAsrPresets.map((preset) => preset.descriptor),
    ...volcengineRealtimeAsrPresets.map((preset) => preset.descriptor),
  ].map((descriptor) => capabilityRow('asr', descriptor))
  const translation = Object.values(BAILIAN_QWEN_MT_PRESETS).map((preset): SdkModelRow => ({
    key: `translation:${preset.moduleId}`, category: 'translation', name: preset.modelId, modelId: preset.modelId,
    providerId: 'bailian', tags: ['流式翻译', preset.streamingContent === 'cumulative' ? '累积输出' : '增量输出'], rawTags: [],
  }))
  return [...generation, ...tools, ...llmRows(), ...asr, ...translation]
}

/** 示例素材用公网占位地址：只用于离线检查请求构建，不会真的发出去。 */
// 图片用内联 1×1 PNG：部分模型构建请求时会读源图尺寸（智能比例），写成网址会真的去下载。
const SAMPLE_URL = { image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', video: 'https://example.com/henji-sample.mp4', audio: 'https://example.com/henji-sample.mp3' } as const
const SAMPLE_TEXT = '一只橘猫坐在洒满阳光的窗台上'
const UPLOAD_KIND: Readonly<Record<string, keyof typeof SAMPLE_URL>> = { 'image-upload': 'image', 'video-upload': 'video', 'file-upload': 'audio' }

function sampleCount(limit: { min?: number; max?: number; exact?: number } | undefined): number {
  if (!limit || limit.max === 0) return 0
  return limit.exact ?? Math.max(1, limit.min ?? 1)
}

/**
 * 补上示例输入：生成提交时素材走 uploadedFilePaths 等运行时字段（张数按 inputLimits 取），上传类参数各放一份，
 * 默认为空串的参数（提示词、音色 ID、自定义模型 ID 等）填一句示例。这样“缺提示词”“缺源图”这类前置条件不会挡住对请求映射本身的检查。
 */
function sampleInputs(definition: ModelDefinition, runtimeLimits: unknown, defaults: DynamicValueMap): DynamicValueMap {
  const values: DynamicValueMap = {}
  for (const param of definition.params) {
    const kind = UPLOAD_KIND[param.type]
    if (kind) values[param.id] = [SAMPLE_URL[kind]]
    else if (defaults[param.id] === '' || ((param.type === 'text' || param.type === 'textarea') && defaults[param.id] === undefined)) values[param.id] = SAMPLE_TEXT
  }
  const limits = (typeof runtimeLimits === 'function' ? (runtimeLimits as (params: DynamicValueMap) => unknown)({ ...defaults, ...values }) : runtimeLimits) as { images?: { max?: number }; videos?: { max?: number }; audios?: { max?: number } } | undefined
  const fill = (count: number, url: string): string[] => Array.from({ length: count }, () => url)
  values.uploadedFilePaths = fill(sampleCount(limits?.images), SAMPLE_URL.image)
  values.uploadedVideoFilePaths = fill(sampleCount(limits?.videos), SAMPLE_URL.video)
  values.uploadedAudioFilePaths = fill(sampleCount(limits?.audios), SAMPLE_URL.audio)
  if (!values.prompt && (defaults.prompt === '' || defaults.prompt === undefined)) values.prompt = SAMPLE_TEXT
  if (!values.text && (defaults.text === '' || defaults.text === undefined)) values.text = SAMPLE_TEXT
  return values
}

const DRY_RUN_TIMEOUT_MS = 5_000

export interface SdkDryRunResult {
  ok: boolean
  route?: string
  method?: string
  body?: unknown
  error?: string
}

/**
 * 离线构建一次请求：默认参数（可补示例输入，再叠上传入的参数）走 SDK 的真实 selector 与 builder，再按 runtimeConstraints 规范化。
 * 不联网、不上传、不扣费；用来检查参数映射与分支是否写对。
 */
export async function dryRunGenerationModel(modelId: string, params?: DynamicValueMap, options: { sample?: boolean } = {}): Promise<SdkDryRunResult> {
  const runtime = getHenjiGenerationModel(modelId) ?? HENJI_GENERATION_EXECUTION_PACKS.flatMap((pack) => pack.models).find((model) => model.meta.id === modelId)
  const definition = registry.getModel(modelId)
  if (!runtime || !definition) return { ok: false, error: `SDK 里找不到模型 ${modelId}` }
  const defaults = registry.getDefaultValues(modelId)
  const values: DynamicValueMap = { ...defaults, ...(options.sample ? sampleInputs(definition, runtime.inputLimits, defaults) : {}), ...params }
  try {
    // 个别 builder 会读取素材元数据；占位地址读不到时不能一直挂着。
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`构建请求超过 ${DRY_RUN_TIMEOUT_MS / 1000} 秒未完成（可能在构建时访问素材）`)), DRY_RUN_TIMEOUT_MS) })
    const built = await Promise.race([buildRequest(values as JsonObject, runtime), timeout]).finally(() => clearTimeout(timer))
    if (!built.route.trim()) return { ok: false, error: '请求路径为空' }
    return { ok: true, route: built.route, method: built.method, body: normalizeRequestBody(built.body, runtime.runtimeConstraints) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function sdkModelDefaults(modelId: string): DynamicValueMap {
  return registry.getDefaultValues(modelId)
}
