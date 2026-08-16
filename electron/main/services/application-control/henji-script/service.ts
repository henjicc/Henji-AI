import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import type { ApplicationRef } from '../../../../../src/core/application-control'
import type {
  RunHenjiScriptInput,
  RunHenjiScriptOutput,
} from '../../../../../src/core/assistant/capabilities/henjiScriptApplicationCapabilities'
import type {
  HostContextSnapshot,
  HostScopeRevisions,
} from '../../../../../src/core/assistant/hostContracts'
import type { AgentObservedEffect } from '../../../../../src/core/assistant/taskGraph'
import {
  henjiScriptCheckpointSchema,
  type HenjiScriptCheckpoint,
} from '../../../../../src/core/assistant/externalWait'
import type { AgentToolGateway } from '../../agent-runtime/tools/gateway'
import type { AgentToolRegistry } from '../../agent-runtime/tools/registry'
import type { AgentToolDefinition } from '../../agent-runtime/tools/types'
import type { HenjiScriptApiLease } from '../../agent-runtime/context/script-api-lease'
import {
  HenjiScriptError,
  type HenjiAssertInstruction,
  type HenjiCallInstruction,
  type HenjiInstruction,
} from './types'
import {
  checkpointDigest,
  collectRefs,
  evaluate,
  fullRef,
  isRecord,
  requiredScopes,
  revisions,
  serializable,
} from './runtime-values'
import { HenjiScriptPreflight } from './preflight'

const ENTITY_TOOL = {
  'entities.list': 'list_application_entities',
  'entities.read': 'read_application_entity',
  'entities.create': 'change_application_entities',
  'entities.update': 'change_application_entities',
  'entities.remove': 'change_application_entities',
} as const

interface ScriptExecutionContext {
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
}

interface ScriptRuntimeState {
  values: Map<string, unknown>
  parents: Map<string, ApplicationRef>
  refs: Map<string, ApplicationRef>
  effects: AgentObservedEffect[]
  receipts: RunHenjiScriptOutput['steps']
  verificationEvidence: string[]
  submittedTasks: RunHenjiScriptOutput['submittedTasks']
}

export interface HenjiScriptServiceOptions {
  registry: AgentToolRegistry
  getLease: (runId: string) => HenjiScriptApiLease | null
}

export class HenjiScriptService {
  private readonly preflight: HenjiScriptPreflight

  constructor(private readonly options: HenjiScriptServiceOptions) {
    this.preflight = new HenjiScriptPreflight(options.registry)
  }

  compile(input: RunHenjiScriptInput) {
    return this.preflight.compile(input)
  }

  private absorbScopeRevisions(
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

  private async settleNavigationRevisions(
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

  preview(input: RunHenjiScriptInput): { title: string; summary: string; targetIds: Record<string, string>; reversible: boolean; dataClasses: ['C1'] } {
    let operationUpperBound: number | null = null
    try {
      operationUpperBound = this.compile(input).operationUpperBound
    } catch (error) {
      if (!(error instanceof HenjiScriptError)) throw error
    }
    return {
      title: '运行 Henji Script',
      summary: operationUpperBound === null
        ? `${input.summary}；脚本将在执行前受控解析，语法错误以结构化结果返回且不会产生写入。`
        : `${input.summary}；受控语义计划上限 ${operationUpperBound} 个操作。`,
      targetIds: { script: 'henji-ts/v1' }, reversible: false, dataClasses: ['C1'],
    }
  }

  private async gatewayCall(
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
      toolName, input,
      expectedRevisions,
      approvalMode: 'full_access', explicitUserIntent: true,
      authorizationSource: 'approved_script', parentToolCallId: context.toolCallId,
      signal: context.signal,
    })
    if (result.status !== 'completed') {
      throw new HenjiScriptError('SCRIPT_STEP_FAILED', 'execute', `${toolName} 需要脚本外审批`, instruction.location, instruction.stepId)
    }
    this.absorbScopeRevisions(result.observation.output, context)
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

  private callInput(
    instruction: HenjiCallInstruction,
    args: unknown[],
    parents: ReadonlyMap<string, ApplicationRef>,
    inferredCollectionParent?: ApplicationRef,
  ): { toolName: string; input: unknown } {
    if (instruction.api === 'action') return { toolName: String(args[0]), input: args[1] ?? {} }
    if (instruction.api === 'recipe') throw new HenjiScriptError(
      'SCRIPT_PLAN_REJECTED', 'execute', '配方必须在执行前展开为 Henji Script IR',
      instruction.location, instruction.stepId,
    )
    if (instruction.api === 'entities.list') {
      return { toolName: ENTITY_TOOL[instruction.api], input: { entityType: String(args[0]), ...(isRecord(args[1]) ? args[1] : {}) } }
    }
    if (instruction.api === 'entities.read') {
      return { toolName: ENTITY_TOOL[instruction.api], input: { ref: fullRef(args[0], instruction.location), propertyIds: Array.isArray(args[1]) ? args[1] : [] } }
    }
    if (instruction.api === 'entities.create') {
      const options = isRecord(args[1]) ? args[1] : {}
      const parent = options.parent
        ? fullRef(options.parent, instruction.location)
        : inferredCollectionParent
      if (!parent) throw new HenjiScriptError(
        'SCRIPT_PLAN_REJECTED', 'execute', '创建实体缺少父引用，且宿主无法唯一推导父容器',
        instruction.location, instruction.stepId,
      )
      return {
        toolName: ENTITY_TOOL[instruction.api],
        input: {
          summary: `Henji Script 创建 ${String(args[0])}`,
          changes: [{
            kind: 'create_items', entityType: String(args[0]),
            parent,
            items: [{ properties: isRecord(options.properties) ? options.properties : {} }],
          }],
        },
      }
    }
    if (instruction.api === 'entities.update') {
      const ref = fullRef(args[0], instruction.location)
      return {
        toolName: ENTITY_TOOL[instruction.api],
        input: {
          summary: `Henji Script 更新 ${ref.kind}`,
          changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: isRecord(args[1]) ? args[1] : {} }],
        },
      }
    }
    const ref = fullRef(args[0], instruction.location)
    const parent = parents.get(`${ref.kind}\u0000${ref.id}`) ?? inferredCollectionParent
    if (!parent) {
      throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'execute', '无法唯一解析 remove 的父上下文', instruction.location, instruction.stepId)
    }
    return {
      toolName: ENTITY_TOOL[instruction.api],
      input: {
        summary: `Henji Script 删除 ${ref.kind}`,
        changes: [{ kind: 'remove_items', entityType: ref.kind, parent, targets: [ref] }],
      },
    }
  }

  private async resolveCollectionParent(
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

  private prepare(raw: RunHenjiScriptInput, lease: HenjiScriptApiLease): {
    instructions: HenjiInstruction[]
    planDigest: string
  } {
    return this.preflight.prepare(raw, lease)
  }

  private createCheckpoint(
    state: ScriptRuntimeState,
    scriptRunRef: string,
    planDigest: string,
    remainingInstructions: HenjiInstruction[],
  ): HenjiScriptCheckpoint {
    const base = {
      version: 'henji-script-checkpoint/v1' as const,
      scriptRunRef, planDigest, nextInstruction: state.receipts.length,
      remainingInstructions,
      variables: [...state.values].map(([name, value]) => ({ name, value: serializable(value) })),
      parents: [...state.parents.values()].map((parent, index) => ({
        ref: [...state.parents.keys()].map((key) => {
          const split = key.indexOf('\u0000')
          return { kind: key.slice(0, split), id: key.slice(split + 1) }
        })[index],
        parent,
      })),
      resultRefs: [...state.refs.values()].slice(0, 128),
      effects: state.effects.slice(0, 512), steps: state.receipts.slice(0, 128),
      verificationState: { evidence: state.verificationEvidence.slice(0, 128) },
    }
    const checkpoint = henjiScriptCheckpointSchema.parse({
      ...base,
      continuationDigest: checkpointDigest(base as unknown as Omit<HenjiScriptCheckpoint, 'continuationDigest'>),
    })
    if (Buffer.byteLength(JSON.stringify(checkpoint), 'utf8') > 512 * 1024) {
      throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'execute', '脚本断点超过 512KB，无法安全续跑')
    }
    return checkpoint
  }

  private stateFromCheckpoint(checkpoint: HenjiScriptCheckpoint): ScriptRuntimeState {
    return {
      values: new Map(checkpoint.variables.map((item) => [item.name, item.value])),
      parents: new Map(checkpoint.parents.map(({ ref, parent }) => [`${ref.kind}\u0000${ref.id}`, parent])),
      refs: new Map(checkpoint.resultRefs.map((ref) => [`${ref.kind}\u0000${ref.id}`, ref])),
      effects: [...checkpoint.effects], receipts: [...checkpoint.steps],
      verificationEvidence: [...checkpoint.verificationState.evidence], submittedTasks: [],
    }
  }

  private async runPrepared(
    instructions: HenjiInstruction[],
    state: ScriptRuntimeState,
    scriptRunRef: string,
    planDigest: string,
    context: ScriptExecutionContext,
    lease: HenjiScriptApiLease | null,
  ): Promise<{ failure: HenjiScriptError | null; checkpoint: HenjiScriptCheckpoint | null }> {
    const queue = [...instructions]
    try {
      while (queue.length > 0) {
        const instruction = queue.shift() as HenjiInstruction
        if (context.signal.aborted) throw new HenjiScriptError('SCRIPT_STEP_FAILED', 'execute', '脚本已取消', instruction.location, instruction.stepId)
        if (instruction.kind === 'branch') {
          const branch = Boolean(evaluate(instruction.condition, state.values)) ? instruction.whenTrue : instruction.whenFalse
          queue.unshift(...branch)
          continue
        }
        if (instruction.kind === 'alias') {
          const sourceResult = state.values.get(instruction.sourceStepId)
          const stepRefs = new Map<string, ApplicationRef>()
          collectRefs(sourceResult, stepRefs)
          for (const receipt of state.receipts) {
            if (!receipt.stepId.startsWith(`${instruction.stepId}__`)) continue
            for (const ref of receipt.resultRefs) stepRefs.set(`${ref.kind}\u0000${ref.id}`, ref)
          }
          const resultRefs = [...stepRefs.values()].slice(0, 64)
          const recipeResult = isRecord(sourceResult)
            ? { ...sourceResult, resultRefs }
            : { value: sourceResult ?? null, resultRefs }
          state.values.set(instruction.stepId, recipeResult)
          state.receipts.push({
            stepId: instruction.stepId, api: 'recipe', status: 'completed', location: instruction.location,
            resultRefs, effectCount: 0,
            summary: `Henji Recipe ${instruction.recipeId} 已由同一解释器完成。`,
          })
          continue
        }
        if (instruction.kind === 'assert') {
          const args = instruction.args.map((arg) => evaluate(arg, state.values))
          this.assert(instruction, args)
          state.verificationEvidence.push(`${instruction.stepId}:${instruction.assertion}`)
          state.receipts.push({
            stepId: instruction.stepId, api: `assert.${instruction.assertion}`, status: 'completed',
            location: instruction.location, resultRefs: [], effectCount: 0, summary: '结构化断言通过。',
          })
          continue
        }
        const args = instruction.args.map((arg) => evaluate(arg, state.values))
        if (lease) this.preflight.assertRuntimeLease(instruction, args, lease)
        const inferredCollectionParent = await this.resolveCollectionParent(
          instruction, args, state.parents, scriptRunRef, context,
        )
        const { toolName, input } = this.callInput(
          instruction, args, state.parents, inferredCollectionParent,
        )
        const beforeEffects = state.effects.length
        const result = await this.gatewayCall(toolName, input, instruction, scriptRunRef, context)
        const calledDefinition = this.options.registry.get(toolName)
        const verificationContract = calledDefinition?.capability?.verificationContract
        if (verificationContract?.kind === 'effect_receipt') {
          const worldEffects = result.effects.filter((effect) => (
            !['observe', 'navigate'].includes(effect.effect)
          ))
          if (verificationContract.requireEffects && worldEffects.length === 0) {
            throw new HenjiScriptError(
              'SCRIPT_VERIFICATION_FAILED', 'verify',
              `${toolName} 未返回验证契约要求的 Effect Receipt`,
              instruction.location, instruction.stepId,
            )
          }
          if (verificationContract.requireVerifiedEffects
            && !worldEffects.some((effect) => effect.verified)) {
            throw new HenjiScriptError(
              'SCRIPT_VERIFICATION_FAILED', 'verify',
              `${toolName} 的 Effect Receipt 尚未通过正式状态验证`,
              instruction.location, instruction.stepId,
            )
          }
        }
        result.effects.forEach((effect) => state.effects.push(effect))
        const stepRefs = new Map<string, ApplicationRef>()
        collectRefs(result.output, stepRefs)
        for (const effect of result.effects) {
          for (const ref of effect.targetRefs) {
            if (ref.kind === 'application.surface') continue
            stepRefs.set(`${ref.kind}\u0000${ref.id}`, ref)
          }
        }
        const resultRefs = [...stepRefs.values()].slice(0, 64)
        const stepResult = isRecord(result.output)
          ? { ...result.output, resultRefs }
          : { value: result.output ?? null, resultRefs }
        state.values.set(instruction.stepId, stepResult)
        stepRefs.forEach((ref, key) => state.refs.set(key, ref))
        if (instruction.api === 'entities.create') {
          const options = isRecord(args[1]) ? args[1] : {}
          const parent = options.parent
            ? fullRef(options.parent, instruction.location)
            : inferredCollectionParent
          if (!parent) throw new HenjiScriptError(
            'SCRIPT_PLAN_REJECTED', 'execute', '创建结果缺少父上下文',
            instruction.location, instruction.stepId,
          )
          stepRefs.forEach((ref) => state.parents.set(`${ref.kind}\u0000${ref.id}`, parent))
        }
        const record = isRecord(result.output) ? result.output : {}
        if (toolName === 'create_visible_generation_task'
          && typeof record.taskId === 'string' && record.status === 'submitted') {
          state.submittedTasks.push({
            toolName: 'create_visible_generation_task', taskId: record.taskId, status: 'submitted',
          })
        }
        const tasks = Array.isArray(record.submittedTasks) ? record.submittedTasks : []
        for (const task of tasks) {
          if (isRecord(task) && task.toolName === 'create_visible_generation_task'
            && typeof task.taskId === 'string' && task.status === 'submitted') {
            state.submittedTasks.push({ toolName: task.toolName, taskId: task.taskId, status: task.status })
          }
        }
        if (result.effects.some((effect) => effect.verified)) {
          state.verificationEvidence.push(`${instruction.stepId}:${toolName}:verified-effect`)
        } else if (instruction.api.startsWith('entities.') && instruction.api !== 'entities.list') {
          await this.verifyEntityCall(
            instruction, args, result.output, result.effects, scriptRunRef, context,
            state.verificationEvidence, state.effects,
          )
        } else if (this.options.registry.get(toolName)?.readOnly === true) {
          state.verificationEvidence.push(`${instruction.stepId}:${toolName}:formal-read`)
        }
        state.receipts.push({
          stepId: instruction.stepId, api: instruction.api,
          status: state.submittedTasks.length > 0 ? 'waiting_external' : 'completed',
          location: instruction.location, resultRefs,
          effectCount: state.effects.length - beforeEffects, summary: result.summary,
        })
        if (state.submittedTasks.length > 0) {
          return { failure: null, checkpoint: this.createCheckpoint(state, scriptRunRef, planDigest, queue) }
        }
      }
      return { failure: null, checkpoint: null }
    } catch (error) {
      return {
        failure: error instanceof HenjiScriptError
          ? error
          : new HenjiScriptError('SCRIPT_STEP_FAILED', 'execute', error instanceof Error ? error.message : String(error)),
        checkpoint: null,
      }
    }
  }

  private output(
    state: ScriptRuntimeState,
    scriptRunRef: string,
    context: ScriptExecutionContext,
    failure: HenjiScriptError | null,
    checkpoint: HenjiScriptCheckpoint | null,
  ): RunHenjiScriptOutput {
    const latest = context.getHostContext(context.runId)
    const status = checkpoint && !failure
      ? 'waiting_external' as const
      : failure
        ? state.effects.length > 0 ? 'partial' as const : 'failed' as const
        : 'completed' as const
    return {
      ok: status === 'completed' || status === 'waiting_external', status, scriptRunRef,
      steps: state.receipts, resultRefs: [...state.refs.values()].slice(0, 128),
      effects: state.effects.slice(0, 512),
      verification: {
        passed: status === 'completed',
        summary: status === 'completed'
          ? `Henji Script 已执行并通过 ${state.verificationEvidence.length} 项正式验证。`
          : status === 'waiting_external' ? '脚本已安全暂停，等待权威外部结果。' : '脚本未通过完整验证。',
        evidence: state.verificationEvidence.slice(0, 24),
      },
      error: failure ? {
        code: failure.code, phase: failure.phase,
        message: failure.message.replace(/^\[INVALID_INPUT\]\s*/, '').slice(0, 1_000),
        location: failure.location, stepId: failure.stepId,
      } : null,
      submittedTasks: state.submittedTasks, checkpoint,
      revision: latest?.revision ?? 0, scopeRevisions: latest?.scopeRevisions ?? {},
    }
  }

  async execute(raw: RunHenjiScriptInput, context: ScriptExecutionContext): Promise<RunHenjiScriptOutput> {
    const scriptRunRef = `henji-script:${randomUUID()}`
    const state: ScriptRuntimeState = {
      values: new Map(), parents: new Map(), refs: new Map(), effects: [], receipts: [],
      verificationEvidence: [], submittedTasks: [],
    }
    try {
      const executionContext: ScriptExecutionContext = {
        ...context,
        revisionCursor: { ...(context.getHostContext(context.runId)?.scopeRevisions ?? {}) },
        pendingNavigationScopes: new Set<string>(),
      }
      const lease = this.options.getLease(context.runId)
      if (!lease) {
        throw new HenjiScriptError('SCRIPT_API_NOT_DISCOVERED', 'preflight', '本次运行尚未通过能力发现取得 scriptApi 租约')
      }
      const prepared = this.prepare(raw, lease)
      const result = await this.runPrepared(prepared.instructions, state, scriptRunRef, prepared.planDigest, executionContext, lease)
      return this.output(state, scriptRunRef, executionContext, result.failure, result.checkpoint)
    } catch (error) {
      const failure = error instanceof HenjiScriptError
        ? error
        : new HenjiScriptError('SCRIPT_STEP_FAILED', 'execute', error instanceof Error ? error.message : String(error))
      return this.output(state, scriptRunRef, context, failure, null)
    }
  }

  async resume(
    rawCheckpoint: HenjiScriptCheckpoint,
    observedStatus: 'success' | 'error' | 'cancelled' | 'timeout',
    context: ScriptExecutionContext,
  ): Promise<RunHenjiScriptOutput> {
    const executionContext: ScriptExecutionContext = {
      ...context,
      revisionCursor: { ...(context.getHostContext(context.runId)?.scopeRevisions ?? {}) },
      pendingNavigationScopes: new Set<string>(),
    }
    const checkpoint = henjiScriptCheckpointSchema.parse(rawCheckpoint)
    const { continuationDigest, ...base } = checkpoint
    if (checkpointDigest(base) !== continuationDigest) {
      throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'preflight', '脚本断点摘要不匹配，拒绝续跑')
    }
    const state = this.stateFromCheckpoint(checkpoint)
    const inheritedEffectCount = state.effects.length
    if (observedStatus !== 'success') {
      const failure = new HenjiScriptError(
        'SCRIPT_STEP_FAILED', 'execute', `外部生成以 ${observedStatus} 结束，后续写入未执行`, null,
      )
      return {
        ...this.output(state, checkpoint.scriptRunRef, executionContext, failure, null),
        effects: state.effects.slice(inheritedEffectCount),
      }
    }
    const result = await this.runPrepared(
      checkpoint.remainingInstructions as unknown as HenjiInstruction[], state,
      checkpoint.scriptRunRef, checkpoint.planDigest, executionContext, null,
    )
    return {
      ...this.output(state, checkpoint.scriptRunRef, executionContext, result.failure, result.checkpoint),
      effects: state.effects.slice(inheritedEffectCount),
    }
  }

  private assert(instruction: HenjiAssertInstruction, args: unknown[]): void {
    let passed = false
    if (instruction.assertion === 'equal') passed = isDeepStrictEqual(args[0], args[1])
    else if (instruction.assertion === 'exists') passed = args[0] !== null && args[0] !== undefined && (!Array.isArray(args[0]) || args[0].length > 0)
    else if (instruction.assertion === 'absent') passed = args[0] === null || args[0] === undefined || (Array.isArray(args[0]) && args[0].length === 0)
    else passed = typeof args[0] === 'string' && typeof args[1] === 'string' && args[0].includes(args[1])
    if (!passed) {
      throw new HenjiScriptError('SCRIPT_VERIFICATION_FAILED', 'verify', `断言 ${instruction.assertion} 未通过`, instruction.location, instruction.stepId)
    }
  }

  private async verifyEntityCall(
    instruction: HenjiCallInstruction,
    args: unknown[],
    output: unknown,
    observedEffects: AgentObservedEffect[],
    scriptRunRef: string,
    context: ScriptExecutionContext,
    evidence: string[],
    effectLedger: AgentObservedEffect[],
  ): Promise<void> {
    if (instruction.api === 'entities.update') {
      const ref = fullRef(args[0], instruction.location)
      const expected = isRecord(args[1]) ? args[1] : {}
      const read = await this.gatewayCall('read_application_entity', {
        ref, propertyIds: Object.keys(expected),
      }, instruction, `${scriptRunRef}:verify`, context)
      effectLedger.push(...read.effects)
      const properties = isRecord(read.output) && isRecord(read.output.properties) ? read.output.properties : {}
      const mismatch = Object.entries(expected).find(([key, value]) => !isDeepStrictEqual(properties[key], value))
      if (mismatch) {
        throw new HenjiScriptError('SCRIPT_VERIFICATION_FAILED', 'verify', `属性 ${mismatch[0]} 未从正式状态源读回目标值`, instruction.location, instruction.stepId)
      }
      evidence.push(`${instruction.stepId}:read-back:${ref.kind}`)
      return
    }
    if (instruction.api === 'entities.create') {
      const created = new Map<string, ApplicationRef>()
      for (const effect of observedEffects) {
        if (effect.effect !== 'create') continue
        for (const ref of effect.targetRefs) created.set(`${ref.kind}\u0000${ref.id}`, ref)
      }
      if (created.size === 0) collectRefs(output, created)
      if (created.size === 0) {
        throw new HenjiScriptError('SCRIPT_VERIFICATION_FAILED', 'verify', '创建结果没有完整稳定引用', instruction.location, instruction.stepId)
      }
      for (const ref of created.values()) {
        const read = await this.gatewayCall(
          'read_application_entity', { ref, propertyIds: [] }, instruction,
          `${scriptRunRef}:verify:${ref.kind}:${ref.id}`, context,
        )
        effectLedger.push(...read.effects)
      }
      evidence.push(`${instruction.stepId}:created-read-back:${created.size}`)
      return
    }
    if (instruction.api === 'entities.remove') {
      const ref = fullRef(args[0], instruction.location)
      const listed = await this.gatewayCall('list_application_entities', { entityType: ref.kind, limit: 200 }, instruction, `${scriptRunRef}:verify`, context)
      effectLedger.push(...listed.effects)
      const listedRefs = isRecord(listed.output) && Array.isArray(listed.output.refs) ? listed.output.refs : []
      if (listedRefs.some((candidate) => isRecord(candidate) && candidate.kind === ref.kind && candidate.id === ref.id)) {
        throw new HenjiScriptError('SCRIPT_VERIFICATION_FAILED', 'verify', '删除后实体仍存在', instruction.location, instruction.stepId)
      }
      evidence.push(`${instruction.stepId}:absence-read-back:${ref.kind}`)
    }
  }
}
