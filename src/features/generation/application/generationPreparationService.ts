import { toApplicationStableIdSegment } from '@/core/application-control'
import { LinkageEngine } from '@/core/linkage'
import { registry } from '@/core/ModelRegistry'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { hasAlternativeModelInput } from '@/core/inputs/alternativeInput'
import {
  DEFAULT_USD_TO_CNY_RATE,
  convertPriceAmount,
  resolvePricingCurrency,
} from '@/core/pricing/priceDisplay'
import { validateParams, type ValidationError } from '@/core/request/paramValidator'
import { getI18nText, type ModelDefinition, type ParamDef } from '@/core/types'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

export type GenerationMediaType = 'image' | 'video' | 'audio'
export type GenerationModelSearchSort = 'registry' | 'recommended' | 'lowest_estimated_price'
export interface GenerationModelSearchInput {
  query?: string
  mediaType?: GenerationMediaType
  providerId?: string
  tags?: string[]
  sortBy?: GenerationModelSearchSort
}

export interface GenerationPreparationInput {
  modelId: string
  prompt: string
  mediaType: GenerationMediaType
  options?: Record<string, unknown>
}

export interface GenerationModelCatalogBootstrap {
  catalogVersion: 'model-registry/v1'
  modelGroups: Array<Record<string, unknown>>
}

export interface GenerationModelSearchResult {
  models: Array<Record<string, unknown>>
  appliedProviderId: string | null
  ignoredQueryTerms: string[]
  matchedQueryTerms: string[]
  providerIdNormalized: boolean
}

export class GenerationPreparationError extends Error {
  constructor(
    readonly code: 'MODEL_NOT_FOUND' | 'INVALID_INPUT',
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'GenerationPreparationError'
  }
}

function normalizeTerms(query: string | undefined): string[] {
  return (query ?? '')
    .trim()
    .toLowerCase()
    .split(/[\s,，、/]+/)
    .filter((term) => term.length > 0)
    .slice(0, 8)
}

function toSafeValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, 500)
  if (typeof value === 'function' || typeof value === 'undefined') return undefined
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => toSafeValue(item, depth + 1))
  if (typeof value !== 'object' || depth >= 3) return undefined
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 30)
      .flatMap(([key, item]) => {
        const safe = toSafeValue(item, depth + 1)
        return safe === undefined ? [] : [[key, safe]] as Array<[string, unknown]>
      })
  )
}

function serializeParam(param: ParamDef): Record<string, unknown> {
  const options = 'options' in param && Array.isArray(param.options)
    ? param.options.slice(0, 50).map((option) => ({
      value: toSafeValue(option.value),
      label: toSafeValue(option.label),
    }))
    : undefined
  return {
    id: param.id,
    type: param.type,
    valueType: param.valueType ?? null,
    name: param.name,
    description: param.description,
    required: param.required === true,
    default: toSafeValue(param.default),
    min: 'min' in param ? param.min ?? null : null,
    max: 'max' in param ? param.max ?? null : null,
    step: 'step' in param ? param.step ?? null : null,
    maxCount: 'maxCount' in param ? param.maxCount ?? null : null,
    options,
  }
}

function modelSearchText(model: ModelDefinition): string {
  return [
    model.meta.id,
    model.meta.canonicalModelId,
    model.meta.provider,
    model.meta.type,
    getI18nText(model.meta.name, 'zh'),
    getI18nText(model.meta.name, 'en'),
    model.meta.description ? getI18nText(model.meta.description, 'zh') : '',
    model.meta.description ? getI18nText(model.meta.description, 'en') : '',
    ...(model.meta.tags ?? []),
  ].join(' ').toLowerCase()
}

function compactSearchText(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()
}

function matchesSearchTerm(text: string, term: string): boolean {
  return text.includes(term) || compactSearchText(text).includes(compactSearchText(term))
}

function modelDescriptionText(model: ModelDefinition): string {
  if (!model.meta.description) return ''
  return getI18nText(model.meta.description, 'zh') || getI18nText(model.meta.description, 'en')
}

/**
 * 将模型当前参数的价格规则转为可安全提供给 Agent 的估算值。
 * 搜索阶段使用配置默认值；真正提交前会再次用已解析的参数计算一次。
 */
function createPriceEstimate(
  model: ModelDefinition,
  params = registry.getDefaultValues(model.meta.id)
): Record<string, unknown> {
  const calculated = registry.calculatePrice(model.meta.id, params)
  const amount = Number.isFinite(calculated) && calculated >= 0 ? calculated : null
  const sourceCurrency = resolvePricingCurrency(model.pricing.currency)
  const comparableCnyAmount = amount !== null && sourceCurrency
    ? convertPriceAmount(amount, sourceCurrency, 'CNY', DEFAULT_USD_TO_CNY_RATE)
    : null

  return {
    amount,
    currency: model.pricing.currency,
    display: amount === null ? '价格暂不可估算' : `${model.pricing.currency}${amount.toFixed(4)}`,
    billingMode: model.pricing.fixed !== undefined ? 'fixed' : 'dynamic',
    basis: '当前参数估算',
    description: model.pricing.description ?? null,
    comparableCnyAmount,
    comparableCnyExchangeRate: sourceCurrency === 'USD' ? DEFAULT_USD_TO_CNY_RATE : null,
    comparisonNote: sourceCurrency
      ? '人民币比较值仅用于候选排序；动态计费模型以提交前的实际参数估算为准。'
      : '该货币暂不参与跨币种比较；以模型原始价格为准。',
  }
}

function createCatalogPriceEstimate(model: ModelDefinition): Record<string, unknown> {
  const estimate = createPriceEstimate(model)
  return {
    amount: estimate.amount,
    currency: estimate.currency,
    display: estimate.display,
    billingMode: estimate.billingMode,
    comparableCnyAmount: estimate.comparableCnyAmount,
    description: typeof estimate.description === 'string' ? estimate.description.slice(0, 80) : null,
  }
}

function createBootstrapPriceEstimate(model: ModelDefinition): Record<string, unknown> {
  const estimate = createCatalogPriceEstimate(model)
  return {
    amount: estimate.amount,
    currency: estimate.currency,
    comparableCnyAmount: estimate.comparableCnyAmount,
  }
}

function compactModelDescription(model: ModelDefinition): string {
  return modelDescriptionText(model).replace(/\s+/g, ' ').trim().slice(0, 80)
}

function priceSortValue(candidate: Record<string, unknown>): number {
  const price = candidate.priceEstimate
  if (!price || typeof price !== 'object' || Array.isArray(price)) return Number.POSITIVE_INFINITY
  const value = (price as Record<string, unknown>).comparableCnyAmount
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

function recommendedSortValue(candidate: Record<string, unknown>): number {
  const evidence = candidate.selectionEvidence
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return 0
  return (evidence as Record<string, unknown>).recommendedByDescription === true ? 1 : 0
}

function sortSearchCandidates(
  candidates: Array<Record<string, unknown>>,
  sortBy: GenerationModelSearchSort | undefined
): Array<Record<string, unknown>> {
  if (!sortBy || sortBy === 'registry') return candidates
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      if (sortBy === 'recommended') {
        const recommendedDelta = recommendedSortValue(right.candidate) - recommendedSortValue(left.candidate)
        if (recommendedDelta !== 0) return recommendedDelta
      }
      if (sortBy === 'lowest_estimated_price') {
        const priceDelta = priceSortValue(left.candidate) - priceSortValue(right.candidate)
        if (priceDelta !== 0) return priceDelta
      }
      return left.index - right.index
    })
    .map(({ candidate }) => candidate)
}

function createSelectionEvidence(
  model: ModelDefinition,
  matchedQueryTerms: string[],
  ignoredQueryTerms: string[]
): Record<string, unknown> {
  const description = modelDescriptionText(model)
  return {
    recommendedByDescription: description.includes('推荐使用'),
    matchedQueryTerms,
    ignoredQueryTerms,
    compatible: true,
  }
}

function toCatalogModel(model: ModelDefinition): Record<string, unknown> {
  const description = compactModelDescription(model)
  return {
    modelId: model.meta.id,
    canonicalModelId: model.meta.canonicalModelId,
    providerId: model.meta.provider,
    mediaType: model.meta.type,
    name: getI18nText(model.meta.name, 'zh') || getI18nText(model.meta.name, 'en'),
    description,
    tags: (model.meta.tags ?? []).slice(0, 8),
    priceEstimate: createCatalogPriceEstimate(model),
    recommendedByDescription: description.includes('推荐使用'),
  }
}

function schemaDigest(modelId: string, params: ParamDef[]): string {
  const seed = JSON.stringify({ modelId, params: params.map((param) => serializeParam(param)) })
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

export function getGenerationModelSchemaRef(modelId: string) {
  const model = registry.getModel(modelId)
  if (!model) throw new GenerationPreparationError('MODEL_NOT_FOUND', '生成模型不存在', { modelId })
  return {
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    kind: 'operation' as const,
    // 模型 id 来自供应商，不受稳定 id 正则约束（ModelScope 的 id 带斜杠和大写），
    // 必须规范化后再拼，否则整个反射注册表建不起来。
    id: `generation.model.${toApplicationStableIdSegment(model.meta.id)}.params`,
    version: 1,
    digest: schemaDigest(model.meta.id, model.params),
  }
}

/**
 * 提供给 Agent 的紧凑模型目录。它只用于首轮选择，最终提交前仍必须读取单模型 schema。
 */
export function getGenerationModelCatalogBootstrap(): GenerationModelCatalogBootstrap {
  const groups = new Map<string, {
    canonicalModelId: string
    mediaType: GenerationMediaType
    name: string
    description: string
    tags: string[]
    recommendedByDescription: boolean
    providers: Array<Record<string, unknown>>
  }>()
  for (const model of registry.listAllModels()) {
    const key = `${model.meta.type}:${model.meta.canonicalModelId}`
    const description = compactModelDescription(model)
    const existing = groups.get(key)
    const providerModel = {
      providerId: model.meta.provider,
      modelId: model.meta.id,
      priceEstimate: createBootstrapPriceEstimate(model),
    }
    if (existing) {
      existing.providers.push(providerModel)
      continue
    }
    groups.set(key, {
      canonicalModelId: model.meta.canonicalModelId,
      mediaType: model.meta.type,
      name: getI18nText(model.meta.name, 'zh') || getI18nText(model.meta.name, 'en'),
      description,
      tags: (model.meta.tags ?? []).slice(0, 8),
      recommendedByDescription: description.includes('推荐使用'),
      providers: [providerModel],
    })
  }
  return {
    catalogVersion: 'model-registry/v1',
    modelGroups: [...groups.values()],
  }
}

function resolveProviderId(
  requestedProviderId: string | undefined,
  models: ModelDefinition[]
): { providerId: string | null; normalized: boolean } {
  const trimmed = requestedProviderId?.trim()
  if (!trimmed) return { providerId: null, normalized: false }
  const actual = models.find((model) => model.meta.provider.toLowerCase() === trimmed.toLowerCase())?.meta.provider
  return { providerId: actual ?? trimmed, normalized: actual !== undefined && actual !== trimmed }
}

export function searchGenerationModelCatalog(input: GenerationModelSearchInput): GenerationModelSearchResult {
  const allModels = registry.listAllModels()
  const terms = normalizeTerms(input.query)
  const provider = resolveProviderId(input.providerId, allModels)
  const matchedQueryTerms = terms.filter((term) => allModels.some((model) => matchesSearchTerm(modelSearchText(model), term)))
  const ignoredQueryTerms = terms.filter((term) => !matchedQueryTerms.includes(term))
  const requestedTags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
  const models = allModels
    .filter((model) => {
      if (input.mediaType && model.meta.type !== input.mediaType) return false
      if (provider.providerId && model.meta.provider !== provider.providerId) return false
      if (requestedTags.length && !requestedTags.every((tag) => model.meta.tags?.includes(tag))) return false
      const text = modelSearchText(model)
      return matchedQueryTerms.every((term) => matchesSearchTerm(text, term))
    })
    .map((model) => ({
      ...toCatalogModel(model),
      selectionEvidence: createSelectionEvidence(model, matchedQueryTerms, ignoredQueryTerms),
    }))
  return {
    models: sortSearchCandidates(models, input.sortBy),
    appliedProviderId: provider.providerId,
    ignoredQueryTerms,
    matchedQueryTerms,
    providerIdNormalized: provider.normalized,
  }
}

export function searchGenerationModels(input: GenerationModelSearchInput): Array<Record<string, unknown>> {
  return searchGenerationModelCatalog(input).models
}

export function getGenerationModelSchema(modelId: string): Record<string, unknown> {
  const model = registry.getModel(modelId)
  if (!model) throw new GenerationPreparationError('MODEL_NOT_FOUND', '生成模型不存在', { modelId })
  return {
    schemaVersion: 'generation-model-schema/v2',
    schemaRef: getGenerationModelSchemaRef(model.meta.id),
    meta: {
      id: model.meta.id,
      canonicalModelId: model.meta.canonicalModelId,
      provider: model.meta.provider,
      type: model.meta.type,
      name: model.meta.name,
      description: model.meta.description,
      tags: model.meta.tags ?? [],
    },
    inputLimits: toSafeValue(model.inputLimits),
    priceEstimate: createPriceEstimate(model),
    params: model.params.map(serializeParam),
    linkageCount: model.linkages?.length ?? 0,
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function mediaCount(options: Record<string, unknown>, uploadedKey: string, visibleKey: string): number {
  const uploaded = stringArray(options[uploadedKey])
  return uploaded.length > 0 ? uploaded.length : stringArray(options[visibleKey]).length
}

function applyLinkages(model: ModelDefinition, values: DynamicValueMap, supplied: Record<string, unknown>): DynamicValueMap {
  if (!model.linkages?.length) return values
  const engine = new LinkageEngine(model.linkages)
  const paramIds = new Set(model.params.map((param) => param.id))
  return Object.keys(supplied).reduce<DynamicValueMap>((result, key) => (
    paramIds.has(key) ? engine.execute(key, result, model.params) : result
  ), values)
}

function validateDynamicConstraints(
  model: ModelDefinition,
  params: DynamicValueMap,
  supplied: Record<string, unknown>
): ValidationError[] {
  if (!model.linkages?.length) return []
  const engine = new LinkageEngine(model.linkages)
  const errors: ValidationError[] = []
  for (const param of model.params) {
    if (!(param.id in supplied)) continue
    const value = params[param.id]
    const options = engine.getFilteredOptions(param.id, params, model.params)
    if (options.length > 0 && !options.some((option) => Object.is(option.value, value))) {
      errors.push({ paramId: param.id, type: 'options', message: '参数值不在当前联动可选范围内' })
    }
    const range = engine.getFilteredRange(param.id, params, model.params)
    if (range && typeof value === 'number' && (
      (range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max)
    )) {
      errors.push({ paramId: param.id, type: 'range', message: '参数值不在当前联动数值范围内' })
    }
  }
  return errors
}

export function prepareGenerationTask(input: GenerationPreparationInput): Record<string, unknown> {
  const model = registry.getModel(input.modelId)
  if (!model) throw new GenerationPreparationError('MODEL_NOT_FOUND', '生成模型不存在', { modelId: input.modelId })
  if (model.meta.type !== input.mediaType) {
    throw new GenerationPreparationError('INVALID_INPUT', '生成媒体类型与模型能力不匹配', {
      modelId: input.modelId,
      expectedMediaType: model.meta.type,
      receivedMediaType: input.mediaType,
    })
  }

  const supplied = { ...(input.options ?? {}) }
  const values: DynamicValueMap = {
    ...registry.getDefaultValues(model.meta.id),
    ...supplied,
    prompt: input.prompt,
  }
  const normalized = applyLinkages(model, values, supplied)
  const imagesCount = mediaCount(supplied, 'uploadedFilePaths', 'images')
  const videosCount = mediaCount(supplied, 'uploadedVideoFilePaths', 'videos')
  const audiosCount = mediaCount(supplied, 'uploadedAudioFilePaths', 'audios')
  const limits = resolveInputLimits(model.meta.id, normalized, { imagesCount, videosCount })
  const mediaErrors = [
    ['images', imagesCount, limits.images],
    ['videos', videosCount, limits.videos],
    ['audios', audiosCount, limits.audios],
  ].flatMap(([kind, count, range]) => {
    const resolved = range as { min: number; max: number }
    return typeof count === 'number' && (count < resolved.min || count > resolved.max)
      ? [{ paramId: kind, type: 'range' as const, message: `${kind} 输入数量必须为 ${resolved.min}～${resolved.max}` }]
      : []
  })
  const paramErrors = [
    ...validateParams(normalized, model.params),
    ...validateDynamicConstraints(model, normalized, supplied),
    ...mediaErrors,
  ]
  const hasInput = input.prompt.trim().length > 0 || imagesCount > 0 || videosCount > 0 || audiosCount > 0 || hasAlternativeModelInput(model, normalized)
  if (!hasInput) {
    paramErrors.push({ paramId: 'prompt', type: 'required', message: '必须提供提示词或允许的媒体引用' })
  }
  if (paramErrors.length > 0) {
    throw new GenerationPreparationError('INVALID_INPUT', '生成参数未通过模型配置校验', {
      modelId: model.meta.id,
      errors: paramErrors.map((error) => ({ paramId: error.paramId, type: error.type, message: error.message })),
    })
  }

  if (model.request?.builder) {
    try {
      model.request.builder(normalized)
    } catch (error) {
      throw new GenerationPreparationError('INVALID_INPUT', '生成请求无法由当前模型配置构建', {
        modelId: model.meta.id,
        reason: error instanceof Error ? error.message : 'request_builder_failed',
      })
    }
  }

  return {
    prepared: true,
    modelId: model.meta.id,
    providerId: model.meta.provider,
    mediaType: model.meta.type,
    options: normalized,
    mediaLimits: limits,
    priceEstimate: createPriceEstimate(model, normalized),
    selectionEvidence: {
      selectedModelId: model.meta.id,
      canonicalModelId: model.meta.canonicalModelId,
      providerId: model.meta.provider,
      availableInRegistry: true,
      recommendedByDescription: modelDescriptionText(model).includes('推荐使用'),
      qualitativeDescription: modelDescriptionText(model),
      tags: model.meta.tags ?? [],
      schemaValidated: true,
      mediaTypeMatched: model.meta.type === input.mediaType,
      requestBuilderValidated: Boolean(model.request?.builder),
    },
  }
}
