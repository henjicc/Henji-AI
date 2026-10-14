import { APPLICATION_DOMAINS, initializeApplicationDomainBindings } from '../applicationDomains'
import { registerUiCapabilityExecutor } from '../uiCapabilityExecution'

import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'

import { applicationCapabilityInvocationSchema, isNavigationOnlyCapability, requiresMutationReview, type ApplicationCapabilityDefinition, type ApplicationCapabilityInvocation } from '@/core/application-control/applicationCapabilities'
import type { ApplicationCapabilityFailure, ApplicationCapabilityResult, HostErrorCode } from '@/core/application-control/hostContracts'

import { createLogger } from '@/core/logging'

import { ZodError } from 'zod'
import { describeInputIssues } from '@/core/application-control/inputValidation'
import { hostErrorCodeSchema } from '@/core/application-control/hostContracts'
import { ApplicationWriteFailure, applicationWriteChannel, assertApplicationWriteChannel } from '@/core/application-control/execution/writeExecution'
import { ApplicationTransactionFailure, ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { capabilityVerificationEnvelope } from '@/core/application-control/capabilityVerification'
import { transactionFailureFacts } from '@/core/application-control/applicationTransactionFailureFacts'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { applicationCallerAccess, assertApplicationCapabilityAllowed } from '@/core/application-control/callerContext'
import { getApplicationReflectionRegistry, getApplicationControlExecutionEngine } from './applicationControlRegistry'
import { beginCapabilityCapture } from './recordingCapture'

import { APPLICATION_REFLECTION_APPLICATION_CAPABILITIES } from '@/core/application-control/domains/shared/applicationReflectionApplicationCapabilities'

import { applicationReflectionHandlers } from './applicationReflectionAdapter'
import { createHostContextSnapshot } from '../hostContext/hostContext'

import type { ApplicationCapabilityHandlerRegistrar, CapabilityExecutionContext, CapabilityHandler } from './handlerTypes'

const logger = createLogger('features.application_control.capabilities')

class CapabilityOutputFailure extends Error {
  constructor(readonly validation: ZodError, readonly readOnly: boolean) {
    super(`APPLICATION_OUTPUT_CONTRACT:${readOnly ? '读取结果不符合声明，请缩小读取范围并核对目标。' : '操作已执行，但返回结果不符合声明。请用原 operationId 查询 get_application_operation，并用 read_application_entity 核对目标；禁止重新提交操作。'}${describeSchemaIssues(validation)}`)
  }
}

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
    const invoke: CapabilityHandler = async (input, context) => {
      const result = await handler(input, context)
      context.execution?.report({ targetMutation: 'applied' })
      const snapshot = createHostContextSnapshot()
      const enriched = { ...result, revision: snapshot.revision, scopeRevisions: snapshot.scopeRevisions }
      const enrichedOutput = definition.outputSchema.safeParse(enriched)
      const checked = enrichedOutput.success ? enrichedOutput : definition.outputSchema.safeParse(result)
      if (!checked.success) throw new CapabilityOutputFailure(checked.error, definition.readOnly)
      const output = checked.data as Record<string, unknown>
      return capabilityVerificationEnvelope(definition, input, output)
    }
    const executable = definition.readOnly ? invoke : applicationWriteChannel(invoke, requiresMutationReview(definition))
    if (!definition.readOnly) assertApplicationWriteChannel(id, executable)
    this.handlers.set(id, executable)
  }

  listIds(): string[] {
    return [...this.handlers.keys()]
  }

  assertWriteChannels(): void {
    for (const definition of this.definitions.values()) {
      if (definition.side !== 'frontend' || definition.readOnly) continue
      const handler = this.handlers.get(definition.id)
      if (!handler) throw new Error(`WRITE_EXECUTION_REQUIRED:${definition.id} 缺少处理器`)
      assertApplicationWriteChannel(definition.id, handler)
    }
  }

  async execute(
    invocationInput: unknown,
    context: CapabilityExecutionContext
  ): Promise<Record<string, unknown>> {
    let handlerStarted = false
    try {
    const invocation = applicationCapabilityInvocationSchema.parse(invocationInput)
    const definition = this.definitions.get(invocation.id)
    const handler = this.handlers.get(invocation.id)
    if (!definition || !handler) throw new Error('NOT_FOUND')
    if (!definition.readOnly) assertApplicationWriteChannel(invocation.id, handler)
    if (context.signal.aborted) throw new Error('ABORTED')
    if (context.callerGrant) assertApplicationCapabilityAllowed(context.callerGrant, definition)
    if (definition.version !== invocation.version) throw new Error('VERSION_MISMATCH')
    const input = definition.inputSchema.parse(invocation.input)
    if (context.callerGrant && definition.resolveOperationTargets && !definition.readOnly) {
      // 外部基线来自实体反射；语义操作也必须从相同目标读取，不能比较助手界面计数。
      // 通用事务由引擎在持锁后核对，保留其原有原子预检。
      try {
        const targets = definition.resolveOperationTargets(input)
        const writes = definition.resolveOperationWriteTargets?.(input, context.requestId ?? 'renderer')
        if (!targets?.length && !writes?.length) throw new Error('INVALID_INPUT:此操作缺少正式目标声明，无法核对读取基线。')
        const access = applicationCallerAccess(context.callerGrant, context.requestId ?? 'renderer', context.signal)
        const expected = invocation.expectedRevisions ?? {}
        const automatic = invocation.expectedRevisions === undefined && !definition.destructive
        const observed = new Set<string>()
        for (const ref of targets) {
          if (ref.kind === 'application.navigation' && isNavigationOnlyCapability(definition)) continue
          // 不可变任务引用不一定是反射实体。无 revision scope 的操作由领域处理器
          // 核对任务身份和实时状态；MCP 仍必须绑定该任务的原读取凭据及宿主会话。
          if (!getApplicationReflectionRegistry().getEntity(ref.kind) && definition.requiredScopes.length === 0) continue
          const snapshot = await getApplicationReflectionRegistry().readEntity(ref, [], access)
          for (const [scope, current] of Object.entries(snapshot.revisions)) {
            observed.add(scope)
            if (automatic) expected[scope] = current
            else if (expected[scope] !== current) {
              throw new Error(`CONFLICT:${ref.kind} 的 ${scope} 数据已变化或缺少基线，请调用 read_application_entity({ref:${JSON.stringify(ref)},propertyIds:[]}) 取得 baselineId，再使用该 baselineIds 提交。`)
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
        if (before.scopeRevisions[scope] !== expected) throw new Error(`CONFLICT:请调用 read_application_entity 读取原目标 ${JSON.stringify(definition.resolveOperationTargets?.(input) ?? [])}（propertyIds=[]）取得新 baselineId 后提交。`)
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
    handlerStarted = true
    const captured = await beginCapabilityCapture(definition, input)
    try {
    const result = await handler(input, {
      ...context,
      getExecutionEngine: getApplicationControlExecutionEngine,
      commitProperties: (target, properties, revisions, summary) => applicationReflectionHandlers.changeEntities({ summary, changes: [{ kind: 'set_properties', target, entityType: target.kind, properties }] }, { ...context, expectedRevisions: revisions }),
      expectedRevisions: invocation.expectedRevisions,
    })
    await captured('completed')
    return result
    } catch (error) { await captured(context.signal.aborted ? 'cancelled' : 'failed'); throw error }
    } catch (error) {
      if (!handlerStarted) throw new ApplicationPreflightFailure(error)
      throw error
    }
  }
}

const registry = new RendererApplicationCapabilityRegistry()

function registerBuiltins(): void {
  // 通用反射能力：领域注册了实体和属性，助手就能读改增删，不必再为每个动作写专用能力
  for (const capability of APPLICATION_REFLECTION_APPLICATION_CAPABILITIES) {
    registry.registerHandler(capability.id, async (input, context) => {
      const parsed = capability.inputSchema.parse(input) as never
      if (capability.id === 'describe_application_entities') return await applicationReflectionHandlers.describeEntities(parsed, context)
      if (capability.id === 'list_application_entities') return await applicationReflectionHandlers.listEntities(parsed, context)
      if (capability.id === 'read_application_entity') return await applicationReflectionHandlers.readEntity(parsed, context)
      if (capability.id === 'undo_application_changes') return await applicationReflectionHandlers.undoEntities(parsed, context)
      return await applicationReflectionHandlers.changeEntities(parsed, context)
    })
  }
}

initializeApplicationDomainBindings()
registerBuiltins()
for (const domain of APPLICATION_DOMAINS) domain.registerCapabilities(registry)

const frontendCapabilityCount = BUILTIN_APPLICATION_CAPABILITY_REGISTRY
  .list()
  .filter((definition) => definition.side === 'frontend')
  .length
if (registry.listIds().length !== frontendCapabilityCount) {
  throw new Error('应用能力注册不完整')
}
for (const domain of APPLICATION_DOMAINS) domain.validate?.()

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

/**
 * 调用方读一次目标、改一次参数就能自己走通的拒绝码。其余失败一律按未预期执行异常处理。
 */
const CALLER_CORRECTABLE_ERROR_CODES = new Set<HostErrorCode>([
  'CONFLICT', 'INVALID_INPUT', 'NOT_FOUND', 'PROJECT_NOT_FOUND',
])

function toFailure(error: unknown): ApplicationCapabilityFailure {
  const failure = projectFailure(error)
  const match = /^([A-Z][A-Z_]*)(?::|：)\s*/.exec(failure.error.message)
  const code = hostErrorCodeSchema.safeParse(match?.[1])
  // 只剥离与正式错误码重复的前缀；领域子码（ENTITY_NOT_FOUND、PROPERTY_NOT_WRITABLE 等）是调用方自纠的依据，保留在消息里。
  if (match && code.success) return { ok: false, error: { ...failure.error, code: code.data,
    message: failure.error.message.slice(match[0].length),
    recoverable: CALLER_CORRECTABLE_ERROR_CODES.has(code.data) || failure.error.recoverable } }
  return failure
}

function projectFailure(error: unknown): ApplicationCapabilityFailure {
  if (error instanceof CapabilityOutputFailure) return { ok: false, error: {
    code: 'CAPABILITY_REJECTED', message: error.message, recoverable: false,
    details: { outputContract: true, execution: { notExecuted: error.readOnly, targetMutation: error.readOnly ? 'none' : 'applied' }, replayMutation: false },
  } }

  if (error instanceof ApplicationWriteFailure) {
    const original = toFailure(error.original)
    const domainExecution = original.error.details?.execution as { notExecuted?: boolean; rolledBack?: boolean } | undefined
    const execution = { ...error.execution,
      ...(domainExecution?.notExecuted && error.execution.billing === 'not_charged' && error.execution.targetMutation === 'none' && !error.effects.length ? { notExecuted: true } : {}),
      ...(domainExecution?.rolledBack ? { rolledBack: true } : {}),
    }
    const audioDocumentRef = error.execution.audioDocumentId ? { kind: 'audio_edit.document', id: error.execution.audioDocumentId } : undefined
    return { ok: false, error: { ...original.error, details: { ...original.error.details, execution,
      ...(error.effects.length ? { effects: error.effects } : {}), ...(audioDocumentRef ? { recovery: { audioDocumentRef, replayRecognition: false,
        message: '复用 audioDocumentRef 继续原识别或字幕任务；已完成识别不重复计费。' } } : {}) } } }
  }
  for (const domain of APPLICATION_DOMAINS) {
    const failure = domain.failure?.(error, toFailure)
    if (failure) return failure
  }
  if (error instanceof ApplicationPreflightFailure) {
    if (error.cause instanceof ApplicationPreflightFailure) return toFailure(error.cause)
    if (error.cause instanceof ZodError) return { ok: false, error: { ...toFailure(error.cause).error, details: { execution: { notExecuted: true } } } }
    if (error.cause instanceof Error && ['DocumentNotFoundError', 'ProjectNotFoundError', 'PersistenceError', 'DocumentFormatError', 'DocumentUnsupportedError', 'DocumentNotOpenableError'].includes(error.cause.name)) {
      const original = toFailure(error.cause)
      return { ok: false, error: { ...original.error,
        details: { ...original.error.details, execution: { notExecuted: true } } } }
    }
    const conflict = /^(?:CONFLICT|REVISION_CONFLICT|PLAN_REVISION_CONFLICT)(?::|$)/.test(error.message)
    const providerCode = (['PROVIDER_PRODUCT_NOT_ACTIVATED', 'PROVIDER_MODEL_ACCESS_DENIED', 'PROVIDER_INSUFFICIENT_BALANCE'] as const)
      .find(code => error.message.startsWith(`${code}:`))
    return { ok: false, error: { code: providerCode ?? (conflict ? 'CONFLICT' : 'INVALID_INPUT'),
      message: conflict ? `目标状态已变化，请重新读取原目标取得版本后再试。${error.message}` : error.message,
      recoverable: true, details: { execution: { notExecuted: true } } } }
  }
  if (error instanceof ApplicationTransactionFailure) {
    const transaction = transactionFailureFacts(error.result)
    return { ok: false, error: { code: error.result.code === 'CONFLICT' ? 'CONFLICT' : 'CAPABILITY_REJECTED', message: error.message,
      recoverable: error.result.recoverable, ...(transaction ? { details: { transaction,
        ...(error.result.partial?.completedStepIndexes.length === 0 && !error.result.persistence && !error.result.effects?.length ? { execution: { notExecuted: true } } : {}),
      } } : {}) } }
  }
  if (error instanceof ApplicationPersistenceFailure) {
    return { ok: false, error: { code: 'CAPABILITY_REJECTED', message: error.message,
      recoverable: true, details: { persistence: error.facts } } }
  }
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof Error && ['DocumentNotFoundError', 'ProjectNotFoundError'].includes(error.name)) {
    return { ok: false, error: { code: 'NOT_FOUND', message: `${message} 请检查文件所在磁盘，或用 list_documents / list_projects 重新获取现有目标。`, recoverable: true } }
  }
  if (error instanceof Error && ['PersistenceError', 'DocumentFormatError', 'DocumentUnsupportedError'].includes(error.name)) {
    return { ok: false, error: { code: 'CAPABILITY_REJECTED',
      message: `${message} 请改用当前版本支持的文档；文件损坏时从备份恢复后重试，旧格式请用支持它的版本打开并导出素材。`, recoverable: true } }
  }
  if (message === 'PERMISSION_DENIED' || message.startsWith('PROPERTY_NOT_WRITABLE:')) {
    return { ok: false, error: {
      code: 'CAPABILITY_REJECTED',
      message: `${message}：当前连接无所需权限或属性不可写，请读取属性可用性并在应用中核对连接授权。`,
      recoverable: true,
    } }
  }
  if (error instanceof ZodError) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        // 只回"参数无效"等于让调用方猜。实测助手按 describe 的 requiredPropertyIds 逐字段
        // 填好了关键帧写入，仍被这一句挡下，它无从判断是 ref 格式、值类型还是多余字段错了，
        // 只能回头问用户——一次本可自纠的失败就此变成任务中断。
        message: describeInputIssues(error),
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
  /*
   * 注册表读取层已经把 provider 光秃秃的 NOT_FOUND 包成一句自带修正指引的话，带上原样回显的
   * ref 和取稳定 id 的入口。它形如 `ENTITY_NOT_FOUND:<实体>:<id>（…）`，既不等于 NOT_FOUND
   * 也不以 _NOT_FOUND 收尾，以前一路掉进兜底分支，被报成不可恢复的执行失败——调用方收到的
   * 是"能力执行失败"而不是"这个引用不存在、去 list 取原值"。这里按原样保留那句指引。
   */
  if (/^[A-Z][A-Z_]*NOT_FOUND:/.test(message)) {
    return { ok: false, error: { code: 'NOT_FOUND', message, recoverable: true } }
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
    event: 'application.capability.execute.start',
    requestId: context.requestId,
    taskId: context.taskId,
    capabilityId: invocation.id,
  })
  try {
    const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(invocation.id)
    if (definition) {
      const parsed = definition.inputSchema.safeParse(invocation.input)
      if (!parsed.success) throw new ApplicationPreflightFailure(new Error(`INVALID_INPUT:${describeInputIssues(parsed.error, definition.inputSchema, invocation.input)}`))
    }
    const data = await registry.execute(invocation, context)
    const snapshot = createHostContextSnapshot()
    logger.info('capability.execute.completed', {
      event: 'application.capability.execute.completed',
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
     * 调用方可以自己改正的拒绝：参数写错、引用不存在、基线过期、乐观并发落败。外部智能体
     * 接进来之后这类拒绝就是正常流量，记成 error 会让用户的错误日志被别人的重试刷满，也会
     * 让任何覆盖并发或引用契约的验收永远变红。**只降日志级别，返回给调用方的失败事实一个
     * 字都没变**，未预期的执行异常仍然是 error。
     *
     * 级别直接由分类后的失败码决定，不再另立一套 error instanceof 判断：同一次拒绝，调用方
     * 看到的结论和日志里的严重程度必须是同一个判断，否则两边迟早各走各的。
     */
    const failure = toFailure(error)
    const level = CALLER_CORRECTABLE_ERROR_CODES.has(failure.error.code) ? 'warn' : 'error'
    logger[level]('capability.execute.failed', error, {
      event: 'application.capability.execute.failed',
      requestId: context.requestId,
      taskId: context.taskId,
      capabilityId: invocation.id,
    })
    return failure
  }
}

export function listRendererApplicationCapabilityIds(): string[] {
  return registry.listIds()
}

export function assertRendererApplicationWriteChannels(): void {
  registry.assertWriteChannels()
}

registerUiCapabilityExecutor(executeApplicationCapabilityResult)
