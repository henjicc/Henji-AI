import { HenjiScriptGatewayBridge, type ScriptExecutionContext, type HenjiScriptServiceOptions } from './gatewayBridge'
import { failureObservedEffects } from '../../../../../src/core/assistant/applicationTransactionFailureFacts'
import { randomUUID } from 'node:crypto'

import type { ApplicationRef } from '../../../../../src/core/application-control'
import type {
  RunHenjiScriptInput,
  RunHenjiScriptOutput,
} from '../../../../../src/core/assistant/capabilities/henjiScriptApplicationCapabilities'
import type { AgentObservedEffect } from '../../../../../src/core/assistant/observedEffect'
import {
  henjiScriptCheckpointSchema,
  type HenjiScriptCheckpoint,
} from '../../../../../src/core/assistant/externalWait'
import type { HenjiScriptApiLease } from '../../agent-runtime/context/script-api-lease'
import {
  HenjiScriptError,
  type HenjiCallInstruction,
  type HenjiInstruction,
} from './types'
import {
  checkpointDigest,
  collectRefs,
  evaluate,
  fullRef,
  isRecord,
  serializable,
} from './runtime-values'
import { HenjiScriptPreflight } from './preflight'

/** 引用在本段脚本内的稳定键。 */
function refKey(ref: ApplicationRef): string {
  return `${ref.kind}\u0000${ref.id}`
}

const ENTITY_TOOL = {
  'entities.list': 'list_application_entities',
  'entities.read': 'read_application_entity',
  'entities.create': 'change_application_entities',
  'entities.update': 'change_application_entities',
  'entities.remove': 'change_application_entities',
} as const

interface ScriptRuntimeState {
  values: Map<string, unknown>
  parents: Map<string, ApplicationRef>
  refs: Map<string, ApplicationRef>
  effects: AgentObservedEffect[]
  receipts: RunHenjiScriptOutput['steps']
  verificationEvidence: string[]
  submittedTasks: RunHenjiScriptOutput['submittedTasks']
  /** 本段脚本里已经删掉、且宿主已读回确认不存在的引用。 */
  removed: Set<string>
}

export class HenjiScriptService extends HenjiScriptGatewayBridge {
  private readonly preflight: HenjiScriptPreflight

  constructor(options: HenjiScriptServiceOptions) {
    super(options)
    this.preflight = new HenjiScriptPreflight(options.registry)
  }

  compile(input: RunHenjiScriptInput) {
    return this.preflight.compile(input)
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
      verificationEvidence: [...checkpoint.verificationState.evidence], submittedTasks: [], removed: new Set(),
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
          const branch = evaluate(instruction.condition, state.values)
            ? instruction.whenTrue
            : instruction.whenFalse
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
        /*
         * "删掉它，然后确认它不在了"——这是用户会原样说出口的话，脚本必须写得出来。
         *
         * 之前写不出来：`remove` 之后再 `read` 同一个引用必然抛 ENTITY_NOT_FOUND，整段脚本失败；
         * 而 `list` 返回的 refs 在受限语言里没法过滤（不支持 .find/.filter，for...of 只能遍历
         * 静态数组）。于是模型只能在"照做"和"脚本能跑"之间二选一。实测素材库那次它选了照做，
         * 最后一段脚本失败，8 个真实写入全部没能封存。
         *
         * 这里让"读一个本段刚删掉的引用"返回 null，`app.assert.absent(...)` 就能自然收尾。
         * 不是放宽校验：`entities.remove` 的 verifyEntityCall 刚刚已经 list 过一遍、确认它真的
         * 不在了，本段脚本内这条信息是权威的。没删过的引用照旧硬报错。
         */
        const readingRemovedRef = instruction.api === 'entities.read'
          && state.removed.has(refKey(fullRef(args[0], instruction.location)))
        const result = readingRemovedRef
          ? { output: null, effects: [], summary: '该引用已在本段脚本中删除并经正式状态源确认不存在。' }
          : await this.gatewayCall(toolName, input, instruction, scriptRunRef, context)
        if (readingRemovedRef) {
          state.verificationEvidence.push(`${instruction.stepId}:absence-confirmed`)
        }
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
        // 读一个本段已删除的引用，结果就是"没有"——直接存 null，`app.assert.absent(x)` 才能
        // 按字面意思写。包成 { value: null } 的话模型得写 absent(x.value)，那是猜不出来的。
        state.values.set(instruction.stepId, readingRemovedRef ? null : stepResult)
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
            state.verificationEvidence, state.effects, state.removed,
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
      if (error instanceof HenjiScriptError && error.transaction) {
        const effects = failureObservedEffects(error.transaction)
        state.effects.push(...effects)
        const refs = [...(error.transaction.resultRefs ?? []), ...(error.transaction.effects ?? []).flatMap((effect) => effect.refs)]
        refs.forEach((ref) => state.refs.set(refKey(ref), ref))
        if (error.stepId && error.location) state.receipts.push({ stepId: error.stepId, api: 'transaction', status: 'failed',
          location: error.location, resultRefs: refs.slice(0, 64), effectCount: effects.length,
          summary: '操作已产生修改但未完整确认；请检查当前内容，不要重放。' })
      }
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
        ...(failure.transaction ? { transaction: failure.transaction } : {}),
      } : null,
      submittedTasks: state.submittedTasks, checkpoint,
      revision: latest?.revision ?? 0, scopeRevisions: Object.fromEntries(Object.entries({ ...latest?.scopeRevisions, ...context.revisionCursor })
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number')),
    }
  }

  async execute(raw: RunHenjiScriptInput, context: ScriptExecutionContext): Promise<RunHenjiScriptOutput> {
    const scriptRunRef = `henji-script:${randomUUID()}`
    const state: ScriptRuntimeState = {
      values: new Map(), parents: new Map(), refs: new Map(), effects: [], receipts: [],
      verificationEvidence: [], submittedTasks: [], removed: new Set(),
    }
    try {
      const executionContext: ScriptExecutionContext = {
        ...context,
        revisionCursor: { ...(context.getHostContext(context.runId)?.scopeRevisions ?? {}) },
        pendingNavigationScopes: new Set<string>(),
      }
      const lease = this.options.getLease(context.runId)
      if (!lease) {
        /*
         * 只说"没有租约"等于把死路指给模型：它既不知道租约是怎么来的，也不知道还能不能补。
         * 剩下五处租约拒绝都带着 leaseHint 说明补救办法，唯独这条最外层的没有——实测生成
         * 场景的续跑运行撞上它，模型只能放弃并在最终答复里解释为什么放弃。
         */
        throw new HenjiScriptError('SCRIPT_API_NOT_DISCOVERED', 'preflight',
          '本次运行尚未通过能力发现取得 scriptApi 租约。先调用 discover_application_capabilities，'
          + '在 domains / entityTypes 里点名这段脚本要碰的领域与实体，拿到 scriptApi 后再运行本段脚本。')
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

}
