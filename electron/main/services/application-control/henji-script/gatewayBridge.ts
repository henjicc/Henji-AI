import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import type { ApplicationRef } from '../../../../../src/core/application-control'
import type { HostContextSnapshot, HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import type { AgentObservedEffect } from '../../../../../src/core/assistant/observedEffect'
import { AgentToolGatewayError, type AgentToolGateway } from '../../agent-runtime/tools/gateway'
import type { AgentToolRegistry } from '../../agent-runtime/tools/registry'
import type { HenjiScriptApiLease } from '../../agent-runtime/context/script-api-lease'
import { HenjiScriptError, type HenjiAssertInstruction, type HenjiCallInstruction } from './types'
import { collectRefs, fullRef, isRecord, requiredScopes, revisions } from './runtime-values'
import type { ProgressEvidence } from '../../../../../src/core/assistant/progress'
import { businessResultFingerprint } from '../../agent-runtime/tools/progress-evidence'

function refKey(ref: ApplicationRef): string { return ref.kind + '\u0000' + ref.id }

export function scriptOperationKey(scriptRunRef: string, stepId: string, toolName: string): string {
  return `script-operation:${createHash('sha256').update(`${scriptRunRef}\0${stepId}\0${toolName}`).digest('hex')}`
}

export interface ScriptExecutionContext {
  operationId?: string
  runId: string
  threadId: string
  toolCallId: string
  signal: AbortSignal
  gateway: AgentToolGateway
  getHostContext: (runId: string) => HostContextSnapshot | null
  /** 只接受每一步正式能力输出确认的新 revision；不从 effect 或脚本文本推测。 */
  revisionCursor?: Partial<HostScopeRevisions>
  /** 导航型能力可能在返回后触发界面挂载；仅允许这些已声明作用域做一次正式重读收敛。 */
  pendingNavigationScopes?: Set<string>
  progressEvidence?: ProgressEvidence[]
}

export interface HenjiScriptServiceOptions {
  registry: AgentToolRegistry
  getLease: (runId: string) => HenjiScriptApiLease | null
}

/** 唯一 Gateway 调用、并发基线推进与正式读回；服务只持有脚本顺序及账本。 */
export class HenjiScriptGatewayBridge {
  protected async resolveCollectionParent(
    instruction: HenjiCallInstruction,
    args: unknown[],
    parents: ReadonlyMap<string, ApplicationRef>,
    scriptRunRef: string,
    context: ScriptExecutionContext,
  ): Promise<ApplicationRef | undefined> {
    if (instruction.api !== 'entities.create' && instruction.api !== 'entities.remove') return undefined
    let entityType: string
    if (instruction.api === 'entities.create') {
      const options = isRecord(args[1]) ? args[1] : {}
      if (options.parent) return fullRef(options.parent, instruction.location)
      entityType = String(args[0])
    } else {
      const ref = fullRef(args[0], instruction.location)
      const remembered = parents.get(`${ref.kind}\u0000${ref.id}`)
      if (remembered) return remembered
      entityType = ref.kind
    }
    const described = await this.gatewayCall('describe_application_entities', {
      domains: [], entityTypes: [entityType], refs: [],
    }, instruction, `${scriptRunRef}:resolve-parent`, context)
    const entities = isRecord(described.output) && Array.isArray(described.output.entities)
      ? described.output.entities : []
    const descriptor = entities.find((item) => isRecord(item) && item.id === entityType)
    const parentTypes = isRecord(descriptor) && Array.isArray(descriptor.parentTypes)
      ? descriptor.parentTypes.filter((item): item is string => typeof item === 'string') : []
    if (parentTypes.length !== 1) throw new HenjiScriptError(
      'SCRIPT_PLAN_REJECTED', 'execute',
      `${entityType} 有 ${parentTypes.length} 个可选父类型，必须显式提供完整 parent 引用`,
      instruction.location, instruction.stepId,
    )
    const listed = await this.gatewayCall('list_application_entities', {
      entityType: parentTypes[0], limit: 2,
    }, instruction, `${scriptRunRef}:resolve-parent`, context)
    const refs = isRecord(listed.output) && Array.isArray(listed.output.refs)
      ? listed.output.refs.flatMap((item) => {
        const parsed = new Map<string, ApplicationRef>()
        collectRefs(item, parsed)
        return [...parsed.values()].slice(0, 1)
      }) : []
    if (refs.length !== 1) throw new HenjiScriptError(
      'SCRIPT_PLAN_REJECTED', 'execute',
      `${entityType} 的父类型 ${parentTypes[0]} 当前有 ${refs.length} 个实例，必须显式选择 parent`,
      instruction.location, instruction.stepId,
    )
    return refs[0]
  }
  constructor(protected readonly options: HenjiScriptServiceOptions) {}
  protected absorbScopeRevisions(
    output: unknown,
    context: ScriptExecutionContext,
    allowedScopes?: ReadonlySet<string>,
  ): void {
    const record = isRecord(output) ? output : null
    const scopeRevisions = isRecord(record?.scopeRevisions) ? record.scopeRevisions : null
    if (!context.revisionCursor || !scopeRevisions) return
    for (const [scope, revision] of Object.entries(scopeRevisions)) {
      if (allowedScopes && !allowedScopes.has(scope)) continue
      if (typeof revision === 'number' && Number.isInteger(revision) && revision >= 0) {
        context.revisionCursor[scope] = revision
      }
    }
  }

  protected async settleNavigationRevisions(
    instruction: HenjiCallInstruction,
    scriptRunRef: string,
    context: ScriptExecutionContext,
  ): Promise<void> {
    const scopes = context.pendingNavigationScopes
    if (!scopes || scopes.size === 0) return
    const definition = this.options.registry.get('get_current_application_context')
    if (!definition || definition.readOnly !== true) {
      throw new HenjiScriptError(
        'SCRIPT_STEP_FAILED', 'execute',
        '导航后无法从正式宿主状态刷新 revision', instruction.location, instruction.stepId,
      )
    }
    const result = await context.gateway.execute({
      runId: context.runId, threadId: context.threadId,
      toolCallId: `script:${scriptRunRef}:${instruction.stepId}:revision-refresh`,
      toolName: definition.name, input: {}, expectedRevisions: {},
      approvalMode: 'full_access', explicitUserIntent: true,
      authorizationSource: 'approved_script', parentToolCallId: context.toolCallId,
      signal: context.signal,
    })
    if (result.status !== 'completed') {
      throw new HenjiScriptError(
        'SCRIPT_STEP_FAILED', 'execute',
        '导航后宿主 revision 刷新需要脚本外审批', instruction.location, instruction.stepId,
      )
    }
    this.absorbScopeRevisions(result.observation.output, context, scopes)
    scopes.clear()
  }

  protected async gatewayCall(
    toolName: string,
    input: unknown,
    instruction: HenjiCallInstruction,
    scriptRunRef: string,
    context: ScriptExecutionContext,
  ): Promise<{ output: unknown; effects: AgentObservedEffect[]; summary: string }> {
    const definition = this.options.registry.get(toolName)
    if (!definition) throw new HenjiScriptError('SCRIPT_API_NOT_DISCOVERED', 'execute', `能力 ${toolName} 已不可用`, instruction.location, instruction.stepId)
    if (!definition.readOnly) {
      await this.settleNavigationRevisions(instruction, scriptRunRef, context)
    }
    const required = requiredScopes(definition, input)
    const expectedRevisions = revisions(context.getHostContext(context.runId), required)
    for (const scope of required) {
      const revision = context.revisionCursor?.[scope]
      if (revision !== undefined) expectedRevisions[scope] = revision
    }
    const result = await context.gateway.execute({
      runId: context.runId, threadId: context.threadId,
      toolCallId: `script:${scriptRunRef}:${instruction.stepId}:${toolName}`,
      operationKey: definition.readOnly
        ? scriptOperationKey(`${scriptRunRef}:read:${businessResultFingerprint('read-context', {
          runId: context.runId, rendererSessionId: context.getHostContext(context.runId)?.rendererSessionId, expectedRevisions,
        })}`, instruction.stepId, toolName)
        : scriptOperationKey(scriptRunRef, instruction.stepId, toolName),
      toolName, input,
      expectedRevisions,
      approvalMode: 'full_access', explicitUserIntent: true,
      authorizationSource: 'approved_script', parentToolCallId: context.toolCallId,
      signal: context.signal,
    }).catch((error: unknown) => {
      if (!(error instanceof AgentToolGatewayError) || !error.transaction) throw error
      this.absorbScopeRevisions({ scopeRevisions: error.transaction.currentRevisions }, context)
      throw new HenjiScriptError('SCRIPT_STEP_FAILED', 'execute',
        `${error.message}。已发生的修改请先检查，不要重复执行原操作。`, instruction.location, instruction.stepId, error.transaction)
    })
    if (result.status !== 'completed') {
      throw new HenjiScriptError('SCRIPT_STEP_FAILED', 'execute', `${toolName} 需要脚本外审批`, instruction.location, instruction.stepId)
    }
    this.absorbScopeRevisions(result.observation.output, context)
    if (context.progressEvidence) {
      const evidence: ProgressEvidence = {
        kind: definition.readOnly ? 'observation' : 'mutation', subject: toolName,
        fingerprint: businessResultFingerprint(toolName, result.observation.output),
      }
      if (!context.progressEvidence.some((item) => item.subject === evidence.subject && item.fingerprint === evidence.fingerprint)) {
        if (context.progressEvidence.length < 128) context.progressEvidence.push(evidence)
        else {
          // 保持契约有界，但不能丢弃较长脚本最后发生的业务变化。
          const tail = context.progressEvidence[127]
          tail.fingerprint = businessResultFingerprint('script-progress-overflow', [tail, evidence])
          if (evidence.kind === 'mutation') tail.kind = 'mutation'
        }
      }
    }
    if (definition.capability?.control.impacts.some((impact) => impact.effect === 'navigate')) {
      context.pendingNavigationScopes ??= new Set<string>()
      for (const scope of required) context.pendingNavigationScopes.add(scope)
    }
    return {
      output: result.observation.output,
      effects: result.observation.effects ?? [],
      summary: result.observation.summary,
    }
  }

  protected assert(instruction: HenjiAssertInstruction, args: unknown[]): void {
    let passed = false
    if (instruction.assertion === 'equal') passed = isDeepStrictEqual(args[0], args[1])
    else if (instruction.assertion === 'exists') passed = args[0] !== null && args[0] !== undefined && (!Array.isArray(args[0]) || args[0].length > 0)
    else if (instruction.assertion === 'absent') passed = args[0] === null || args[0] === undefined || (Array.isArray(args[0]) && args[0].length === 0)
    else passed = typeof args[0] === 'string' && typeof args[1] === 'string' && args[0].includes(args[1])
    if (!passed) {
      /*
       * 断言失败必须报出**实际值**，否则调用方连"到底差在哪"都不知道。
       *
       * 旧文案只有「断言 equal 未通过」。运行时手里明明有 actual 和 expected 两个值——实测
       * 助手连撞两次 equal/matches，每次都只能整段重写脚本再猜一遍，而真实原因可能只是名称
       * 多了个空格。这跟"实体类型写错不列出可用类型"是同一个病。
       *
       * matches 走 includes 语义，也一并说清楚：模型常按正则理解它。
       */
      const shown = (value: unknown): string => {
        const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
        return text.length > 200 ? `${text.slice(0, 200)}…` : text
      }
      const detail = instruction.assertion === 'exists' || instruction.assertion === 'absent'
        ? `实际值：${shown(args[0])}`
        : `实际值：${shown(args[0])}；期望${instruction.assertion === 'matches' ? '包含' : ''}：${shown(args[1])}`
      throw new HenjiScriptError(
        'SCRIPT_VERIFICATION_FAILED', 'verify',
        `断言 ${instruction.assertion} 未通过。${detail}`
        + (instruction.assertion === 'matches' ? '（matches 是子串包含，不是正则匹配）' : ''),
        instruction.location, instruction.stepId
      )
    }
  }

  protected async verifyEntityCall(
    instruction: HenjiCallInstruction,
    args: unknown[],
    output: unknown,
    observedEffects: AgentObservedEffect[],
    scriptRunRef: string,
    context: ScriptExecutionContext,
    evidence: string[],
    effectLedger: AgentObservedEffect[],
    /** remove 成功并读回确认后登记；同段脚本内再读这个引用即视为已确认不存在。 */
    removedRefs?: Set<string>,
  ): Promise<void> {
    const assertReadTarget = (output: unknown, ref: ApplicationRef, startedAt: number): void => {
      const value = isRecord(output) ? output : {}
      const actual = isRecord(value.ref) ? value.ref : {}
      const revisions = isRecord(value.revisions) ? value.revisions : {}
      if (actual.kind !== ref.kind || actual.id !== ref.id
        || typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt)) || Date.parse(value.capturedAt) < startedAt
        || Object.entries(revisions).some(([scope, revision]) => typeof revision !== 'number'
          || revision < (context.revisionCursor?.[scope] ?? 0))) {
        throw new HenjiScriptError('SCRIPT_VERIFICATION_FAILED', 'verify', '正式回读没有确认原目标的当前版本', instruction.location, instruction.stepId)
      }
    }
    if (instruction.api === 'entities.update') {
      const ref = fullRef(args[0], instruction.location)
      const expected = isRecord(args[1]) ? args[1] : {}
      const startedAt = Date.now()
      const read = await this.gatewayCall('read_application_entity', {
        ref, propertyIds: Object.keys(expected),
      }, instruction, `${scriptRunRef}:verify`, context)
      effectLedger.push(...read.effects)
      const properties = isRecord(read.output) && isRecord(read.output.properties) ? read.output.properties : {}
      const mismatch = Object.entries(expected).find(([key, value]) => !isDeepStrictEqual(properties[key], value))
      if (mismatch) {
        throw new HenjiScriptError('SCRIPT_VERIFICATION_FAILED', 'verify', `属性 ${mismatch[0]} 未从正式状态源读回目标值`, instruction.location, instruction.stepId)
      }
      assertReadTarget(read.output, ref, startedAt)
      evidence.push(`${instruction.stepId}:read-back:${ref.kind}`)
      return
    }
    if (instruction.api === 'entities.create') {
      const created = new Map<string, ApplicationRef>()
      const options = isRecord(args[1]) ? args[1] : {}
      const expected = isRecord(options.properties) ? options.properties : {}
      for (const effect of observedEffects) {
        if (effect.effect !== 'create') continue
        for (const ref of effect.targetRefs) created.set(`${ref.kind}\u0000${ref.id}`, ref)
      }
      if (created.size === 0) collectRefs(output, created)
      if (created.size === 0) {
        throw new HenjiScriptError('SCRIPT_VERIFICATION_FAILED', 'verify', '创建结果没有完整稳定引用', instruction.location, instruction.stepId)
      }
      for (const ref of created.values()) {
        const expectedProperties = ref.kind === args[0] ? expected : {}
        const startedAt = Date.now()
        const read = await this.gatewayCall(
          'read_application_entity', { ref, propertyIds: Object.keys(expectedProperties) }, instruction,
          `${scriptRunRef}:verify:${ref.kind}:${ref.id}`, context,
        )
        effectLedger.push(...read.effects)
        const properties = isRecord(read.output) && isRecord(read.output.properties) ? read.output.properties : {}
        const mismatch = Object.entries(expectedProperties).find(([key, value]) => !isDeepStrictEqual(properties[key], value))
        if (mismatch) throw new HenjiScriptError('SCRIPT_VERIFICATION_FAILED', 'verify',
          `创建后的属性 ${mismatch[0]} 未从正式状态源读回目标值`, instruction.location, instruction.stepId)
        assertReadTarget(read.output, ref, startedAt)
      }
      evidence.push(`${instruction.stepId}:created-read-back:${created.size}`)
      return
    }
    if (instruction.api === 'entities.remove') {
      const ref = fullRef(args[0], instruction.location)
      try {
        await this.gatewayCall('read_application_entity', { ref, propertyIds: [] }, instruction, `${scriptRunRef}:verify`, context)
      } catch (error) {
        if (!(error instanceof AgentToolGatewayError) || error.code !== 'NOT_FOUND') throw error
        evidence.push(`${instruction.stepId}:absence-read-back:${ref.kind}`)
        removedRefs?.add(refKey(ref))
        return
      }
      throw new HenjiScriptError('SCRIPT_VERIFICATION_FAILED', 'verify', '删除后实体仍存在', instruction.location, instruction.stepId)
    }
  }
}
