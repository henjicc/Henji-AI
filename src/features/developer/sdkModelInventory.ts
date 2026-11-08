import {
  LLM_MODEL_CATALOG_ENTRIES,
  LLM_PROVIDER_PRESETS,
  buildRequest,
  estimateAudioDurationCost,
  estimateChineseTextCost,
  findLlmProviderPreset,
  textTokenRatioFor,
  normalizeRequestBody,
  type CapabilityDescriptor,
  type JsonObject,
  type TokenListPricing,
  type TokenPrice,
} from '@henjicc/ai-sdk'
import { bailianRealtimeAsrPresets } from '@henjicc/ai-sdk/capabilities/speech-recognition/bailian/realtime'
import { volcengineRealtimeAsrPresets } from '@henjicc/ai-sdk/capabilities/speech-recognition/volcengine/realtime'
import { BAILIAN_QWEN_MT_PRESETS } from '@henjicc/ai-sdk/capabilities/translation/bailian'
import { registry } from '@/core/ModelRegistry'
import { LinkageEngine } from '@/core/linkage'
import { reconcileDerivedMediaState } from '@/core/params/derivedMediaState'
import { applyLinkageFilters, findMissingRequiredParams, isParamVisible } from '@/components/params/paramVisibility'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { validateGenerationRequirements } from '@/core/validation/modelRequirements'
import { reconcileGenerationParams } from '@/features/generation'
import { ASR_CATALOG } from '@/core/audioEdit/asrCatalog'
import { resolvePriceEstimateMediaContext, type PricingMediaMetadataReaders } from '@/core/pricing/resolvePriceEstimateMediaContext'
import { attachVideoDurations } from '@/core/services/generationVideoDurations'
import { HENJI_GENERATION_EXECUTION_PACKS, HENJI_GENERATION_MODELS, getHenjiGenerationModel } from '@/core/modelCatalog/applicationModelProfile'
import type { ModelDefinition, ParamDef } from '@/core/types'
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

/** 素材同时放进提交用的字段和界面字段：联动（模式自动切换、选项过滤）挂在界面字段上，只改提交字段触发不了。 */
const MEDIA_KEYS = {
  images: ['uploadedFilePaths', 'images', 'uploadedImages'],
  videos: ['uploadedVideoFilePaths', 'videos', 'uploadedVideos'],
  audios: ['uploadedAudioFilePaths', 'audios'],
} as const
type MediaKind = keyof typeof MEDIA_KEYS
const MEDIA_KINDS = Object.keys(MEDIA_KEYS) as MediaKind[]
const MEDIA_SAMPLE: Readonly<Record<MediaKind, string>> = { images: SAMPLE_URL.image, videos: SAMPLE_URL.video, audios: SAMPLE_URL.audio }

function mediaValues(kind: MediaKind, count: number): DynamicValueMap {
  return Object.fromEntries(MEDIA_KEYS[kind].map((key) => [key, Array.from({ length: count }, () => MEDIA_SAMPLE[kind])]))
}
const UPLOAD_KIND: Readonly<Record<string, keyof typeof SAMPLE_URL>> = { 'image-upload': 'image', 'video-upload': 'video', 'file-upload': 'audio' }

function sampleCount(limit: { min?: number; max?: number; exact?: number } | undefined): number {
  if (!limit || limit.max === 0) return 0
  return limit.exact ?? Math.max(1, limit.min ?? 1)
}

/**
 * 补上示例输入：生成提交时素材走 uploadedFilePaths 等运行时字段（张数按 inputLimits 取），上传类参数各放一份，
 * 界面上看得见、默认为空的文字参数（提示词、自定义模型 ID 等）填一句示例；隐藏的内部字段（如克隆音色代号）留空，免得示例文字不合格式要求。
 * 这样“缺提示词”“缺源图”这类前置条件不会挡住对请求映射本身的检查。
 */
const TEXT_INPUT_TYPES = new Set(['text', 'textarea', 'composite'])

/** 界面上看得见、默认为空的文字类输入；下拉里的空选项（“不指定”）不算。 */
function needsSampleText(param: ParamDef, values: DynamicValueMap): boolean {
  const value = values[param.id]
  return TEXT_INPUT_TYPES.has(param.type) && (value === '' || value === undefined) && isParamVisible(param, values, null)
}

function sampleInputs(definition: ModelDefinition, runtimeLimits: unknown, defaults: DynamicValueMap): DynamicValueMap {
  const values: DynamicValueMap = {}
  for (const param of definition.params) {
    const kind = UPLOAD_KIND[param.type]
    if (kind) values[param.id] = [SAMPLE_URL[kind]]
    else if (needsSampleText(param, defaults)) values[param.id] = SAMPLE_TEXT
  }
  const limits = (typeof runtimeLimits === 'function' ? (runtimeLimits as (params: DynamicValueMap) => unknown)({ ...defaults, ...values }) : runtimeLimits) as { images?: { max?: number }; videos?: { max?: number }; audios?: { max?: number } } | undefined
  Object.assign(values, mediaValues('images', sampleCount(limits?.images)), mediaValues('videos', sampleCount(limits?.videos)), mediaValues('audios', sampleCount(limits?.audios)))
  if (!values.prompt && (defaults.prompt === '' || defaults.prompt === undefined)) values.prompt = SAMPLE_TEXT
  if (!values.text && (defaults.text === '' || defaults.text === undefined)) values.text = SAMPLE_TEXT
  return values
}

/** 默认参数叠上示例输入，并按界面同一套联动整理（素材会触发模式切换等）：离线检查与参考价共用同一份。 */
function sampleValues(definition: ModelDefinition, runtimeLimits: unknown): DynamicValueMap {
  const defaults = registry.getDefaultValues(definition.meta.id)
  return applyGenerationParamChanges(definition.meta.id, defaults, sampleInputs(definition, runtimeLimits, defaults))
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
function generationRuntime(modelId: string): ReturnType<typeof getHenjiGenerationModel> {
  return getHenjiGenerationModel(modelId) ?? HENJI_GENERATION_EXECUTION_PACKS.flatMap((pack) => pack.models).find((model) => model.meta.id === modelId)
}

export async function dryRunGenerationModel(modelId: string, params?: DynamicValueMap, options: { sample?: boolean } = {}): Promise<SdkDryRunResult> {
  const runtime = generationRuntime(modelId)
  const definition = registry.getModel(modelId)
  if (!runtime || !definition) return { ok: false, error: `SDK 里找不到模型 ${modelId}` }
  const values: DynamicValueMap = { ...(options.sample ? sampleValues(definition, runtime.inputLimits) : registry.getDefaultValues(modelId)), ...params }
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

/** 改参数后按界面同一套联动与派生素材规则整理一遍，测试台和组合检查共用，结果才和用户实际能提交的一致。 */
export function applyGenerationParamChanges(modelId: string, current: DynamicValueMap, changes: DynamicValueMap): DynamicValueMap {
  const schema = registry.getSchema(modelId)
  const linkages = registry.getModel(modelId)?.linkages ?? []
  const merged = { ...current, ...changes }
  return reconcileDerivedMediaState(schema, linkages.length ? reconcileGenerationParams(schema, merged, linkages, Object.keys(changes)) : merged)
}

/**
 * 当前参数下界面能选的取值：选项（按联动过滤后）、开关两态、数值上下限（按联动收窄后）；文本、上传与复合面板不在这里枚举。
 * 被联动禁用的参数选不了，返回空。
 */
function enumerableValues(param: ParamDef, params: DynamicValueMap, schema: ParamDef[], engine: LinkageEngine | null): unknown[] {
  if (engine?.isParamDisabled(param.id, params)) return []
  const filtered = applyLinkageFilters(param, params, schema, engine)
  switch (filtered.type) {
    case 'dropdown': case 'radio': case 'aspect-ratio':
      return (filtered.options as Array<{ value: unknown; disabled?: boolean }>).filter((option) => !option.disabled).map((option) => option.value)
    case 'resolution': return filtered.presets.map((preset) => preset.value)
    case 'switch': return [true, false]
    case 'number': return [filtered.min, filtered.max].filter((value): value is number => typeof value === 'number')
    default: return []
  }
}

const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

export interface SdkVariantCheck {
  /** 这组参数怎么来的，例如“mode=edit · resolution=4k” */
  label: string
  params: DynamicValueMap
  result: SdkDryRunResult
  /** 计价抛错、结果为负或无穷、缺媒体指标时的原因；有意返回 NaN 的“提交前算不出总价”不算 */
  priceError?: string
}

function mediaCount(params: DynamicValueMap, kind: MediaKind): number {
  const value = params[MEDIA_KEYS[kind][0]]
  return Array.isArray(value) ? value.length : 0
}

const variantKey = (params: DynamicValueMap): string => JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)))

/**
 * 组合检查与“所选即所发”检查共用的取值空间：各模式 / 渠道分支（素材按分支要求放好）、按数量要求补齐素材、
 * 界面能否提交、某个值用户选不选得到。
 */
function variantSpace(modelId: string) {
  const definition = registry.getModel(modelId)
  const runtime = generationRuntime(modelId)
  if (!definition || !runtime) return null
  const schema = registry.getSchema(modelId)
  const engine = definition.linkages?.length ? new LinkageEngine(definition.linkages) : null
  const uploadParamIds = schema.filter((param) => UPLOAD_KIND[param.type]).map((param) => param.id)
  const limitsOf = (params: DynamicValueMap): ReturnType<typeof resolveInputLimits> =>
    resolveInputLimits(modelId, params, { imagesCount: mediaCount(params, 'images'), videosCount: mediaCount(params, 'videos') })
  // 界面在“必填项没填”或前置条件不满足时不让提交，这些组合用户发不出去。
  const submittable = (params: DynamicValueMap): boolean => !findMissingRequiredParams(schema, params, engine).length && validateGenerationRequirements(modelId, params, {
    prompt: typeof params.prompt === 'string' ? params.prompt : '', imagesCount: mediaCount(params, 'images'), videosCount: mediaCount(params, 'videos'),
  }).ok
  // 切到某个分支后按它的数量要求放素材：能放而没放的放一份，少于下限补齐，多于上限截掉。
  const fitMedia = (params: DynamicValueMap, fillOptional: boolean): DynamicValueMap => {
    const limits = limitsOf(params)
    const changes: DynamicValueMap = {}
    for (const kind of MEDIA_KINDS) {
      const count = mediaCount(params, kind)
      const { min, max } = limits[kind]
      const target = Math.min(max, Math.max(min, fillOptional && count === 0 && max > 0 ? 1 : count))
      if (target !== count) Object.assign(changes, mediaValues(kind, target))
    }
    return Object.keys(changes).length ? applyGenerationParamChanges(modelId, params, changes) : params
  }
  // 切到新分支后才露出来的文字输入（如克隆音色的名称）同样填示例。
  const fillText = (params: DynamicValueMap): DynamicValueMap => {
    const changes = Object.fromEntries(schema.filter((param) => needsSampleText(param, params)).map((param) => [param.id, SAMPLE_TEXT]))
    return Object.keys(changes).length ? applyGenerationParamChanges(modelId, params, changes) : params
  }
  // 选不到就返回 null：联动把值改掉了，或这个参数在该分支下不显示。
  const choose = (base: DynamicValueMap, param: ParamDef, value: unknown): DynamicValueMap | null => {
    const next = applyGenerationParamChanges(modelId, base, { [param.id]: value as DynamicValue })
    return sameValue(next[param.id], value) && isParamVisible(param, next, engine) ? next : null
  }

  const sample = sampleValues(definition, runtime.inputLimits)
  const bases: Array<{ label: string; params: DynamicValueMap }> = [{ label: '默认', params: sample }]
  for (const param of schema.filter((item) => item.role)) {
    for (const value of enumerableValues(param, sample, schema, engine)) {
      if (sameValue(value, sample[param.id])) continue
      const next = choose(sample, param, value)
      if (next) bases.push({ label: `${param.id}=${String(value)}`, params: fillText(fitMedia(next, true)) })
    }
  }
  // 分支里才露出来的下拉（如参考模式下的“任务类型”）也展开成分支，“编辑 / 延长”这类第二层分支才查得到。
  for (const base of bases.slice(1)) {
    for (const param of schema.filter((item) => item.type === 'dropdown' && !isParamVisible(item, sample, engine) && isParamVisible(item, base.params, engine))) {
      for (const value of enumerableValues(param, base.params, schema, engine)) {
        if (sameValue(value, base.params[param.id])) continue
        const next = choose(base.params, param, value)
        if (next) bases.push({ label: `${base.label} · ${param.id}=${String(value)}`, params: fillText(fitMedia(next, true)) })
      }
    }
  }
  const empty = Object.fromEntries([...MEDIA_KINDS.flatMap((kind) => MEDIA_KEYS[kind]), ...uploadParamIds].map((key) => [key, []]))
  return { definition, schema, engine, limitsOf, submittable, fitMedia, choose, bases, empty }
}

/**
 * 参数组合离线检查：先展开每个模式 / 渠道，再在每个分支下把其余参数逐个换成每个可选值，外加“不带素材”和“素材放满”两种输入，
 * 每组都走真实的 selector、builder 与计价。界面联动会改回去或隐藏掉的值用户选不到，提交前校验（数量限制与前置条件）拦下的组合
 * 用户也提交不了，都跳过；剩下的失败就是“界面放行、构建或计价却出错”。
 * 不联网、不扣费；只证明各分支能构建和计价，字段对不对还要对照官方格式。
 */
export async function checkGenerationModelVariants(modelId: string): Promise<SdkVariantCheck[]> {
  const space = variantSpace(modelId)
  if (!space) return [{ label: '默认', params: {}, result: { ok: false, error: `SDK 里找不到模型 ${modelId}` } }]
  const { definition, schema, engine, limitsOf, submittable, fitMedia, choose, bases, empty } = space
  const variants = new Map<string, { label: string; params: DynamicValueMap }>()
  const add = (label: string, params: DynamicValueMap): void => {
    if (!submittable(params)) return
    const key = variantKey(params)
    if (!variants.has(key)) variants.set(key, { label, params })
  }
  for (const base of bases) {
    add(base.label, base.params)
    // 每个轴给出当前参数下能做的一步改动：普通参数换成每个可选值；素材轴是“不带素材”与各类素材放满。
    const axes: Array<(params: DynamicValueMap) => Array<{ label: string; params: DynamicValueMap | null }>> = schema
      .filter((param) => !param.role)
      .map((param) => (params) => isParamVisible(param, params, engine)
        ? enumerableValues(param, params, schema, engine)
          .filter((value) => !sameValue(value, params[param.id]))
          .map((value) => ({ label: `${param.id}=${String(value)}`, params: choose(params, param, value) }))
        : [])
    axes.push((params) => {
      const limits = limitsOf(params)
      return [
        // 能用其他参数代替素材的模型（续接引用）不试“不带素材”：那种提交要带引用，示例里造不出来。
        ...(!definition.alternativeInputParamIds?.length ? [{ label: '不带素材', params: applyGenerationParamChanges(modelId, params, empty) }] : []),
        ...MEDIA_KINDS.filter((kind) => Number.isFinite(limits[kind].max) && limits[kind].max > mediaCount(params, kind)).map((kind) => ({
          label: `${kind} 放满 ${limits[kind].max}`,
          params: applyGenerationParamChanges(modelId, params, mediaValues(kind, limits[kind].max)),
        })),
      ]
    })
    // 单项改动加两两组合：比例与分辨率、有无素材与分辨率这类搭配限制只有组合起来才会暴露。
    for (const [index, axis] of axes.entries()) {
      for (const first of axis(base.params)) {
        if (!first.params) continue
        const once = fitMedia(first.params, false)
        add(`${base.label} · ${first.label}`, once)
        for (const other of axes.slice(index + 1)) {
          for (const second of other(once)) {
            if (second.params) add(`${base.label} · ${first.label} · ${second.label}`, fitMedia(second.params, false))
          }
        }
      }
    }
  }

  const checks: SdkVariantCheck[] = []
  for (const { label, params } of variants.values()) {
    const result = await dryRunGenerationModel(modelId, params)
    const price = result.ok ? await generationPrice(definition, params) : {}
    checks.push({ label, params, result, ...(price.error && price.error !== NOT_ESTIMABLE ? { priceError: price.error } : {}) })
  }
  return checks
}

export interface SdkDeliveryCollision {
  /** 分支与素材情况，例如“默认 · 不带素材” */
  context: string
  paramId: string
  /** 选了这几个不同的值，发出的请求一模一样 */
  values: unknown[]
  route?: string
  body?: unknown
}

/** 数值参数取上下限、紧挨上下限的一档和默认值：夹取、取整写错时最先在边界上撞到一起。 */
function deliveryValues(param: ParamDef, params: DynamicValueMap, schema: ParamDef[], engine: LinkageEngine | null): unknown[] {
  if (param.type !== 'number') return enumerableValues(param, params, schema, engine)
  const filtered = applyLinkageFilters(param, params, schema, engine)
  if (filtered.type !== 'number' || typeof filtered.min !== 'number' || typeof filtered.max !== 'number') return []
  const step = typeof filtered.step === 'number' && filtered.step > 0 ? filtered.step : 1
  const round = (value: number): number => Number(value.toFixed(6))
  const candidates = [filtered.min, round(filtered.min + step), params[param.id], round(filtered.max - step), filtered.max]
  return [...new Set(candidates.filter((value): value is number => typeof value === 'number' && value >= filtered.min! && value <= filtered.max!))]
}

/**
 * “所选即所发”检查：在每个分支与素材情况下（默认、不带素材、各类素材放满），把一个参数换成它每个选得到的值分别构建请求。
 * 两个不同的值发出一模一样的请求，说明其中一个被构建器悄悄改掉了，或这个参数根本没发出去：界面显示的和实际请求对不上。
 * 不联网、不扣费；有意合并的（例如“智能”恰好落到某个比例）要人工判断。
 */
export async function checkGenerationParamDelivery(modelId: string): Promise<SdkDeliveryCollision[]> {
  const space = variantSpace(modelId)
  if (!space) return []
  const { definition, schema, engine, limitsOf, submittable, fitMedia, choose, bases, empty } = space
  const contexts = new Map<string, { label: string; params: DynamicValueMap }>()
  const addContext = (label: string, params: DynamicValueMap): void => {
    const key = variantKey(params)
    if (submittable(params) && !contexts.has(key)) contexts.set(key, { label, params })
  }
  for (const base of bases) {
    addContext(base.label, base.params)
    if (!definition.alternativeInputParamIds?.length) addContext(`${base.label} · 不带素材`, fitMedia(applyGenerationParamChanges(modelId, base.params, empty), false))
    const limits = limitsOf(base.params)
    for (const kind of MEDIA_KINDS) {
      if (Number.isFinite(limits[kind].max) && limits[kind].max > mediaCount(base.params, kind)) {
        addContext(`${base.label} · ${kind} 放满 ${limits[kind].max}`, fitMedia(applyGenerationParamChanges(modelId, base.params, mediaValues(kind, limits[kind].max)), false))
      }
    }
  }
  const collisions: SdkDeliveryCollision[] = []
  for (const context of contexts.values()) {
    for (const param of schema.filter((item) => isParamVisible(item, context.params, engine))) {
      const groups = new Map<string, unknown[]>()
      for (const value of deliveryValues(param, context.params, schema, engine)) {
        const chosen = sameValue(value, context.params[param.id]) ? context.params : choose(context.params, param, value)
        if (!chosen) continue
        const params = fitMedia(chosen, false)
        if (!submittable(params) || !sameValue(params[param.id], value)) continue
        const result = await dryRunGenerationModel(modelId, params)
        if (!result.ok) continue
        const key = JSON.stringify([result.route ?? '', result.body ?? null])
        groups.set(key, [...(groups.get(key) ?? []), value])
      }
      for (const [key, values] of groups) {
        if (values.length < 2) continue
        const [route, body] = JSON.parse(key) as [string, unknown]
        collisions.push({ context: context.label, paramId: param.id, values, route, body })
      }
    }
  }
  return collisions
}

/** 参考价用的示例素材指标：按时长、像素计价的模型拿它算，免得都显示成缺价格。 */
export const SAMPLE_PRICING_MEDIA = { image: { width: 1024, height: 1024, fileSizeBytes: 1_048_576 }, video: { width: 1280, height: 720, durationSeconds: 5 }, audio: { durationSeconds: 10 } } as const
const SAMPLE_PRICING_READERS: PricingMediaMetadataReaders = {
  image: async () => SAMPLE_PRICING_MEDIA.image,
  video: async () => SAMPLE_PRICING_MEDIA.video,
  audio: async () => SAMPLE_PRICING_MEDIA.audio,
}

export type SdkModelPrice =
  | { status: 'priced'; display: string; description?: string }
  /** 算出来是 0：可能真免费，也可能是计价漏填，要人工核对。 */
  | { status: 'zero'; display: string; description?: string }
  | { status: 'missing'; reason: string; description?: string }

const CURRENCY_SYMBOL: Readonly<Record<'CNY' | 'USD', string>> = { CNY: '¥', USD: '$' }

function formatAmount(amount: number): string {
  return amount >= 1 ? amount.toFixed(2) : amount.toPrecision(3).replace(/\.?0+$/, '')
}

function tokenAmounts(currency: TokenListPricing['currency'], price: TokenPrice): string {
  const symbol = CURRENCY_SYMBOL[currency]
  return `${symbol}${price.inputPerMillionTokens} / ${symbol}${price.outputPerMillionTokens}`
}

/** 每百万 tokens 的完整价目：输入 / 输出 / 缓存命中，外加分档与分时。 */
function describeTokenPricing(pricing: TokenListPricing): string {
  const line = (price: TokenPrice): string => `${tokenAmounts(pricing.currency, price)}${price.cacheReadPerMillionTokens === undefined ? '' : `，缓存命中 ${CURRENCY_SYMBOL[pricing.currency]}${price.cacheReadPerMillionTokens}`}`
  return [
    `每百万 tokens 输入 / 输出：${line(pricing)}${pricing.offPeak ? `（高峰：${pricing.offPeak.peakHours}）` : ''}`,
    ...(pricing.tiers ?? []).map((tier) => `输入超过 ${tier.aboveInputTokens / 1000}K：${line(tier)}`),
    ...(pricing.offPeak ? [`其余时段：${line(pricing.offPeak)}`] : []),
  ].join('；')
}

/**
 * 每个模型的参考价：生成模型用默认参数加示例输入（图 1024²、视频 5 秒、音频 10 秒）算一次，语音识别按每小时单价，
 * 大语言模型与翻译取 SDK 预设登记的每百万 tokens 单价，并按官方汉字折 token 比例换成每万字的参考价。
 * 生成模型这里直接调 calculator 而不走 createPriceEstimate：它把抛错和没声明都收成“暂不可估算”，开发者要看到具体原因。
 */
export async function estimateSdkModelPrice(row: SdkModelRow): Promise<SdkModelPrice> {
  if (row.category === 'asr' && row.capability) {
    const pricing = row.capability.descriptor.pricing
    const hour = pricing ? estimateAudioDurationCost(pricing, 3_600_000) : null
    if (!hour) return { status: 'missing', reason: pricing ? '按 token 计价且没有音频折算比例' : 'SDK 能力描述没有登记价格' }
    const display = `${CURRENCY_SYMBOL[hour.currency]}${formatAmount(hour.amount)}/小时`
    return hour.amount > 0 ? { status: 'priced', display } : { status: 'zero', display: '免费' }
  }
  if (row.category === 'llm' || row.category === 'translation') {
    const pricing = row.category === 'llm'
      ? findLlmProviderPreset(row.providerId)?.modelPricing?.[row.modelId]
      : Object.values(BAILIAN_QWEN_MT_PRESETS).find((preset) => preset.modelId === row.modelId)?.pricing
    if (!pricing) return { status: 'missing', reason: row.category === 'llm' ? '供应商预设里没有登记这个模型的单价' : '翻译预设没有单价' }
    const ratio = textTokenRatioFor(row.modelId)
    const symbol = CURRENCY_SYMBOL[pricing.currency]
    const perTenThousand = (input: number, output: number): string => `${symbol}${formatAmount(estimateChineseTextCost(pricing, ratio, { input, output }))}`
    const conversion = `按 1 字约 ${Number(ratio.tokensPerChineseChar.toFixed(3))} token（${ratio.source}）`
    // 翻译按“输入一万字、译出同样篇幅”给每万字的价；大语言模型输入输出单价差得多，分开列。
    return row.category === 'translation'
      ? { status: 'priced', display: `约 ${perTenThousand(10_000, 10_000)}/万字`, description: `${describeTokenPricing(pricing)}；译一万字约 ${perTenThousand(10_000, 10_000)}，${conversion}` }
      : { status: 'priced', display: `${tokenAmounts(pricing.currency, pricing)} 每百万`, description: `${describeTokenPricing(pricing)}；每万字输入约 ${perTenThousand(10_000, 0)}、输出约 ${perTenThousand(0, 10_000)}，${conversion}` }
  }
  const definition = row.generation?.definition
  if (!definition) return { status: 'missing', reason: '没有计价信息' }
  const { pricing } = definition
  const description = pricing.description
  if (pricing.fixed === undefined && !pricing.calculator) return { status: 'missing', reason: '模型没有声明计价', description }
  const price = await generationPrice(definition, sampleValues(definition, generationRuntime(definition.meta.id)?.inputLimits))
  if (price.amount === undefined) return { status: 'missing', reason: price.error ?? '计价结果无效', description }
  const unit = pricing.estimateMode === 'unit' && pricing.estimateUnit ? `/${pricing.estimateUnit}` : ''
  const display = `${pricing.estimateKind === 'upper-bound' ? '上限 ' : ''}${pricing.currency}${formatAmount(price.amount)}${unit}`
  return price.amount > 0 ? { status: 'priced', display, description } : { status: 'zero', display, description }
}

const NOT_ESTIMABLE = '提交前算不出总价'

/** 按给定参数算一次价：视频时长与媒体指标用示例值补齐，不读文件。 */
async function generationPrice(definition: ModelDefinition, params: DynamicValueMap): Promise<{ amount?: number; error?: string }> {
  const { pricing } = definition
  try {
    const withDurations = await attachVideoDurations(params, async () => SAMPLE_PRICING_MEDIA.video.durationSeconds)
    const context = await resolvePriceEstimateMediaContext(pricing.mediaContext, withDurations, SAMPLE_PRICING_READERS)
    if (!context.complete) return { error: `缺少媒体指标：${context.missingTargets.join('、')}` }
    const amount = pricing.fixed ?? pricing.calculator?.(context.params as JsonObject) ?? Number.NaN
    // 计价函数返回 NaN 表示提交前就算不出（例如按实际输出的图层数计费），界面不显示估价、提交时照常确认，不算错误。
    if (Number.isNaN(amount)) return { error: NOT_ESTIMABLE }
    return Number.isFinite(amount) && amount >= 0 ? { amount } : { error: `计价结果无效（${amount}）` }
  } catch (error) {
    return { error: `计价出错：${error instanceof Error ? error.message : String(error)}` }
  }
}
