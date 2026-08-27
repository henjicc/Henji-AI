import type {
  CapabilityDescriptor,
  CapabilityModule,
  CapabilityRealtimeModule,
} from '../capabilities'
import type { GenerationPack } from '../generation/core'
import type { LlmModelCatalogEntry } from '../llm/modelCatalog'
import type { LlmModelConfig } from '../llm/types'
import type { ModelRuntimeDefinition, ModelType, RuntimeInputLimitsConfig } from '../types/model'
import { AiRuntimeError } from '../runtime/AiRuntimeError'
import {
  normalizeCapabilityStableId,
  validateCapabilityDescriptor,
} from '../capabilities/validation'

type ExtensibleString = string & Record<never, never>

export type StandardModelOperation =
  | 'image-generation'
  | 'text-to-image'
  | 'image-edit'
  | 'video-generation'
  | 'text-to-video'
  | 'image-to-video'
  | 'reference-to-video'
  | 'video-edit'
  | 'audio-generation'
  | 'chat'
  | 'speech-recognition'
  | 'speech-to-text'
  | 'translation'
  | 'text-translation'
  | 'ocr'

export type ModelOperation = StandardModelOperation | ExtensibleString
export type ModelContentKind =
  | 'text'
  | 'structured-data'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | ExtensibleString

export interface ModelCapabilityProfile {
  id: string
  providerIds: readonly string[]
  outputModalities: readonly ModelType[]
  operations: readonly ModelOperation[]
  acceptedInputContentKinds: readonly ModelContentKind[]
  outputContentKinds: readonly ModelContentKind[]
  features: readonly string[]
  tags: readonly string[]
}

export interface CapabilityCriterion<T extends string> {
  anyOf?: readonly T[]
  allOf?: readonly T[]
}

export interface ModelCapabilityQuery {
  /** 默认各维度 AND；`any` 表示任一已填写维度命中。 */
  mode?: 'all' | 'any'
  providerIds?: string | CapabilityCriterion<string>
  outputModalities?: ModelType | CapabilityCriterion<ModelType>
  operations?: ModelOperation | CapabilityCriterion<ModelOperation>
  acceptedInputContentKinds?: ModelContentKind | CapabilityCriterion<ModelContentKind>
  outputContentKinds?: ModelContentKind | CapabilityCriterion<ModelContentKind>
  features?: string | CapabilityCriterion<string>
  tags?: string | CapabilityCriterion<string>
}

export type CapabilityDiscoveryItem =
  | { sourceKind: 'generation-model'; id: string; profile: ModelCapabilityProfile; source: ModelRuntimeDefinition }
  | { sourceKind: 'llm-model'; id: string; profile: ModelCapabilityProfile; source: LlmModelCatalogEntry | LlmModelConfig }
  | { sourceKind: 'extension'; id: string; profile: ModelCapabilityProfile; source: CapabilityDescriptor }

export interface CreateCapabilityDiscoveryInput {
  generationPacks?: readonly GenerationPack[]
  generationModels?: readonly ModelRuntimeDefinition[]
  llmEntries?: readonly LlmModelCatalogEntry[]
  llmModels?: readonly LlmModelConfig[]
  extensions?: readonly (
    | CapabilityDescriptor
    | CapabilityModule<unknown, unknown, unknown>
    | CapabilityRealtimeModule<unknown, unknown, unknown, unknown>
  )[]
}

export interface ModelCapabilityDiscovery {
  list(): readonly CapabilityDiscoveryItem[]
  search(query: ModelCapabilityQuery): readonly CapabilityDiscoveryItem[]
}

/** 只从宿主已导入的候选 pack/module 建立发现索引；不会隐式导入默认 catalog。 */
export function createModelCapabilityDiscovery(input: CreateCapabilityDiscoveryInput): ModelCapabilityDiscovery {
  const items: CapabilityDiscoveryItem[] = []
  const itemsById = new Map<string, CapabilityDiscoveryItem>()
  const add = (item: CapabilityDiscoveryItem): void => {
    normalizeCapabilityStableId(item.id, 'invalid_capability_discovery_id', 'Capability discovery id')
    const existing = itemsById.get(item.id)
    if (existing) {
      throw new AiRuntimeError(
        'capability_discovery_id_conflict',
        `Discovery id "${item.id}" from ${describeDiscoveryItem(item)} conflicts with ` +
        `${describeDiscoveryItem(existing)}`
      )
    }
    itemsById.set(item.id, item)
    items.push(item)
  }
  const generation = dedupeGenerationModels([
    ...(input.generationModels ?? []),
    ...(input.generationPacks ?? []).flatMap((pack) => pack.models),
  ])
  for (const model of generation) {
    add({ sourceKind: 'generation-model', id: model.meta.id, profile: profileGenerationModel(model), source: model })
  }
  for (const entry of input.llmEntries ?? []) {
    add({ sourceKind: 'llm-model', id: entry.id, profile: profileLlmCatalogEntry(entry), source: entry })
  }
  for (const model of input.llmModels ?? []) {
    const providerId = normalizeCapabilityStableId(
      model.providerId,
      'invalid_capability_provider_id',
      'LLM provider id'
    )
    const modelId = normalizeCapabilityStableId(
      model.modelId,
      'invalid_capability_model_id',
      'LLM model id'
    )
    const id = `${providerId}:${modelId}`
    add({ sourceKind: 'llm-model', id, profile: profileLlmModel(model), source: model })
  }
  for (const extension of input.extensions ?? []) {
    const descriptor = 'descriptor' in extension ? extension.descriptor : extension
    validateCapabilityDescriptor(descriptor)
    add({ sourceKind: 'extension', id: descriptor.id, profile: profileCapabilityDescriptor(descriptor), source: descriptor })
  }
  return {
    list: () => items,
    search: (query) => items.filter((item) => matchesModelCapabilityProfile(item.profile, query)),
  }
}

export function profileGenerationModel(model: ModelRuntimeDefinition): ModelCapabilityProfile {
  const tags = [...new Set(model.meta.tags ?? [])]
  const operations = deriveGenerationOperations(model.meta.type, tags)
  const inputs = new Set<ModelContentKind>(['text'])
  collectParamInputs(model, inputs)
  collectLimitInputs(model.inputLimits, inputs)
  for (const field of model.runtimeConstraints?.mediaFields ?? []) inputs.add(field.kind)
  const output = model.meta.type as ModelContentKind
  return {
    id: model.meta.id,
    providerIds: [model.meta.provider],
    outputModalities: [model.meta.type],
    operations,
    acceptedInputContentKinds: [...inputs],
    outputContentKinds: [output],
    features: tags.filter((tag) => !tag.startsWith('provider-') && !operations.includes(tag as ModelOperation)),
    tags,
  }
}

export function profileLlmCatalogEntry(entry: LlmModelCatalogEntry): ModelCapabilityProfile {
  const inputs: ModelContentKind[] = ['text']
  if (entry.input.image) inputs.push('image')
  if (entry.input.video) inputs.push('video')
  if (entry.input.audio) inputs.push('audio')
  const features = llmFeatures(entry.toolCall, entry.parallelTools, entry.reasoning, entry.structuredOutputMode)
  return llmProfile(entry.id, [entry.vendor.toLowerCase()], inputs, features, entry.structuredOutputMode)
}

export function profileLlmModel(model: LlmModelConfig): ModelCapabilityProfile {
  const inputs: ModelContentKind[] = ['text']
  if (model.capabilities.image) inputs.push('image')
  if (model.capabilities.video) inputs.push('video')
  if (model.capabilities.audio) inputs.push('audio')
  const features = llmFeatures(
    model.capabilities.toolCall,
    model.capabilities.parallelTools,
    model.capabilities.reasoning,
    model.capabilities.structuredOutputMode
  )
  return llmProfile(
    `${model.providerId}:${model.modelId}`,
    [model.providerId],
    inputs,
    features,
    model.capabilities.structuredOutputMode
  )
}

export function profileCapabilityDescriptor(descriptor: CapabilityDescriptor): ModelCapabilityProfile {
  return {
    id: descriptor.id,
    providerIds: descriptor.providerIds ? [...descriptor.providerIds] : [],
    outputModalities: descriptor.contract.output.map((value) => value.kind),
    operations: descriptor.operations?.length ? [...descriptor.operations] : [descriptor.kind],
    acceptedInputContentKinds: descriptor.contract.input.map((value) => value.kind),
    outputContentKinds: descriptor.contract.output.map((value) => value.kind),
    features: descriptor.features ? [...descriptor.features] : [],
    tags: descriptor.tags ? [...descriptor.tags] : [],
  }
}

export function matchesModelCapabilityProfile(
  profile: ModelCapabilityProfile,
  query: ModelCapabilityQuery
): boolean {
  const checks = [
    criterionMatches(profile.providerIds, query.providerIds),
    criterionMatches(profile.outputModalities, query.outputModalities),
    criterionMatches(profile.operations, query.operations),
    criterionMatches(profile.acceptedInputContentKinds, query.acceptedInputContentKinds),
    criterionMatches(profile.outputContentKinds, query.outputContentKinds),
    criterionMatches(profile.features, query.features),
    criterionMatches(profile.tags, query.tags),
  ].filter((value): value is boolean => value !== undefined)
  if (checks.length === 0) return true
  return query.mode === 'any' ? checks.some(Boolean) : checks.every(Boolean)
}

function criterionMatches<T extends string>(
  values: readonly T[],
  criterion: T | CapabilityCriterion<T> | undefined
): boolean | undefined {
  if (criterion === undefined) return undefined
  if (typeof criterion === 'string') return values.includes(criterion)
  const any = criterion.anyOf ?? []
  const all = criterion.allOf ?? []
  return (any.length === 0 || any.some((value) => values.includes(value))) &&
    all.every((value) => values.includes(value))
}

function deriveGenerationOperations(type: ModelType, tags: readonly string[]): ModelOperation[] {
  const operations = new Set<ModelOperation>()
  if (type === 'image') {
    operations.add('image-generation')
    if (tags.includes('text-to-image')) operations.add('text-to-image')
    if (tags.some((tag) => ['image-to-image', 'supports-image-editing', 'image-edit'].includes(tag))) operations.add('image-edit')
  } else if (type === 'video') {
    operations.add('video-generation')
    if (tags.includes('text-to-video')) operations.add('text-to-video')
    if (tags.some((tag) => ['image-to-video', 'start-end-frame'].includes(tag))) operations.add('image-to-video')
    if (tags.some((tag) => ['reference-mode', 'video-reference', 'multi-image-reference'].includes(tag))) operations.add('reference-to-video')
    if (tags.some((tag) => ['supports-video-editing', 'video-to-video', 'video-extension'].includes(tag))) operations.add('video-edit')
  } else if (type === 'audio') {
    operations.add('audio-generation')
  } else {
    operations.add(`${type}-generation`)
  }
  return [...operations]
}

function collectParamInputs(model: ModelRuntimeDefinition, target: Set<ModelContentKind>): void {
  const visit = (params: ModelRuntimeDefinition['params']): void => {
    for (const param of params) {
      if (param.type === 'image-upload') target.add('image')
      else if (param.type === 'video-upload') target.add('video')
      else if (param.type === 'file-upload') target.add('pdf')
      else if (param.type === 'panel') visit(param.children)
    }
  }
  visit(model.params)
}

function collectLimitInputs(
  limits: ModelRuntimeDefinition['inputLimits'],
  target: Set<ModelContentKind>
): void {
  if (!limits) return
  let value: RuntimeInputLimitsConfig
  try {
    value = typeof limits === 'function' ? limits({}) : limits
  } catch {
    return
  }
  if (value.images && value.images.max !== 0) target.add('image')
  if (value.videos && value.videos.max !== 0) target.add('video')
  if (value.audios && value.audios.max !== 0) target.add('audio')
  for (const rule of value.rules ?? []) {
    if (rule.images && rule.images.max !== 0) target.add('image')
    if (rule.videos && rule.videos.max !== 0) target.add('video')
    if (rule.audios && rule.audios.max !== 0) target.add('audio')
  }
}

function llmFeatures(
  toolCall: boolean,
  parallelTools: boolean,
  reasoning: boolean,
  structuredOutputMode: 'none' | 'json' | 'schema'
): string[] {
  return [
    ...(toolCall ? ['tool-call'] : []),
    ...(parallelTools ? ['parallel-tools'] : []),
    ...(reasoning ? ['reasoning'] : []),
    ...(structuredOutputMode !== 'none' ? ['structured-output'] : []),
  ]
}

function llmProfile(
  id: string,
  providerIds: readonly string[],
  inputs: readonly ModelContentKind[],
  features: readonly string[],
  structuredOutputMode: 'none' | 'json' | 'schema'
): ModelCapabilityProfile {
  return {
    id,
    providerIds,
    outputModalities: ['text'],
    operations: ['chat'],
    acceptedInputContentKinds: inputs,
    outputContentKinds: ['text', ...(structuredOutputMode !== 'none' ? ['structured-data' as const] : [])],
    features,
    tags: [],
  }
}

function dedupeGenerationModels(models: readonly ModelRuntimeDefinition[]): ModelRuntimeDefinition[] {
  return [...new Map(models.map((model) => [model.meta.id, model])).values()]
}

function describeDiscoveryItem(item: CapabilityDiscoveryItem): string {
  if (item.sourceKind !== 'extension') return `${item.sourceKind}`
  return `${item.source.source.kind} source "${item.source.source.namespace}"`
}
