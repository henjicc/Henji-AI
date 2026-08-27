import { AiRuntimeError, cancelledError } from '../../runtime/AiRuntimeError'
import { resolveRuntimeContext } from '../../runtime/RuntimeContext'
import { normalizeCapabilityStableId } from '../../capabilities/validation'
import { countLlmInputChars } from '../message-metrics'
import type {
  CreateLlmModuleClientConfig,
  LlmModule,
  LlmModuleClient,
  LlmModuleDescriptor,
  LlmModuleDiscoveryOptions,
  LlmModuleEvent,
  LlmModuleExecuteOptions,
  LlmModuleExecutionMode,
  LlmModuleExecutionOutcome,
  LlmModuleHandle,
  LlmModuleRequest,
} from './types'
import {
  validateDiscoveredModels,
  validateLlmModuleOutput,
  validateLlmModuleStreamEvent,
} from './result-validation'
import {
  describeLlmModuleCoordinate,
  describeLlmModuleSource,
  llmModuleCoordinate,
  snapshotLlmModuleDescriptor,
} from './validation'

interface RegisteredModule {
  module: LlmModule
  disposed: boolean
}

interface ActiveOperation {
  moduleId: string
  sourceNamespace: string
  controller: AbortController
  finished: Promise<void>
  markFinished(): void
}

interface OperationLease {
  signal: AbortSignal
  timedOut(): boolean
  release(): void
}

export function createLlmModuleClient(config: CreateLlmModuleClientConfig): LlmModuleClient {
  const runtime = resolveRuntimeContext(config.runtime)
  const modules = new Map<string, RegisteredModule>()
  const coordinates = new Map<string, string>()
  const active = new Map<string, ActiveOperation>()
  let disposed = false

  const ensureActive = (): void => {
    if (disposed) throw new AiRuntimeError('llm_module_client_disposed', 'LLM module client has been disposed')
  }

  const client: LlmModuleClient = {
    register(module) {
      ensureActive()
      const descriptor = snapshotLlmModuleDescriptor(module.descriptor)
      const existing = modules.get(descriptor.id)
      if (existing) {
        throw new AiRuntimeError(
          'llm_module_already_registered',
          `LLM module id "${descriptor.id}" from ${describeLlmModuleSource(descriptor)} conflicts with ` +
          `module from ${describeLlmModuleSource(existing.module.descriptor)}`
        )
      }
      const coordinate = llmModuleCoordinate(descriptor)
      const existingId = coordinates.get(coordinate)
      if (existingId) {
        const owner = modules.get(existingId)
        throw new AiRuntimeError(
          'llm_model_already_registered',
          `LLM model coordinate "${describeLlmModuleCoordinate(descriptor)}" from ` +
          `${describeLlmModuleSource(descriptor)} is already owned by module "${existingId}" from ` +
          `${owner ? describeLlmModuleSource(owner.module.descriptor) : 'an unknown source'}`
        )
      }
      const registered = { ...module, descriptor } as LlmModule
      modules.set(descriptor.id, { module: registered, disposed: false })
      coordinates.set(coordinate, descriptor.id)
      return createHandle(client, descriptor)
    },
    async unregister(moduleId) {
      ensureActive()
      const id = normalizeModuleId(moduleId)
      const registered = modules.get(id)
      if (!registered) return false
      modules.delete(id)
      releaseCoordinate(coordinates, registered.module.descriptor, id)
      await abortAndWait([...active.values()].filter((operation) => operation.moduleId === id))
      await disposeRegistered(registered)
      return true
    },
    async drainSource(namespace) {
      ensureActive()
      const owner = normalizeSourceNamespace(namespace)
      const pending = [...active.values()].filter((operation) => operation.sourceNamespace === owner)
      await abortAndWait(pending)
      return pending.length
    },
    async unregisterSource(namespace) {
      ensureActive()
      const owner = normalizeSourceNamespace(namespace)
      const owned = [...modules.entries()].filter(([, entry]) => (
        entry.module.descriptor.source.namespace === owner
      ))
      for (const [id, entry] of owned) {
        modules.delete(id)
        releaseCoordinate(coordinates, entry.module.descriptor, id)
      }
      await abortAndWait([...active.values()].filter((operation) => operation.sourceNamespace === owner))
      await Promise.all(owned.map(async ([, entry]) => await disposeRegistered(entry)))
      return owned.length
    },
    list() {
      ensureActive()
      return [...modules.values()].map((entry) => entry.module.descriptor)
    },
    get(moduleId) {
      ensureActive()
      const registered = modules.get(normalizeModuleId(moduleId))
      return registered ? createHandle(client, registered.module.descriptor) : undefined
    },
    async execute(moduleId, request, options = {}) {
      ensureActive()
      const id = normalizeModuleId(moduleId)
      const registered = requireModule(modules, id)
      const descriptor = registered.module.descriptor
      const mode = resolveMode(descriptor, options.mode)
      validateRequestCoordinates(descriptor, request)
      const requestId = normalizeRequestId(options.requestId, `${id}-${Date.now()}`)
      const lease = beginOperation(active, descriptor, requestId, options)
      const fullRequest = {
        ...request,
        providerId: descriptor.providerId,
        modelId: descriptor.modelId,
        capabilities: { ...descriptor.capabilities },
      }
      const startedAtMs = Date.now()
      const inputChars = countLlmInputChars(fullRequest.messages)
      const span = runtime.tracer.startSpan('llm.module.execute', {
        requestId, moduleId: id, providerId: descriptor.providerId, modelId: descriptor.modelId,
        sourceNamespace: descriptor.source.namespace, mode,
      })
      runtime.logger.info('LLM 模块执行开始', logContext(descriptor, requestId, {
        event: 'llm.module.execute.start', mode,
      }))
      try {
        if (lease.signal.aborted) throw cancelledError(requestId)
        const output = validateLlmModuleOutput(await registered.module.execute(fullRequest, {
          runtime,
          requestId,
          signal: lease.signal,
          mode,
          emit: async (event) => {
            validateLlmModuleStreamEvent(event, id)
            if (mode !== 'event-stream') {
              throw new AiRuntimeError(
                'llm_module_mode_violation',
                `LLM module "${id}" emitted ${event.type} in request-response mode; ` +
                'use event-stream mode or stop emitting incremental events'
              )
            }
            await options.onEvent?.(event)
          },
        }), id)
        if (lease.signal.aborted) throw cancelledError(requestId)
        if (output.usage) await emit(options, { type: 'Usage', data: output.usage })
        await emit(options, { type: 'Finish', data: { finishReason: output.finishReason } })
        const elapsedMs = Date.now() - startedAtMs
        const outputChars = output.output.length + output.reasoningOutput.length
        const outcome: LlmModuleExecutionOutcome = {
          ...output,
          providerId: descriptor.providerId,
          modelId: descriptor.modelId,
          startedAtMs,
          elapsedMs,
          inputChars,
          outputChars,
        }
        await emit(options, {
          type: 'Done',
          data: {
            providerId: descriptor.providerId,
            modelId: descriptor.modelId,
            startedAtMs,
            elapsedMs,
            inputChars,
            outputChars,
          },
        })
        runtime.logger.info('LLM 模块执行完成', logContext(descriptor, requestId, {
          event: 'llm.module.execute.completed', elapsedMs, inputChars, outputChars,
        }))
        span.end()
        return outcome
      } catch (error) {
        const normalized = normalizeOperationError(id, requestId, error, lease)
        try { await emit(options, { type: 'Error', data: normalized.message }) } catch { /* 保留首个失败。 */ }
        runtime.logger.error('LLM 模块执行失败', logContext(descriptor, requestId, {
          event: 'llm.module.execute.failed', error: normalized,
        }))
        span.end(normalized)
        throw normalized
      } finally {
        lease.release()
      }
    },
    async discover(moduleId, options = {}) {
      ensureActive()
      const id = normalizeModuleId(moduleId)
      const registered = requireModule(modules, id)
      const descriptor = registered.module.descriptor
      if (!registered.module.discover) {
        throw new AiRuntimeError(
          'llm_discovery_unsupported',
          `LLM module "${id}" (${describeLlmModuleCoordinate(descriptor)}) has no dynamic discovery adapter; ` +
          'use its descriptor modelId or register a module with discover()'
        )
      }
      const requestId = normalizeRequestId(options.requestId, `${id}-discover-${Date.now()}`)
      const lease = beginOperation(active, descriptor, requestId, options)
      const span = runtime.tracer.startSpan('llm.module.discover', {
        requestId, moduleId: id, providerId: descriptor.providerId, sourceNamespace: descriptor.source.namespace,
      })
      runtime.logger.info('LLM 模块模型发现开始', logContext(descriptor, requestId, {
        event: 'llm.module.discover.start',
      }))
      try {
        if (lease.signal.aborted) throw cancelledError(requestId)
        const models = validateDiscoveredModels(await registered.module.discover({
          runtime, requestId, signal: lease.signal,
        }), id)
        if (lease.signal.aborted) throw cancelledError(requestId)
        runtime.logger.info('LLM 模块模型发现完成', logContext(descriptor, requestId, {
          event: 'llm.module.discover.completed', modelCount: models.length,
        }))
        span.end()
        return models
      } catch (error) {
        const normalized = normalizeOperationError(id, requestId, error, lease)
        runtime.logger.error('LLM 模块模型发现失败', logContext(descriptor, requestId, {
          event: 'llm.module.discover.failed', error: normalized,
        }))
        span.end(normalized)
        throw normalized
      } finally {
        lease.release()
      }
    },
    cancel(requestId) {
      ensureActive()
      active.get(requestId.trim())?.controller.abort()
    },
    async dispose() {
      if (disposed) return
      disposed = true
      const registered = [...modules.values()]
      modules.clear()
      coordinates.clear()
      await abortAndWait([...active.values()])
      active.clear()
      await Promise.all(registered.map(async (entry) => await disposeRegistered(entry)))
    },
  }

  try {
    for (const module of config.modules ?? []) client.register(module)
  } catch (error) {
    void client.dispose()
    throw error
  }
  return client
}

function createHandle(client: LlmModuleClient, descriptor: LlmModuleDescriptor): LlmModuleHandle {
  return {
    descriptor,
    execute: async (request, options) => await client.execute(descriptor.id, request, options),
    discover: async (options) => await client.discover(descriptor.id, options),
  }
}

function requireModule(modules: Map<string, RegisteredModule>, id: string): RegisteredModule {
  const module = modules.get(id)
  if (module) return module
  const available = [...modules.keys()]
  throw new AiRuntimeError(
    'llm_module_not_found',
    `Unknown LLM module "${id}". Available modules: ${available.length ? available.join(', ') : '(none)'}`
  )
}

function beginOperation(
  active: Map<string, ActiveOperation>,
  descriptor: LlmModuleDescriptor,
  requestId: string,
  options: LlmModuleExecuteOptions | LlmModuleDiscoveryOptions
): OperationLease {
  if (active.has(requestId)) {
    throw new AiRuntimeError(
      'llm_request_active',
      `LLM request "${requestId}" is already active; choose a unique requestId or cancel the existing request`
    )
  }
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new AiRuntimeError('invalid_llm_timeout', 'LLM module timeoutMs must be a positive finite number')
  }
  const controller = new AbortController()
  const forwardAbort = (): void => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', forwardAbort, { once: true })
  let didTimeOut = false
  const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
    didTimeOut = true
    controller.abort()
  }, options.timeoutMs)
  let markFinished = (): void => undefined
  const finished = new Promise<void>((resolve) => { markFinished = resolve })
  active.set(requestId, {
    moduleId: descriptor.id,
    sourceNamespace: descriptor.source.namespace,
    controller,
    finished,
    markFinished,
  })
  let released = false
  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    release: () => {
      if (released) return
      released = true
      options.signal?.removeEventListener('abort', forwardAbort)
      if (timer !== undefined) clearTimeout(timer)
      active.delete(requestId)
      markFinished()
    },
  }
}

function resolveMode(
  descriptor: LlmModuleDescriptor,
  requested: LlmModuleExecutionMode | undefined
): LlmModuleExecutionMode {
  const mode = requested ?? (descriptor.executionModes.includes('event-stream')
    ? 'event-stream'
    : 'request-response')
  if (!descriptor.executionModes.includes(mode)) {
    throw new AiRuntimeError(
      'llm_module_mode_unsupported',
      `LLM module "${descriptor.id}" does not support ${mode}. Available modes: ` +
      descriptor.executionModes.join(', ')
    )
  }
  return mode
}

function validateRequestCoordinates(descriptor: LlmModuleDescriptor, request: LlmModuleRequest): void {
  const providerId = request.providerId === undefined
    ? descriptor.providerId
    : normalizeCapabilityStableId(request.providerId, 'invalid_llm_provider_id', 'LLM request provider id')
  const modelId = request.modelId === undefined
    ? descriptor.modelId
    : normalizeCapabilityStableId(request.modelId, 'invalid_llm_model_id', 'LLM request model id')
  if (providerId !== descriptor.providerId || modelId !== descriptor.modelId) {
    throw new AiRuntimeError(
      'llm_module_coordinate_mismatch',
      `LLM module "${descriptor.id}" owns ${describeLlmModuleCoordinate(descriptor)}, ` +
      `but request selected ${providerId}/${modelId}; choose the matching module or omit request coordinates`
    )
  }
}

function normalizeOperationError(
  moduleId: string,
  requestId: string,
  error: unknown,
  lease: OperationLease
): AiRuntimeError {
  if (lease.timedOut()) {
    return new AiRuntimeError('llm_timeout', `LLM module "${moduleId}" timed out: ${requestId}`)
  }
  if (lease.signal.aborted) return cancelledError(requestId)
  if (error instanceof AiRuntimeError) return error
  return new AiRuntimeError(
    'llm_module_execution_failed',
    `LLM module "${moduleId}" failed: ${error instanceof Error ? error.message : String(error)}`
  )
}

function normalizeModuleId(id: string): string {
  return normalizeCapabilityStableId(id, 'invalid_llm_module_id', 'LLM module id')
}

function normalizeSourceNamespace(namespace: string): string {
  return normalizeCapabilityStableId(
    namespace,
    'invalid_llm_module_source',
    'LLM module source namespace'
  )
}

function normalizeRequestId(value: string | undefined, fallback: string): string {
  return normalizeCapabilityStableId(value?.trim() || fallback, 'invalid_llm_request_id', 'LLM request id')
}

function releaseCoordinate(
  coordinates: Map<string, string>,
  descriptor: LlmModuleDescriptor,
  moduleId: string
): void {
  const coordinate = llmModuleCoordinate(descriptor)
  if (coordinates.get(coordinate) === moduleId) coordinates.delete(coordinate)
}

async function abortAndWait(operations: readonly ActiveOperation[]): Promise<void> {
  for (const operation of operations) operation.controller.abort()
  await Promise.all(operations.map(async (operation) => await operation.finished))
}

async function disposeRegistered(registered: RegisteredModule): Promise<void> {
  if (registered.disposed) return
  registered.disposed = true
  await registered.module.dispose?.()
}

async function emit(options: LlmModuleExecuteOptions, event: LlmModuleEvent): Promise<void> {
  await options.onEvent?.(event)
}

function logContext(
  descriptor: LlmModuleDescriptor,
  requestId: string,
  detail: { event: string; error?: unknown; [key: string]: unknown }
): {
  event: string
  requestId: string
  providerId: string
  modelId: string
  context: Record<string, unknown>
  error?: unknown
} {
  const { event, error, ...context } = detail
  return {
    event,
    requestId,
    providerId: descriptor.providerId,
    modelId: descriptor.modelId,
    context: { moduleId: descriptor.id, sourceNamespace: descriptor.source.namespace, ...context },
    error,
  }
}
