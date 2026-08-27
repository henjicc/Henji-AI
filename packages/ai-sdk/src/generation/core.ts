import { flattenRuntimeParams } from '../catalog/consumer-contract'
import { createModelIndex, type ModelIndex } from '../catalog/model-index'
import { buildRequest } from '../protocols/request-builder-dsl'
import { normalizeRequestBody } from '../protocols/request-normalizer'
import type { ProviderAdapter } from '../providers/types'
import { AiRuntimeError } from '../runtime/AiRuntimeError'
import {
  resolveRuntimeContext,
  type ResolvedRuntimeContext,
  type RuntimeContext,
} from '../runtime/RuntimeContext'
import {
  cancelTask,
  clearCancelFlag,
  registerAbortController,
  type TaskNamespace,
} from '../runtime/task-registry'
import type {
  ModelRuntimeDefinition,
  ModelTag,
  ModelType,
  ProviderId,
  RuntimeParamDef,
} from '../types/model'
import type {
  AiContinuePollingRequestDto,
  AiGenerateRequestDto,
  JsonObject,
  JsonValue,
  ProviderConnectionTestResultDto,
  ProviderExecutionResult,
} from '../types/runtime'

export interface GenerationPreprocessInput {
  providerId: ProviderId
  route: string
  body: JsonValue
  runtime: RuntimeContext
  params: JsonObject
  model: ModelRuntimeDefinition
  requestId: string
  signal: AbortSignal
}

export type GenerationRequestPreprocessor = (
  input: GenerationPreprocessInput
) => Promise<JsonValue>

export interface GenerationClientProviderRegistration {
  id: ProviderId
  adapter: ProviderAdapter
  preprocess?: GenerationRequestPreprocessor
  testConnection?: (runtime: RuntimeContext) => Promise<ProviderConnectionTestResultDto>
}

export interface GenerationPack {
  readonly models: readonly ModelRuntimeDefinition[]
  readonly providers: readonly GenerationClientProviderRegistration[]
}

export interface CreateModularGenerationClientConfig {
  runtime: RuntimeContext
  models?: readonly ModelRuntimeDefinition[]
  providers?: readonly GenerationClientProviderRegistration[]
  packs?: readonly GenerationPack[]
}

export interface GenerationClientResult {
  status: ProviderExecutionResult['status']
  url: string
  taskId?: string
  metadata: JsonValue
}

export interface GenerationClientRequestInfo {
  requestId: string
  requestedModelId: string
  providerId: ProviderId
  route: string
  method: string
  requestBody: JsonValue
}

export interface GenerationClientCompletedInfo extends GenerationClientRequestInfo {
  result: GenerationClientResult
}

export interface GenerationClientHooks {
  onRequestBuilt?: (info: GenerationClientRequestInfo) => void
  onCompleted?: (info: GenerationClientCompletedInfo) => void
}

export interface GenerationClientContinuePollingRequest extends AiContinuePollingRequestDto {
  /** 宿主需要稳定关联日志或取消时可显式传入；不属于痕迹AI IPC DTO。 */
  requestId?: string
}

export interface GenerationClientCancelRequest {
  namespace: TaskNamespace
  taskId: string
}

export interface GenerationClientCatalog {
  get(modelId: string): ModelRuntimeDefinition | undefined
  list(): readonly ModelRuntimeDefinition[]
  listByType(type: ModelType): readonly ModelRuntimeDefinition[]
  listByProvider(providerId: ProviderId): readonly ModelRuntimeDefinition[]
  listByTag(tag: ModelTag): readonly ModelRuntimeDefinition[]
  getDefaultValues(modelId: string): JsonObject
  getParams(modelId: string): readonly RuntimeParamDef[]
  estimatePrice(modelId: string, params?: JsonObject): number
  resolveParams(modelId: string, params?: JsonObject): JsonObject
}

export interface GenerationClientProviders {
  list(): ProviderId[]
  testConnection(providerId: ProviderId): Promise<ProviderConnectionTestResultDto>
}

export interface GenerationClient {
  generate(
    request: AiGenerateRequestDto,
    hooks?: GenerationClientHooks
  ): Promise<GenerationClientResult>
  continuePolling(
    request: GenerationClientContinuePollingRequest,
    hooks?: GenerationClientHooks
  ): Promise<GenerationClientResult>
  cancel(request: GenerationClientCancelRequest): void
  catalog: GenerationClientCatalog
  providers: GenerationClientProviders
  dispose(): void
}

/** 创建不含任何内置模型或供应商的生成客户端。 */
export function createModularGenerationClient(
  config: CreateModularGenerationClientConfig
): GenerationClient {
  const modules = collectModules(config)
  return createGenerationClientCore({
    runtime: config.runtime,
    models: modules.models,
    providers: modules.providers,
  })
}

interface CreateGenerationClientCoreConfig {
  runtime: RuntimeContext
  models: readonly ModelRuntimeDefinition[]
  providers: readonly GenerationClientProviderRegistration[]
  onDispose?: () => void
}

/** @internal 默认全量入口也委托这一份生成内核。 */
export function createGenerationClientCore(
  config: CreateGenerationClientCoreConfig
): GenerationClient {
  const runtime = resolveRuntimeContext(config.runtime)
  const modelIndex = createModelIndex(config.models)
  const providers = createProviderIndex(config.providers)
  let disposed = false

  const ensureActive = (): void => {
    if (disposed) throw new AiRuntimeError('client_disposed', 'AI client has been disposed')
  }

  const clientCatalog: GenerationClientCatalog = {
    get(modelId) {
      ensureActive()
      return modelIndex.get(modelId)
    },
    list() {
      ensureActive()
      return modelIndex.list()
    },
    listByType(type) {
      ensureActive()
      return modelIndex.list().filter((model) => model.meta.type === type)
    },
    listByProvider(providerId) {
      ensureActive()
      return modelIndex.list().filter((model) => model.meta.provider === providerId)
    },
    listByTag(tag) {
      ensureActive()
      return modelIndex.list().filter((model) => model.meta.tags?.includes(tag))
    },
    getDefaultValues(modelId) {
      ensureActive()
      const model = resolveModel(modelIndex, modelId)
      return {
        ...collectParamDefaults(model.params),
        ...mergeAliasParamDefaults(modelId, {}, model),
      }
    },
    getParams(modelId) {
      ensureActive()
      return resolveModel(modelIndex, modelId).params
    },
    estimatePrice(modelId, params = {}) {
      ensureActive()
      const model = resolveModel(modelIndex, modelId)
      if (model.pricing.fixed !== undefined) return model.pricing.fixed
      const effectiveParams = {
        ...collectParamDefaults(model.params),
        ...mergeAliasParamDefaults(modelId, params, model),
      }
      return model.pricing.calculator?.(effectiveParams) ?? 0
    },
    resolveParams(modelId, params = {}) {
      ensureActive()
      return mergeAliasParamDefaults(modelId, params, resolveModel(modelIndex, modelId))
    },
  }

  return {
    async generate(request, hooks = {}) {
      ensureActive()
      return await executeGeneration(modelIndex, providers, runtime, request, hooks)
    },
    async continuePolling(request, hooks = {}) {
      ensureActive()
      return await executePolling(modelIndex, providers, runtime, request, hooks)
    },
    cancel(request) {
      ensureActive()
      cancelTask(request.namespace, request.taskId)
    },
    catalog: clientCatalog,
    providers: {
      list() {
        ensureActive()
        return [...providers.keys()]
      },
      async testConnection(providerId) {
        ensureActive()
        const provider = resolveProvider(providers, providerId)
        if (provider.testConnection) return await provider.testConnection(runtime)
        const startedAt = Date.now()
        const configured = Boolean(await runtime.credentials.get('generation', providerId))
        return {
          providerId,
          status: configured ? 'saved_unverified' : 'not_configured',
          verified: false,
          checkedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt),
        }
      },
    },
    dispose() {
      if (disposed) return
      disposed = true
      config.onDispose?.()
    },
  }
}

function collectModules(config: CreateModularGenerationClientConfig): {
  models: ModelRuntimeDefinition[]
  providers: GenerationClientProviderRegistration[]
} {
  const models = [...(config.models ?? [])]
  const providers = [...(config.providers ?? [])]
  const providersById = new Map<ProviderId, GenerationClientProviderRegistration>()
  for (const provider of providers) {
    if (!providersById.has(provider.id)) providersById.set(provider.id, provider)
  }
  for (const pack of config.packs ?? []) {
    models.push(...pack.models)
    for (const provider of pack.providers) {
      const existing = providersById.get(provider.id)
      if (existing && isEquivalentProviderRegistration(existing, provider)) continue
      providers.push(provider)
      if (!existing) providersById.set(provider.id, provider)
    }
  }
  return { models, providers }
}

function isEquivalentProviderRegistration(
  left: GenerationClientProviderRegistration,
  right: GenerationClientProviderRegistration
): boolean {
  return left.adapter === right.adapter &&
    left.preprocess === right.preprocess &&
    left.testConnection === right.testConnection
}

function createProviderIndex(
  registrations: readonly GenerationClientProviderRegistration[]
): Map<ProviderId, GenerationClientProviderRegistration> {
  const providers = new Map<ProviderId, GenerationClientProviderRegistration>()
  for (const registration of registrations) {
    const id = registration.id.trim()
    if (!id) throw new AiRuntimeError('invalid_provider_id', 'Provider id must be a non-empty string')
    if (providers.has(id)) {
      throw new AiRuntimeError('provider_already_registered', `Provider already registered: ${id}`)
    }
    providers.set(id, registration)
  }
  return providers
}

async function executeGeneration(
  modelIndex: ModelIndex,
  providers: ReadonlyMap<ProviderId, GenerationClientProviderRegistration>,
  runtime: ResolvedRuntimeContext,
  request: AiGenerateRequestDto,
  hooks: GenerationClientHooks
): Promise<GenerationClientResult> {
  const requestId = request.requestId?.trim() || `${request.modelId}-${Date.now()}`
  const model = resolveModel(modelIndex, request.modelId)
  const effectiveParams = mergeAliasParamDefaults(request.modelId, request.params, model)
  const providerId = model.meta.provider
  const provider = resolveProvider(providers, providerId)
  const controller = new AbortController()
  const span = runtime.tracer.startSpan('generation.generate', {
    requestId,
    modelId: request.modelId,
    providerId,
  })

  clearCancelFlag('generation', requestId)
  registerAbortController('generation', requestId, controller)
  try {
    const apiKey = await requireApiKey(runtime, providerId)
    const builtRequest = await buildRequest(effectiveParams, model)
    if (!builtRequest.route.trim()) throw new AiRuntimeError('invalid_route', 'Request route is empty')
    const normalizedBody = normalizeRequestBody(builtRequest.body, model.runtimeConstraints)
    const requestBody = provider.preprocess
      ? await provider.preprocess({
        providerId,
        route: builtRequest.route,
        body: normalizedBody,
        runtime,
        params: effectiveParams,
        model,
        requestId,
        signal: controller.signal,
      })
      : normalizedBody
    const info: GenerationClientRequestInfo = {
      requestId,
      requestedModelId: request.modelId,
      providerId,
      route: builtRequest.route,
      method: builtRequest.method,
      requestBody,
    }
    hooks.onRequestBuilt?.(info)
    const result = await provider.adapter.execute({
      apiKey,
      route: builtRequest.route,
      method: builtRequest.method,
      body: requestBody,
      requestId,
      polling: model.meta.polling,
      signal: controller.signal,
      runtime,
    })
    hooks.onCompleted?.({ ...info, result })
    span.end()
    return result
  } catch (error) {
    span.end(error)
    throw error
  } finally {
    clearCancelFlag('generation', requestId)
  }
}

async function executePolling(
  modelIndex: ModelIndex,
  providers: ReadonlyMap<ProviderId, GenerationClientProviderRegistration>,
  runtime: ResolvedRuntimeContext,
  request: GenerationClientContinuePollingRequest,
  hooks: GenerationClientHooks
): Promise<GenerationClientResult> {
  const taskId = request.taskId.trim()
  const requestId = request.requestId?.trim() || `continue-${request.modelId}-${Date.now()}`
  const model = resolveModel(modelIndex, request.modelId)
  const effectiveParams = mergeAliasParamDefaults(request.modelId, request.params ?? {}, model)
  const providerId = model.meta.provider
  const provider = resolveProvider(providers, providerId)
  const controller = new AbortController()
  const span = runtime.tracer.startSpan('generation.continue-polling', {
    requestId,
    taskId,
    modelId: request.modelId,
    providerId,
  })

  clearCancelFlag('generation', taskId)
  registerAbortController('generation', taskId, controller)
  try {
    const apiKey = await requireApiKey(runtime, providerId)
    const builtRequest = await buildRequest(effectiveParams, model)
    const info: GenerationClientRequestInfo = {
      requestId,
      requestedModelId: request.modelId,
      providerId,
      route: builtRequest.route,
      method: 'GET',
      requestBody: builtRequest.body,
    }
    hooks.onRequestBuilt?.(info)
    const result = await provider.adapter.continuePolling({
      apiKey,
      route: builtRequest.route,
      taskId,
      requestId,
      polling: model.meta.polling,
      signal: controller.signal,
      runtime,
    })
    hooks.onCompleted?.({ ...info, result })
    span.end()
    return result
  } catch (error) {
    span.end(error)
    throw error
  } finally {
    clearCancelFlag('generation', taskId)
  }
}

function resolveProvider(
  providers: ReadonlyMap<ProviderId, GenerationClientProviderRegistration>,
  providerId: ProviderId
): GenerationClientProviderRegistration {
  const provider = providers.get(providerId)
  if (!provider) throw new AiRuntimeError('unknown_provider', `Unknown provider: ${providerId}`)
  return provider
}

function resolveModel(modelIndex: ModelIndex, modelId: string): ModelRuntimeDefinition {
  const model = modelIndex.get(modelId)
  if (!model) {
    throw new AiRuntimeError('provider_not_found', `Unable to resolve provider for model: ${modelId}`)
  }
  return model
}

function collectParamDefaults(params: readonly RuntimeParamDef[]): JsonObject {
  return Object.fromEntries(
    flattenRuntimeParams(params).map((param) => [param.id, param.default])
  ) as JsonObject
}

async function requireApiKey(
  runtime: ResolvedRuntimeContext,
  providerId: ProviderId
): Promise<string> {
  const apiKey = await runtime.credentials.get('generation', providerId)
  if (!apiKey) {
    throw new AiRuntimeError('api_key_missing', `API key not configured for provider: ${providerId}`)
  }
  return apiKey
}

function mergeAliasParamDefaults(
  requestedModelId: string,
  params: JsonObject,
  model: ModelRuntimeDefinition
): JsonObject {
  const normalizedParams: JsonObject = { ...params }
  for (const mapping of Object.values(model.meta.aliasParamMappings ?? {})) {
    for (const [legacyParamId, currentParamId] of Object.entries(mapping)) {
      if (normalizedParams[currentParamId] === undefined && normalizedParams[legacyParamId] !== undefined) {
        normalizedParams[currentParamId] = normalizedParams[legacyParamId]
      }
    }
  }
  const defaults = model.meta.aliasParamDefaults?.[requestedModelId]
  return defaults ? { ...defaults, ...normalizedParams } : normalizedParams
}
