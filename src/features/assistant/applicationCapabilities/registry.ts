import { CanvasPersistenceError } from '@/features/canvas/application/canvasPersistenceService'
import {
  closeApplicationSurfaceCapability,
  focusApplicationEntityCapability,
  getCurrentApplicationContextCapability,
  listGenerationHistoryCapability,
  openApplicationSurfaceCapability,
  openImageEditorWithSourceCapability,
  observeApplicationSurfaceCapability,
} from '@/core/assistant/builtinApplicationCapabilities'
import {
  getApplicationSettingsCapability,
  searchApplicationSettingsCapability,
} from '@/core/assistant/capabilities/settingsApplicationCapabilities'
import {
  BUILTIN_APPLICATION_CAPABILITY_REGISTRY,
} from '@/core/assistant/builtinApplicationCapabilityRegistry'
import { APPLICATION_SURFACE_IDS } from '@/core/assistant/applicationSurfaces'
import {
  applicationCapabilityInvocationSchema,
  type ApplicationCapabilityDefinition,
  type ApplicationCapabilityInvocation,
} from '@/core/assistant/applicationCapabilities'
import type { ApplicationCapabilityResult } from '@/core/assistant/hostContracts'
import { GenerationPreparationError } from '@/features/generation/application/generationPreparationService'
import { createLogger } from '@/core/logging'
import { CanvasApplicationError } from '@/features/canvas/application/canvasApplicationService'
import { MultiLayerDocumentNodeApplicationError } from '@/features/canvas/application/multiLayerDocumentNodeApplicationService'
import { ZodError } from 'zod'
import { ApplicationTransactionFailure, ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { transactionFailureFacts } from '@/core/assistant/applicationTransactionFailureFacts'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { applicationCallerAccess, assertApplicationCapabilityAllowed } from '@/core/application-control/callerContext'
import { getApplicationReflectionRegistry } from './applicationControlRegistry'

import { APPLICATION_REFLECTION_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/applicationReflectionApplicationCapabilities'

import { applicationReflectionHandlers } from './applicationReflectionAdapter'
import { createHostContextSnapshot } from '../hostContext/hostContext'
import { listGenerationHistory, openImageEditorWithSource } from './generationCapabilities'
import {
  getApplicationSettings,
  listApplicationSettingIds,
  searchApplicationSettings,
} from './settingsRegistry'
import {
  closeApplicationSurface,
  focusApplicationEntity,
  openApplicationSurface,
  listApplicationSurfaces,
} from './surfaceRegistry'
import type {
  ApplicationCapabilityHandlerRegistrar,
  CapabilityExecutionContext,
  CapabilityHandler,
} from './handlerTypes'
import { registerAssetCapabilityHandlers } from './registerAssetCapabilityHandlers'
import { registerCanvasCapabilityHandlers } from './registerCanvasCapabilityHandlers'
import { registerGenerationCapabilityHandlers } from './registerGenerationCapabilityHandlers'
import { registerImageMarkCapabilityHandlers } from './registerImageMarkCapabilityHandlers'
import { registerToolboxCapabilityHandlers } from './registerToolboxCapabilityHandlers'
import { observeApplicationSurface } from './surfaceObservation'

const logger = createLogger('features.assistant.application_capabilities')

class RendererApplicationCapabilityRegistry implements ApplicationCapabilityHandlerRegistrar {
  private readonly definitions = new Map<string, ApplicationCapabilityDefinition>()
  private readonly handlers = new Map<string, CapabilityHandler>()

  constructor() {
    for (const definition of BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list()) {
      this.definitions.set(definition.id, definition)
    }
  }

  registerHandler(id: string, handler: CapabilityHandler): void {
    const definition = this.definitions.get(id)
    if (!definition) throw new Error(`应用能力定义不存在：${id}`)
    if (this.handlers.has(id)) throw new Error(`应用能力处理器重复：${id}`)
    if (!definition.permission.trim()) throw new Error(`应用能力未声明权限：${id}`)
    if (definition.successEvidence.length === 0) throw new Error(`应用能力缺少成功证据：${id}`)
    this.handlers.set(id, handler)
  }

  listIds(): string[] {
    return [...this.handlers.keys()]
  }

  async execute(
    invocationInput: unknown,
    context: CapabilityExecutionContext
  ): Promise<Record<string, unknown>> {
    const invocation = applicationCapabilityInvocationSchema.parse(invocationInput)
    const definition = this.definitions.get(invocation.id)
    const handler = this.handlers.get(invocation.id)
    if (!definition || !handler) throw new Error('NOT_FOUND')
    if (context.signal.aborted) throw new Error('ABORTED')
    if (context.callerGrant) assertApplicationCapabilityAllowed(context.callerGrant, definition)
    if (definition.version !== invocation.version) throw new Error('VERSION_MISMATCH')
    const input = definition.inputSchema.parse(invocation.input)
    if (context.callerGrant && definition.resolveOperationTargets && !definition.readOnly) {
      // 外部基线来自实体反射；语义操作也必须从相同目标读取，不能比较助手界面计数。
      // 通用事务由引擎在持锁后核对，保留其原有原子预检。
      try {
        const targets = definition.resolveOperationTargets(input)
        if (!targets?.length) throw new Error('INVALID_INPUT:此操作缺少正式目标声明，无法核对读取基线。')
        const access = applicationCallerAccess(context.callerGrant, context.requestId ?? 'renderer', context.signal)
        const expected = invocation.expectedRevisions ?? {}
        const automatic = invocation.expectedRevisions === undefined && !definition.destructive
        const observed = new Set<string>()
        for (const ref of targets) {
          // 不可变任务引用不一定是反射实体。无 revision scope 的操作由领域处理器
          // 核对任务身份和实时状态；MCP 仍必须绑定该任务的原读取凭据及宿主会话。
          if (!getApplicationReflectionRegistry().getEntity(ref.kind) && definition.requiredScopes.length === 0) continue
          const snapshot = await getApplicationReflectionRegistry().readEntity(ref, [], access)
          for (const [scope, current] of Object.entries(snapshot.revisions)) {
            observed.add(scope)
            if (automatic) expected[scope] = current
            else if (expected[scope] !== current) {
              throw new Error(`CONFLICT:${ref.kind} 的 ${scope} 数据已变化或缺少基线，请重新读取原目标后再试。`)
            }
          }
        }
        if (Object.keys(expected).some((scope) => !observed.has(scope))) {
          throw new Error(`CONFLICT:基线包含无关作用域，本操作只需要 ${JSON.stringify([...observed])}。普通操作可省略 baselineIds 由应用自动核对；严格写入请只提供原目标的读取。`)
        }
        invocation.expectedRevisions = expected
        if (context.signal.aborted) throw new Error('ABORTED')
      } catch (error) { throw new ApplicationPreflightFailure(error) }
    } else if (!(context.callerGrant && invocation.id === 'change_application_entities')) {
      const before = createHostContextSnapshot()
      for (const [scope, expected] of Object.entries(invocation.expectedRevisions ?? {})) {
        if (before.scopeRevisions[scope] !== expected) throw new Error('CONFLICT')
      }
    }
    const inputRecord = input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : null
    const compatibilityRevisions = inputRecord?.expectedRevisions
    if (compatibilityRevisions && typeof compatibilityRevisions === 'object' && !Array.isArray(compatibilityRevisions)) {
      const authoritative = invocation.expectedRevisions ?? {}
      if (JSON.stringify(compatibilityRevisions) !== JSON.stringify(authoritative)) {
        throw new Error('REVISION_ENVELOPE_MISMATCH')
      }
    }
    const result = await handler(input, {
      ...context,
      expectedRevisions: invocation.expectedRevisions,
    })
    const snapshot = createHostContextSnapshot()
    const enriched = {
      ...result,
      revision: snapshot.revision,
      scopeRevisions: snapshot.scopeRevisions,
    }
    const enrichedOutput = definition.outputSchema.safeParse(enriched)
    if (enrichedOutput.success) return enrichedOutput.data as Record<string, unknown>
    return definition.outputSchema.parse(result) as Record<string, unknown>
  }
}

const registry = new RendererApplicationCapabilityRegistry()

function registerBuiltins(): void {
  registry.registerHandler(getCurrentApplicationContextCapability.id, () => {
    const snapshot = createHostContextSnapshot()
    return {
      surface: snapshot.surface ?? {
        id: `workspace.${snapshot.workspace.id}`,
        kind: 'workspace',
        focusedRef: null,
        selectedRefs: [],
      },
      catalogRevision: snapshot.catalogRevision ?? 0,
      ready: snapshot.uiReady,
      revision: snapshot.revision,
    }
  })
  registry.registerHandler(observeApplicationSurfaceCapability.id, async (input, context) => {
    const parsed = observeApplicationSurfaceCapability.inputSchema.parse(input)
    return await observeApplicationSurface(parsed, context.signal)
  })
  registry.registerHandler(openApplicationSurfaceCapability.id, (input, context) => {
    const parsed = openApplicationSurfaceCapability.inputSchema.parse(input)
    return openApplicationSurface(parsed.surfaceId, context)
  })
  registry.registerHandler(closeApplicationSurfaceCapability.id, (input) => {
    const parsed = closeApplicationSurfaceCapability.inputSchema.parse(input)
    return closeApplicationSurface(parsed.surfaceId)
  })
  registry.registerHandler(focusApplicationEntityCapability.id, async (input, context) => {
    const parsed = focusApplicationEntityCapability.inputSchema.parse(input)
    return await focusApplicationEntity(parsed.ref, context.signal, context)
  })
  // 通用反射能力：领域注册了实体和属性，助手就能读改增删，不必再为每个动作写专用能力
  for (const capability of APPLICATION_REFLECTION_APPLICATION_CAPABILITIES) {
    registry.registerHandler(capability.id, async (input, context) => {
      const parsed = capability.inputSchema.parse(input) as never
      if (capability.id === 'describe_application_entities') return await applicationReflectionHandlers.describeEntities(parsed, context)
      if (capability.id === 'list_application_entities') return await applicationReflectionHandlers.listEntities(parsed, context)
      if (capability.id === 'read_application_entity') return await applicationReflectionHandlers.readEntity(parsed, context)
      return await applicationReflectionHandlers.changeEntities(parsed, context)
    })
  }
  registry.registerHandler(searchApplicationSettingsCapability.id, (input) => {
    const parsed = searchApplicationSettingsCapability.inputSchema.parse(input)
    return { settings: searchApplicationSettings(parsed.query, parsed.limit) }
  })
  registry.registerHandler(getApplicationSettingsCapability.id, (input) => {
    const parsed = getApplicationSettingsCapability.inputSchema.parse(input)
    return getApplicationSettings(parsed.ids)
  })
  registry.registerHandler(listGenerationHistoryCapability.id, async (input) => {
    const parsed = listGenerationHistoryCapability.inputSchema.parse(input)
    return await listGenerationHistory(parsed)
  })
  registry.registerHandler(openImageEditorWithSourceCapability.id, async (input, context) => {
    const parsed = openImageEditorWithSourceCapability.inputSchema.parse(input)
    return await openImageEditorWithSource(parsed.sourceRef, context)
  })
}

registerBuiltins()
registerGenerationCapabilityHandlers(registry)
registerAssetCapabilityHandlers(registry)
registerCanvasCapabilityHandlers(registry)
registerToolboxCapabilityHandlers(registry)
registerImageMarkCapabilityHandlers(registry)

const frontendCapabilityCount = BUILTIN_APPLICATION_CAPABILITY_REGISTRY
  .list()
  .filter((definition) => definition.side === 'frontend')
  .length
if (registry.listIds().length !== frontendCapabilityCount) {
  throw new Error('应用能力注册不完整')
}
const registeredSurfaceIds = new Set(listApplicationSurfaces().map((surface) => surface.id))
for (const surfaceId of APPLICATION_SURFACE_IDS) {
  if (!registeredSurfaceIds.has(surfaceId)) throw new Error(`应用 Surface 未注册：${surfaceId}`)
}
if (listApplicationSettingIds().length === 0) {
  throw new Error('应用设置注册中心为空')
}

/**
 * 把 Zod 校验失败翻译成调用方能据此自纠的一句话。
 *
 * 只输出字段路径与规则说明（都是 schema 层面的信息），不回显业务值；条数与长度都有界，
 * 避免一个大批量写入把整段错误灌进上下文。
 */
function describeSchemaIssues(error: ZodError): string {
  const issues = error.issues.slice(0, 6).map((issue) => {
    const path = issue.path.map(String).join('.') || '(根)'
    return `${path}: ${issue.message}`
  })
  const omitted = error.issues.length - issues.length
  return `${issues.join('；')}${omitted > 0 ? `；另有 ${omitted} 处` : ''}`.slice(0, 600)
}

function toFailure(error: unknown): ApplicationCapabilityResult {
  if (error instanceof CanvasPersistenceError && error.transactionFacts) return toFailure(new ApplicationTransactionFailure(error.transactionFacts))
  if (error instanceof ApplicationPreflightFailure) return { ok: false, error: { code: error.message.startsWith('CONFLICT:') ? 'CONFLICT' : 'INVALID_INPUT', message: error.message, recoverable: true, details: { execution: { notExecuted: true } } } }
  if (error instanceof ApplicationTransactionFailure) {
    const transaction = transactionFailureFacts(error.result)
    return { ok: false, error: { code: error.result.code === 'CONFLICT' ? 'CONFLICT' : 'CAPABILITY_REJECTED', message: error.message,
      recoverable: error.result.recoverable, ...(transaction ? { details: { transaction } } : {}) } }
  }
  if (error instanceof ApplicationPersistenceFailure) {
    return { ok: false, error: { code: 'CAPABILITY_REJECTED', message: error.message,
      recoverable: true, details: { persistence: error.facts } } }
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'PERMISSION_DENIED' || message.startsWith('PROPERTY_NOT_WRITABLE:')) {
    return { ok: false, error: {
      code: 'CAPABILITY_REJECTED',
      message: `${message}：当前连接无所需权限或属性不可写，请读取属性可用性并在应用中核对连接授权。`,
      recoverable: true,
    } }
  }
  if (error instanceof CanvasApplicationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        recoverable: error.recoverable,
        details: error.details,
      },
    }
  }
  if (error instanceof MultiLayerDocumentNodeApplicationError) {
    const code = error.code === 'INVALID_INPUT' || error.code === 'UNSUPPORTED_EXPORT_TARGET'
      ? 'INVALID_INPUT'
      : error.code === 'DOCUMENT_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'DOCUMENT_CONFLICT'
          ? 'CONFLICT'
          : error.code === 'CANCELLED'
            ? 'ABORTED'
            : error.code === 'MIGRATION_REQUIRED' || error.code === 'INVALID_NODE_STATE'
              ? 'CAPABILITY_NOT_READY'
              : 'CAPABILITY_REJECTED'
    return {
      ok: false,
      error: {
        code,
        message: error.message,
        recoverable: error.recoverable,
      },
    }
  }
  if (error instanceof GenerationPreparationError) {
    return {
      ok: false,
      error: {
        code: error.code === 'MODEL_NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_INPUT',
        message: error.message,
        recoverable: true,
        details: error.details,
      },
    }
  }
  if (error instanceof ZodError) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        // 只回"参数无效"等于让调用方猜。实测助手按 describe 的 requiredPropertyIds 逐字段
        // 填好了关键帧写入，仍被这一句挡下，它无从判断是 ref 格式、值类型还是多余字段错了，
        // 只能回头问用户——一次本可自纠的失败就此变成任务中断。
        message: `应用能力参数无效：${describeSchemaIssues(error)}`,
        recoverable: true,
      },
    }
  }
  if (message === 'ABORTED' || (error instanceof DOMException && error.name === 'AbortError')) {
    return { ok: false, error: { code: 'ABORTED', message: '操作已取消', recoverable: false } }
  }
  if (message === 'NOT_FOUND' || message.endsWith('_NOT_FOUND')) {
    return { ok: false, error: { code: 'NOT_FOUND', message: '请求的应用对象不存在', recoverable: true } }
  }
  if (message === 'INVALID_INPUT' || message === 'VERSION_MISMATCH') {
    return { ok: false, error: { code: 'INVALID_INPUT', message: '应用能力参数无效', recoverable: true } }
  }
  if (message === 'CONFLICT' || message.startsWith('CONFLICT:')) {
    const detail = message.slice('CONFLICT:'.length).trim()
    return {
      ok: false,
      error: {
        code: 'CONFLICT',
        message: detail || '应用状态已变化，请重新读取后再试',
        recoverable: true,
      },
    }
  }
  return {
    ok: false,
    error: { code: 'CAPABILITY_REJECTED', message: message || '应用能力执行失败', recoverable: false },
  }
}

export async function executeApplicationCapabilityResult(
  invocation: ApplicationCapabilityInvocation,
  context: CapabilityExecutionContext
): Promise<ApplicationCapabilityResult> {
  logger.info('capability.execute.start', {
    event: 'assistant.capability.execute.start',
    requestId: context.requestId,
    taskId: context.taskId,
    capabilityId: invocation.id,
  })
  try {
    const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(invocation.id)
    if (definition) {
      const parsed = definition.inputSchema.safeParse(invocation.input)
      if (!parsed.success) throw new ApplicationPreflightFailure(parsed.error)
    }
    const data = await registry.execute(invocation, context)
    const snapshot = createHostContextSnapshot()
    logger.info('capability.execute.completed', {
      event: 'assistant.capability.execute.completed',
      requestId: context.requestId,
      taskId: context.taskId,
      capabilityId: invocation.id,
      surface: snapshot.surface?.id,
    })
    return {
      ok: true,
      data,
      resultingRevision: snapshot.revision,
      resultingScopeRevisions: snapshot.scopeRevisions,
    }
  } catch (error) {
    /*
     * 预检失败是调用方可以自己改正的拒绝：参数写错、基线过期、乐观并发落败。
     * 外部智能体接进来之后这类拒绝就是正常流量，记成 error 会让用户的错误日志被别人的
     * 重试刷满，也会让任何覆盖并发契约的验收永远变红。**只降日志级别，返回给调用方的
     * 失败事实一个字都没变**，未预期的执行异常仍然是 error。
     */
    const level = error instanceof ApplicationPreflightFailure ? 'warn' : 'error'
    logger[level]('capability.execute.failed', error, {
      event: 'assistant.capability.execute.failed',
      requestId: context.requestId,
      taskId: context.taskId,
      capabilityId: invocation.id,
    })
    return toFailure(error)
  }
}

export function listRendererApplicationCapabilityIds(): string[] {
  return registry.listIds()
}
