import { LinkageEngine } from '@/core/linkage'
import { registry } from '@/core/ModelRegistry'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { validateParams, type ValidationError } from '@/core/request/paramValidator'
import { getI18nText, type ModelDefinition, type ParamDef } from '@/core/types'

export type GenerationMediaType = 'image' | 'video' | 'audio'

export interface GenerationModelSearchInput {
  query?: string
  mediaType?: GenerationMediaType
  providerId?: string
  tags?: string[]
}

export interface GenerationPreparationInput {
  modelId: string
  prompt: string
  mediaType: GenerationMediaType
  options?: Record<string, unknown>
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

export function searchGenerationModels(input: GenerationModelSearchInput): Array<Record<string, unknown>> {
  const terms = normalizeTerms(input.query)
  const requestedTags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
  return registry.listAllModels()
    .filter((model) => {
      if (input.mediaType && model.meta.type !== input.mediaType) return false
      if (input.providerId && model.meta.provider !== input.providerId) return false
      if (requestedTags.length && !requestedTags.every((tag) => model.meta.tags?.includes(tag))) return false
      const text = modelSearchText(model)
      return terms.every((term) => text.includes(term))
    })
    .map((model) => ({
      modelId: model.meta.id,
      canonicalModelId: model.meta.canonicalModelId,
      providerId: model.meta.provider,
      mediaType: model.meta.type,
      name: model.meta.name,
      description: model.meta.description,
      tags: model.meta.tags ?? [],
      inputLimits: toSafeValue(model.inputLimits),
    }))
}

export function getGenerationModelSchema(modelId: string): Record<string, unknown> {
  const model = registry.getModel(modelId)
  if (!model) throw new GenerationPreparationError('MODEL_NOT_FOUND', '生成模型不存在', { modelId })
  return {
    schemaVersion: 'generation-model-schema/v2',
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
  const hasInput = input.prompt.trim().length > 0 || imagesCount > 0 || videosCount > 0 || audiosCount > 0
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
  }
}
