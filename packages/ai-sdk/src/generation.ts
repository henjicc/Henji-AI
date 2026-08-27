import { catalog, flattenRuntimeParams } from './catalog'
import { createModelIndex, type ModelIndex } from './catalog/model-index'
import { buildRequest } from './protocols/request-builder-dsl'
import { normalizeRequestBody } from './protocols/request-normalizer'
import {
  executeContinuePolling,
  executeGenerate,
  listProviders,
  registerProvider,
  testProviderConnection,
  unregisterProvider,
  type ProviderAdapter,
} from './providers'
import { AiRuntimeError } from './runtime/AiRuntimeError'
import { resolveRuntimeContext, type RuntimeContext } from './runtime/RuntimeContext'
import {
  cancelTask,
  clearCancelFlag,
  registerAbortController,
  type TaskNamespace,
} from './runtime/task-registry'
import type {
  ModelRuntimeDefinition,
  ModelTag,
  ModelType,
  ProviderId,
  RuntimeParamDef,
} from './types/model'
import type {
  AiContinuePollingRequestDto,
  AiGenerateRequestDto,
  JsonObject,
  JsonValue,
  ProviderConnectionTestResultDto,
  ProviderExecutionResult,
} from './types/runtime'
import { preprocessRequestBody } from './upload/preprocess'

export interface GenerationClientProviderRegistration {
  id: ProviderId
  adapter: ProviderAdapter
}

export interface CreateGenerationClientConfig {
  runtime: RuntimeContext
  providers?: readonly GenerationClientProviderRegistration[]
  models?: readonly ModelRuntimeDefinition[]
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

/**
 * 创建只含生成能力的可移植客户端。根 `createAIClient` 也组合这一个内核，生成、轮询、
 * 取消、目录和供应商行为不会产生第二套实现。
 */
export function createGenerationClient(config: CreateGenerationClientConfig): GenerationClient {
  const runtime = resolveRuntimeContext(config.runtime)
  const ownedProviderIds = registerClientProviders(config.providers ?? [])
  const modelIndex = createModelIndex([...catalog, ...(config.models ?? [])])
  let disposed = false

  const ensureActive = (): void => {
    if (disposed) {
      throw new AiRuntimeError('client_disposed', 'AI client has been disposed')
    }
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
      const model = resolveModel(modelIndex, modelId)
      return mergeAliasParamDefaults(modelId, params, model)
    },
  }

  return {
    async generate(request, hooks = {}) {
      ensureActive()
      return await executeGeneration(modelIndex, runtime, request, hooks)
    },
    async continuePolling(request, hooks = {}) {
      ensureActive()
      return await executePolling(modelIndex, runtime, request, hooks)
    },
    cancel(request) {
      ensureActive()
      cancelTask(request.namespace, request.taskId)
    },
    catalog: clientCatalog,
    providers: {
      list() {
        ensureActive()
        return listProviders()
      },
      async testConnection(providerId) {
        ensureActive()
        return await testProviderConnection(providerId, runtime)
      },
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const providerId of ownedProviderIds) unregisterProvider(providerId)
    },
  }
}

function registerClientProviders(
  registrations: readonly GenerationClientProviderRegistration[]
): ProviderId[] {
  const registered: ProviderId[] = []
  try {
    for (const registration of registrations) {
      registerProvider(registration.id, registration.adapter)
      registered.push(registration.id)
    }
    return registered
  } catch (error) {
    for (const providerId of registered) unregisterProvider(providerId)
    throw error
  }
}

async function executeGeneration(
  modelIndex: ModelIndex,
  runtime: Required<RuntimeContext>,
  request: AiGenerateRequestDto,
  hooks: GenerationClientHooks
): Promise<GenerationClientResult> {
  const requestId = request.requestId?.trim() || `${request.modelId}-${Date.now()}`
  const model = resolveModel(modelIndex, request.modelId)
  const effectiveParams = mergeAliasParamDefaults(request.modelId, request.params, model)
  const providerId = model.meta.provider
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
    if (!builtRequest.route.trim()) {
      throw new AiRuntimeError('invalid_route', 'Request route is empty')
    }
    const normalizedBody = normalizeRequestBody(builtRequest.body, model.runtimeConstraints)
    const requestBody = await preprocessRequestBody(
      providerId,
      builtRequest.route,
      normalizedBody,
      runtime,
      effectiveParams,
      model.runtimeConstraints,
      requestId,
      controller.signal
    )
    const info: GenerationClientRequestInfo = {
      requestId,
      requestedModelId: request.modelId,
      providerId,
      route: builtRequest.route,
      method: builtRequest.method,
      requestBody,
    }
    hooks.onRequestBuilt?.(info)
    const result = await executeGenerate(providerId, {
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
  runtime: Required<RuntimeContext>,
  request: GenerationClientContinuePollingRequest,
  hooks: GenerationClientHooks
): Promise<GenerationClientResult> {
  const taskId = request.taskId.trim()
  const requestId = request.requestId?.trim() || `continue-${request.modelId}-${Date.now()}`
  const model = resolveModel(modelIndex, request.modelId)
  const effectiveParams = mergeAliasParamDefaults(request.modelId, request.params ?? {}, model)
  const providerId = model.meta.provider
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
    const result = await executeContinuePolling(providerId, {
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
  runtime: Required<RuntimeContext>,
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
