import { AiRuntimeError, cancelledError } from '../runtime/AiRuntimeError'
import { resolveRuntimeContext, type RuntimeContext } from '../runtime/RuntimeContext'
import type {
  CapabilityDescriptor,
  CapabilityExecuteOptions,
  CapabilityHandle,
  CapabilityKind,
  CapabilityModule,
} from './types'

export interface CreateCapabilityClientConfig {
  runtime: RuntimeContext
  modules?: readonly CapabilityModule<unknown, unknown>[]
}

export interface CapabilityClient {
  register<TInput, TOutput>(
    module: CapabilityModule<TInput, TOutput>
  ): CapabilityHandle<TInput, TOutput>
  unregister(moduleId: string): Promise<boolean>
  list(kind?: CapabilityKind): readonly CapabilityDescriptor[]
  get<TInput, TOutput>(moduleId: string): CapabilityHandle<TInput, TOutput> | undefined
  execute<TInput, TOutput>(
    moduleId: string,
    input: TInput,
    options?: CapabilityExecuteOptions
  ): Promise<TOutput>
  cancel(requestId: string): void
  dispose(): Promise<void>
}

interface RegisteredModule {
  module: CapabilityModule<unknown, unknown>
  disposed: boolean
}

interface ActiveExecution {
  moduleId: string
  controller: AbortController
  finished: Promise<void>
  markFinished: () => void
}

export function createCapabilityClient(config: CreateCapabilityClientConfig): CapabilityClient {
  const runtime = resolveRuntimeContext(config.runtime)
  const modules = new Map<string, RegisteredModule>()
  const active = new Map<string, ActiveExecution>()
  let disposed = false

  const ensureActive = (): void => {
    if (disposed) throw new AiRuntimeError('client_disposed', 'Capability client has been disposed')
  }

  const client: CapabilityClient = {
    register<TInput, TOutput>(module: CapabilityModule<TInput, TOutput>) {
      ensureActive()
      const id = normalizeModuleId(module.descriptor.id)
      validateDescriptor(module.descriptor)
      if (modules.has(id)) {
        throw new AiRuntimeError(
          'capability_already_registered',
          `Capability module already registered: ${id}`
        )
      }
      modules.set(id, {
        module: module as CapabilityModule<unknown, unknown>,
        disposed: false,
      })
      return createHandle<TInput, TOutput>(client, module.descriptor)
    },
    async unregister(moduleId) {
      ensureActive()
      const id = normalizeModuleId(moduleId)
      const registered = modules.get(id)
      if (!registered) return false
      const pending = abortModuleExecutions(active, id)
      modules.delete(id)
      await Promise.all(pending)
      await disposeRegisteredModule(registered)
      return true
    },
    list(kind) {
      ensureActive()
      return [...modules.values()]
        .map(({ module }) => module.descriptor)
        .filter((descriptor) => kind === undefined || descriptor.kind === kind)
    },
    get<TInput, TOutput>(moduleId: string) {
      ensureActive()
      const registered = modules.get(normalizeModuleId(moduleId))
      return registered
        ? createHandle<TInput, TOutput>(client, registered.module.descriptor)
        : undefined
    },
    async execute<TInput, TOutput>(
      moduleId: string,
      input: TInput,
      options: CapabilityExecuteOptions = {}
    ): Promise<TOutput> {
      ensureActive()
      const id = normalizeModuleId(moduleId)
      const registered = modules.get(id)
      if (!registered) {
        throw new AiRuntimeError('capability_not_found', `Unknown capability module: ${id}`)
      }
      const requestId = options.requestId?.trim() || `${id}-${Date.now()}`
      if (active.has(requestId)) {
        throw new AiRuntimeError(
          'capability_request_active',
          `Capability request already active: ${requestId}`
        )
      }
      const controller = new AbortController()
      let markFinished = (): void => undefined
      const finished = new Promise<void>((resolve) => {
        markFinished = resolve
      })
      const forwardAbort = (): void => controller.abort()
      if (options.signal?.aborted) controller.abort()
      else options.signal?.addEventListener('abort', forwardAbort, { once: true })
      active.set(requestId, { moduleId: id, controller, finished, markFinished })
      const span = runtime.tracer.startSpan('capability.execute', {
        requestId,
        capabilityId: id,
        capabilityKind: registered.module.descriptor.kind,
      })
      runtime.logger.info('能力模块执行开始', {
        event: 'capability.execute.start',
        requestId,
        context: { capabilityId: id, capabilityKind: registered.module.descriptor.kind },
      })
      try {
        if (controller.signal.aborted) throw cancelledError(requestId)
        const output = await registered.module.execute(input, {
          runtime,
          requestId,
          signal: controller.signal,
        }) as TOutput
        if (controller.signal.aborted) throw cancelledError(requestId)
        runtime.logger.info('能力模块执行完成', {
          event: 'capability.execute.completed',
          requestId,
          context: { capabilityId: id },
        })
        span.end()
        return output
      } catch (error) {
        const normalized = controller.signal.aborted
          ? cancelledError(requestId)
          : normalizeExecutionError(id, error)
        runtime.logger.error('能力模块执行失败', {
          event: 'capability.execute.failed',
          requestId,
          context: { capabilityId: id },
          error: normalized,
        })
        span.end(normalized)
        throw normalized
      } finally {
        options.signal?.removeEventListener('abort', forwardAbort)
        active.delete(requestId)
        markFinished()
      }
    },
    cancel(requestId) {
      ensureActive()
      active.get(requestId.trim())?.controller.abort()
    },
    async dispose() {
      if (disposed) return
      disposed = true
      const pending = [...active.values()]
      for (const execution of pending) execution.controller.abort()
      await Promise.all(pending.map((execution) => execution.finished))
      active.clear()
      const registered = [...modules.values()]
      modules.clear()
      await Promise.all(registered.map(async (entry) => await disposeRegisteredModule(entry)))
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

function createHandle<TInput, TOutput>(
  client: CapabilityClient,
  descriptor: CapabilityDescriptor
): CapabilityHandle<TInput, TOutput> {
  return {
    descriptor,
    execute: async (input, options) => await client.execute<TInput, TOutput>(
      descriptor.id,
      input,
      options
    ),
  }
}

function normalizeModuleId(id: string): string {
  const normalized = id.trim()
  if (!normalized) {
    throw new AiRuntimeError('invalid_capability_id', 'Capability module id must be non-empty')
  }
  return normalized
}

function validateDescriptor(descriptor: CapabilityDescriptor): void {
  normalizeModuleId(descriptor.id)
  if (!descriptor.kind.trim()) {
    throw new AiRuntimeError('invalid_capability_kind', 'Capability kind must be non-empty')
  }
  if (!Array.isArray(descriptor.contract.input) || !Array.isArray(descriptor.contract.output)) {
    throw new AiRuntimeError('invalid_capability_contract', 'Capability contract requires input/output arrays')
  }
}

function abortModuleExecutions(
  active: Map<string, ActiveExecution>,
  moduleId: string
): Promise<void>[] {
  const pending: Promise<void>[] = []
  for (const execution of active.values()) {
    if (execution.moduleId !== moduleId) continue
    execution.controller.abort()
    pending.push(execution.finished)
  }
  return pending
}

async function disposeRegisteredModule(registered: RegisteredModule): Promise<void> {
  if (registered.disposed) return
  registered.disposed = true
  await registered.module.dispose?.()
}

function normalizeExecutionError(moduleId: string, error: unknown): AiRuntimeError {
  if (error instanceof AiRuntimeError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new AiRuntimeError(
    'capability_execution_failed',
    `Capability module ${moduleId} failed: ${message}`
  )
}
