import { AiRuntimeError, cancelledError } from '../runtime/AiRuntimeError'
import { resolveRuntimeContext, type RuntimeContext } from '../runtime/RuntimeContext'
import type {
  CapabilityDescriptor,
  CapabilityExecuteOptions,
  CapabilityHandle,
  CapabilityKind,
  CapabilityModule,
  CapabilityRealtimeModule,
  CapabilityRealtimeSession,
} from './types'
import {
  capabilityModelCoordinates,
  describeCapabilitySource,
  normalizeCapabilityStableId,
  snapshotCapabilityDescriptor,
  validateCapabilityDescriptor,
} from './validation'

export interface CreateCapabilityClientConfig {
  runtime: RuntimeContext
  modules?: readonly CapabilityModule<unknown, unknown, unknown>[]
  realtimeModules?: readonly CapabilityRealtimeModule<unknown, unknown, unknown, unknown>[]
}

export interface CapabilityClient {
  register<TInput, TOutput, TEvent = never>(
    module: CapabilityModule<TInput, TOutput, TEvent>
  ): CapabilityHandle<TInput, TOutput, TEvent>
  registerRealtime<TStart, TInput, TEvent, TOutput>(
    module: CapabilityRealtimeModule<TStart, TInput, TEvent, TOutput>
  ): CapabilityDescriptor
  unregister(moduleId: string): Promise<boolean>
  /** 注销同一包/插件命名空间拥有的全部模块，并等待活动请求与资源释放完成。 */
  unregisterSource(namespace: string): Promise<number>
  list(kind?: CapabilityKind): readonly CapabilityDescriptor[]
  get<TInput, TOutput, TEvent = never>(moduleId: string): CapabilityHandle<TInput, TOutput, TEvent> | undefined
  execute<TInput, TOutput, TEvent = never>(
    moduleId: string,
    input: TInput,
    options?: CapabilityExecuteOptions<TEvent>
  ): Promise<TOutput>
  openSession<TStart, TInput, TEvent, TOutput>(
    moduleId: string,
    input: TStart,
    options?: CapabilityExecuteOptions<TEvent>
  ): Promise<CapabilityRealtimeSession<TInput, TOutput>>
  cancel(requestId: string): void
  dispose(): Promise<void>
}

interface RegisteredModule {
  module:
    | CapabilityModule<unknown, unknown, unknown>
    | CapabilityRealtimeModule<unknown, unknown, unknown, unknown>
  mode: 'execute' | 'realtime'
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
  const modelCoordinates = new Map<string, string>()
  const active = new Map<string, ActiveExecution>()
  let disposed = false

  const ensureActive = (): void => {
    if (disposed) throw new AiRuntimeError('client_disposed', 'Capability client has been disposed')
  }

  const client: CapabilityClient = {
    register<TInput, TOutput, TEvent = never>(module: CapabilityModule<TInput, TOutput, TEvent>) {
      ensureActive()
      const descriptor = registerModule(
        modules,
        modelCoordinates,
        module as CapabilityModule<unknown, unknown, unknown>,
        'execute'
      )
      return createHandle<TInput, TOutput, TEvent>(client, descriptor)
    },
    registerRealtime<TStart, TInput, TEvent, TOutput>(
      module: CapabilityRealtimeModule<TStart, TInput, TEvent, TOutput>
    ) {
      ensureActive()
      return registerModule(
        modules,
        modelCoordinates,
        module as CapabilityRealtimeModule<unknown, unknown, unknown, unknown>,
        'realtime'
      )
    },
    async unregister(moduleId) {
      ensureActive()
      const id = normalizeModuleId(moduleId)
      const registered = modules.get(id)
      if (!registered) return false
      const pending = abortModuleExecutions(active, id)
      modules.delete(id)
      releaseModelCoordinates(modelCoordinates, registered.module.descriptor, id)
      await Promise.all(pending)
      await disposeRegisteredModule(registered)
      return true
    },
    async unregisterSource(namespace) {
      ensureActive()
      const normalizedNamespace = normalizeCapabilityStableId(
        namespace,
        'invalid_capability_source',
        'Capability source namespace'
      )
      const ownedIds = [...modules.entries()]
        .filter(([, registered]) => registered.module.descriptor.source.namespace === normalizedNamespace)
        .map(([id]) => id)
      await Promise.all(ownedIds.map(async (id) => await client.unregister(id)))
      return ownedIds.length
    },
    list(kind) {
      ensureActive()
      return [...modules.values()]
        .map(({ module }) => module.descriptor)
        .filter((descriptor) => kind === undefined || descriptor.kind === kind)
    },
    get<TInput, TOutput, TEvent = never>(moduleId: string) {
      ensureActive()
      const registered = modules.get(normalizeModuleId(moduleId))
      return registered?.mode === 'execute'
        ? createHandle<TInput, TOutput, TEvent>(client, registered.module.descriptor)
        : undefined
    },
    async execute<TInput, TOutput, TEvent = never>(
      moduleId: string,
      input: TInput,
      options: CapabilityExecuteOptions<TEvent> = {}
    ): Promise<TOutput> {
      ensureActive()
      const id = normalizeModuleId(moduleId)
      const registered = modules.get(id)
      if (!registered) {
        throw new AiRuntimeError('capability_not_found', `Unknown capability module: ${id}`)
      }
      if (registered.mode !== 'execute') {
        throw new AiRuntimeError('capability_mode_mismatch', `Capability module requires a realtime session: ${id}`)
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
      let timedOut = false
      const timeout = createTimeout(options.timeoutMs, () => {
        timedOut = true
        controller.abort()
      })
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
        const module = registered.module as CapabilityModule<TInput, TOutput, TEvent>
        const output = await module.execute(input, {
          runtime,
          requestId,
          signal: controller.signal,
          emit: async (event) => await options.onEvent?.(event),
        })
        if (controller.signal.aborted) throw cancelledError(requestId)
        runtime.logger.info('能力模块执行完成', {
          event: 'capability.execute.completed',
          requestId,
          context: { capabilityId: id },
        })
        span.end()
        return output
      } catch (error) {
        const normalized = timedOut
          ? new AiRuntimeError('timeout', `Capability request timed out: ${requestId}`)
          : controller.signal.aborted
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
        if (timeout !== undefined) clearTimeout(timeout)
        active.delete(requestId)
        markFinished()
      }
    },
    async openSession<TStart, TInput, TEvent, TOutput>(
      moduleId: string,
      input: TStart,
      options: CapabilityExecuteOptions<TEvent> = {}
    ): Promise<CapabilityRealtimeSession<TInput, TOutput>> {
      ensureActive()
      const id = normalizeModuleId(moduleId)
      const registered = modules.get(id)
      if (!registered) {
        throw new AiRuntimeError('capability_not_found', `Unknown capability module: ${id}`)
      }
      if (registered.mode !== 'realtime') {
        throw new AiRuntimeError('capability_mode_mismatch', `Capability module is not realtime: ${id}`)
      }
      const requestId = options.requestId?.trim() || `${id}-${Date.now()}`
      if (active.has(requestId)) {
        throw new AiRuntimeError('capability_request_active', `Capability request already active: ${requestId}`)
      }
      const controller = new AbortController()
      let markFinished = (): void => undefined
      const finished = new Promise<void>((resolve) => { markFinished = resolve })
      const forwardAbort = (): void => controller.abort()
      if (options.signal?.aborted) controller.abort()
      else options.signal?.addEventListener('abort', forwardAbort, { once: true })
      let timedOut = false
      const timeout = createTimeout(options.timeoutMs, () => {
        timedOut = true
        controller.abort()
      })
      active.set(requestId, { moduleId: id, controller, finished, markFinished })
      const span = runtime.tracer.startSpan('capability.session', {
        requestId,
        capabilityId: id,
        capabilityKind: registered.module.descriptor.kind,
      })
      runtime.logger.info('能力实时会话开始', {
        event: 'capability.session.start',
        requestId,
        context: { capabilityId: id, capabilityKind: registered.module.descriptor.kind },
      })
      try {
        if (controller.signal.aborted) throw cancelledError(requestId)
        const module = registered.module as CapabilityRealtimeModule<TStart, TInput, TEvent, TOutput>
        const driver = await module.open(input, {
          runtime,
          requestId,
          signal: controller.signal,
          emit: async (event) => await options.onEvent?.(event),
        })
        if (controller.signal.aborted) {
          await driver.close?.()
          throw timedOut
            ? new AiRuntimeError('timeout', `Capability session timed out: ${requestId}`)
            : cancelledError(requestId)
        }
        let closePromise: Promise<void> | undefined
        let finishPromise: Promise<TOutput> | undefined
        type Outcome = { kind: 'completed'; output: TOutput }
          | { kind: 'failed' | 'closed'; error: AiRuntimeError }
        let outcome: Outcome | undefined
        let settlement: Promise<void> | undefined
        let cleanupError: AiRuntimeError | undefined
        const pendingSends = new Set<(error: AiRuntimeError) => void>()
        let resolveResult!: (value: TOutput) => void
        let rejectResult!: (error: AiRuntimeError) => void
        const result = new Promise<TOutput>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
        // Observing is optional; the original promise remains rejected for callers.
        void result.catch(() => undefined)
        const closeDriver = (): Promise<void> => {
          closePromise ??= Promise.resolve().then(async () => await driver.close?.())
          return closePromise
        }
        const abortError = (): AiRuntimeError => timedOut
          ? new AiRuntimeError('timeout', `Capability session timed out: ${requestId}`)
          : cancelledError(requestId)
        const normalize = (error: unknown): AiRuntimeError => controller.signal.aborted
          ? abortError() : normalizeExecutionError(id, error)
        const inactiveError = (): AiRuntimeError => outcome && outcome.kind !== 'completed'
          ? outcome.error : new AiRuntimeError('realtime_session_inactive', `Capability session is inactive: ${requestId}`)
        const settle = (next: Outcome): Promise<void> => {
          if (settlement) return settlement
          outcome = next
          for (const reject of pendingSends) reject(inactiveError())
          pendingSends.clear()
          settlement = (async () => {
            let terminal = next
            try { await closeDriver() } catch (error) {
              cleanupError = normalizeExecutionError(id, error)
              // Keep the first failure/cancellation; failed cleanup cannot make
              // a successful result or explicit close look successful.
              if (terminal.kind !== 'failed') terminal = { kind: 'failed', error: cleanupError }
            }
            outcome = terminal
            controller.signal.removeEventListener('abort', onAbort)
            options.signal?.removeEventListener('abort', forwardAbort)
            if (timeout !== undefined) clearTimeout(timeout)
            active.delete(requestId)
            markFinished()
            if (terminal.kind === 'failed') {
              runtime.logger.error('能力实时会话失败', {
                event: 'capability.session.failed', requestId,
                context: { capabilityId: id, ...(cleanupError ? { cleanupErrorCode: cleanupError.code } : {}) },
                error: terminal.error,
              })
            } else {
              runtime.logger.info(terminal.kind === 'completed' ? '能力实时会话完成' : '能力实时会话关闭', {
                event: `capability.session.${terminal.kind}`, requestId, context: { capabilityId: id },
              })
            }
            span.end(terminal.kind === 'failed' ? terminal.error : undefined)
            if (terminal.kind === 'completed') resolveResult(terminal.output)
            else rejectResult(terminal.error)
          })()
          return settlement
        }
        const onAbort = (): void => { void settle({ kind: 'failed', error: abortError() }) }
        controller.signal.addEventListener('abort', onAbort, { once: true })
        if (driver.result) {
          void driver.result.then(
            output => settle({ kind: 'completed', output }),
            error => settle({ kind: 'failed', error: normalize(error) }),
          )
        }

        return {
          requestId,
          descriptor: registered.module.descriptor,
          result,
          send: async (value) => {
            if (outcome || finishPromise) throw inactiveError()
            if (controller.signal.aborted) throw abortError()
            let rejectSend!: (error: AiRuntimeError) => void
            const pending = new Promise<void>((resolve, reject) => {
              rejectSend = reject
              pendingSends.add(reject)
              void Promise.resolve().then(async () => {
                if (outcome) throw inactiveError()
                await driver.send(value)
              }).then(resolve, reject)
            })
            try { await pending } finally { pendingSends.delete(rejectSend) }
          },
          finish: () => {
            if (finishPromise) return finishPromise
            finishPromise = result
            if (!outcome) {
              void Promise.resolve().then(async () => {
                if (outcome) return
                try {
                  const output = await driver.finish()
                  if (controller.signal.aborted) throw abortError()
                  await settle({ kind: 'completed', output })
                } catch (error) {
                  await settle({ kind: 'failed', error: normalize(error) })
                }
              })
            }
            return finishPromise
          },
          close: async () => {
            if (outcome) { await settlement; return }
            await settle({ kind: 'closed', error: new AiRuntimeError('realtime_session_closed', `Capability session was closed: ${requestId}`) })
            if (cleanupError) throw cleanupError
          },
        }
      } catch (error) {
        options.signal?.removeEventListener('abort', forwardAbort)
        if (timeout !== undefined) clearTimeout(timeout)
        active.delete(requestId)
        markFinished()
        const normalized = timedOut
          ? new AiRuntimeError('timeout', `Capability session timed out: ${requestId}`)
          : controller.signal.aborted
            ? cancelledError(requestId)
            : normalizeExecutionError(id, error)
        runtime.logger.error('能力实时会话失败', {
          event: 'capability.session.failed', requestId, context: { capabilityId: id }, error: normalized,
        })
        span.end(normalized)
        throw normalized
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
      modelCoordinates.clear()
      await Promise.all(registered.map(async (entry) => await disposeRegisteredModule(entry)))
    },
  }

  try {
    for (const module of config.modules ?? []) client.register(module)
    for (const module of config.realtimeModules ?? []) client.registerRealtime(module)
  } catch (error) {
    void client.dispose()
    throw error
  }
  return client
}

function createHandle<TInput, TOutput, TEvent = never>(
  client: CapabilityClient,
  descriptor: CapabilityDescriptor
): CapabilityHandle<TInput, TOutput, TEvent> {
  return {
    descriptor,
    execute: async (input, options) => await client.execute<TInput, TOutput, TEvent>(
      descriptor.id,
      input,
      options
    ),
  }
}

function registerModule(
  modules: Map<string, RegisteredModule>,
  modelCoordinates: Map<string, string>,
  module: RegisteredModule['module'],
  mode: RegisteredModule['mode']
): CapabilityDescriptor {
  validateCapabilityDescriptor(module.descriptor)
  const descriptor = snapshotCapabilityDescriptor(module.descriptor)
  const id = normalizeModuleId(descriptor.id)
  const existing = modules.get(id)
  if (existing) {
    throw new AiRuntimeError(
      'capability_already_registered',
      `Capability module id "${id}" from ${describeCapabilitySource(descriptor)} conflicts with ` +
      `${existing.mode} module from ${describeCapabilitySource(existing.module.descriptor)}`
    )
  }
  for (const coordinate of capabilityModelCoordinates(descriptor)) {
    const existingId = modelCoordinates.get(coordinate)
    if (existingId) {
      const existingModule = modules.get(existingId)
      throw new AiRuntimeError(
        'capability_model_already_registered',
        `Capability model coordinate "${coordinate}" from ${describeCapabilitySource(descriptor)} ` +
        `is already owned by module "${existingId}" from ${
          existingModule ? describeCapabilitySource(existingModule.module.descriptor) : 'an unknown source'
        }`
      )
    }
  }
  const registeredModule = { ...module, descriptor } as RegisteredModule['module']
  modules.set(id, { module: registeredModule, mode, disposed: false })
  for (const coordinate of capabilityModelCoordinates(descriptor)) {
    modelCoordinates.set(coordinate, id)
  }
  return descriptor
}

function createTimeout(timeoutMs: number | undefined, abort: () => void): ReturnType<typeof setTimeout> | undefined {
  if (timeoutMs === undefined) return undefined
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new AiRuntimeError('invalid_timeout', 'Capability timeoutMs must be a positive finite number')
  }
  return setTimeout(abort, timeoutMs)
}

function normalizeModuleId(id: string): string {
  return normalizeCapabilityStableId(id, 'invalid_capability_id', 'Capability module id')
}

function releaseModelCoordinates(
  coordinates: Map<string, string>,
  descriptor: CapabilityDescriptor,
  moduleId: string
): void {
  for (const coordinate of capabilityModelCoordinates(descriptor)) {
    if (coordinates.get(coordinate) === moduleId) coordinates.delete(coordinate)
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
