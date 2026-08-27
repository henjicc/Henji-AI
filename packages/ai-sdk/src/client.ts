import { catalog, flattenRuntimeParams } from './catalog'
import { createModelIndex, type ModelIndex } from './catalog/model-index'
import {
  resolveLlmTaskId,
  runLlmChatStream,
  type LlmChatStreamHooks,
  type LlmChatStreamOutcome,
} from './llm/chat'
import type { LlmChatRequestDto, LlmStreamEmitter } from './llm/chatTypes'
import type { ModelStepEvent, ModelStepInput, ModelStepResult } from './llm/modelStep'
import { runModelStep } from './llm/sdk/runtime'
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
import {
  AiRuntimeError,
  cancelTask,
  clearCancelFlag,
  registerAbortController,
  resolveRuntimeContext,
  type RuntimeContext,
  type TaskNamespace,
} from './runtime'
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

export interface AIClientProviderRegistration {
  id: ProviderId
  adapter: ProviderAdapter
}

export interface CreateAIClientConfig {
  runtime: RuntimeContext
  providers?: readonly AIClientProviderRegistration[]
  models?: readonly ModelRuntimeDefinition[]
}

export interface AIClientGenerateResult {
  status: ProviderExecutionResult['status']
  url: string
  taskId?: string
  metadata: JsonValue
}

export interface AIClientGenerationRequestInfo {
  requestId: string
  requestedModelId: string
  providerId: ProviderId
  route: string
  method: string
  requestBody: JsonValue
}

export interface AIClientGenerationCompletedInfo extends AIClientGenerationRequestInfo {
  result: AIClientGenerateResult
}

export interface AIClientGenerationHooks {
  onRequestBuilt?: (info: AIClientGenerationRequestInfo) => void
  onCompleted?: (info: AIClientGenerationCompletedInfo) => void
}

export interface AIClientContinuePollingRequest extends AiContinuePollingRequestDto {
  /** 宿主需要稳定关联日志或取消时可显式传入；不属于痕迹AI IPC DTO。 */
  requestId?: string
}

export interface AIClientCancelRequest {
  namespace: TaskNamespace
  taskId: string
}

export interface AIClientCatalog {
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

export interface AIClientProviders {
  list(): ProviderId[]
  testConnection(providerId: ProviderId): Promise<ProviderConnectionTestResultDto>
}

export interface AIClientChat {
  stream(
    request: LlmChatRequestDto,
    emit: LlmStreamEmitter,
    hooks?: LlmChatStreamHooks
  ): Promise<LlmChatStreamOutcome>
  modelStep(
    input: ModelStepInput,
    emit: (event: ModelStepEvent) => void
  ): Promise<ModelStepResult>
}

export interface AIClient {
  generate(
    request: AiGenerateRequestDto,
    hooks?: AIClientGenerationHooks
  ): Promise<AIClientGenerateResult>
  continuePolling(
    request: AIClientContinuePollingRequest,
    hooks?: AIClientGenerationHooks
  ): Promise<AIClientGenerateResult>
  cancel(request: AIClientCancelRequest): void
  chat: AIClientChat
  catalog: AIClientCatalog
  providers: AIClientProviders
  dispose(): void
}

/**
 * 创建一个共享单一 RuntimeContext 的 SDK 客户端。
 *
 * 客户端只编排既有生成、轮询、LLM、目录、连通性与取消能力。媒体结果落盘、应用结构化
 * 日志/trace、进度学习、IPC DTO 与 filePath 均由宿主负责；生成参数继续使用既有扁平字段，
 * 不引入 providerOptions 包装层。
 */
export function createAIClient(config: CreateAIClientConfig): AIClient {
  const runtime = resolveRuntimeContext(config.runtime)
  const ownedProviderIds = registerClientProviders(config.providers ?? [])
  const modelIndex = createModelIndex([...catalog, ...(config.models ?? [])])
  let disposed = false

  const ensureActive = (): void => {
    if (disposed) {
      throw new AiRuntimeError('client_disposed', 'AI client has been disposed')
    }
  }

  const clientCatalog: AIClientCatalog = {
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

  const client: AIClient = {
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
    chat: {
      async stream(request, emit, hooks = {}) {
        ensureActive()
        const taskId = resolveLlmTaskId(request)
        return await runLlmChatStream(request, taskId, emit, runtime, hooks)
      },
      async modelStep(input, emit) {
        ensureActive()
        return await runModelStep(input, emit, runtime)
      },
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
      for (const providerId of ownedProviderIds) {
        unregisterProvider(providerId)
      }
    },
  }

  return client
}

function registerClientProviders(
  registrations: readonly AIClientProviderRegistration[]
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
  hooks: AIClientGenerationHooks
): Promise<AIClientGenerateResult> {
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
      requestId
    )
    const info: AIClientGenerationRequestInfo = {
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
  request: AIClientContinuePollingRequest,
  hooks: AIClientGenerationHooks
): Promise<AIClientGenerateResult> {
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
    const info: AIClientGenerationRequestInfo = {
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
