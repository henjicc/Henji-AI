import {
  applicationCommitRequestSchema,
  applicationTransactionResultSchema,
  applicationUndoRequestSchema,
  type ApplicationChangePlan,
  type ApplicationCommitRequest,
  type ApplicationEvidence,
  type ApplicationPlannedStep,
  type ApplicationTransactionMode,
  type ApplicationTransactionResult,
  type ApplicationUndoRequest,
} from '../transactions'
import type { ApplicationReflectionRegistry } from '../registry'
import { ApplicationExecutionPlanStore } from './planStore'
import { ApplicationPlanBuilder } from './planner'
import { ApplicationTransactionVerifier } from './verifier'
import type {
  ApplicationCollectionExecutor,
  ApplicationCompletedStepResult,
  ApplicationControlExecutionApi,
  ApplicationControlExecutionDependencies,
  ApplicationCustomVerifier,
  ApplicationExecutionContext,
  ApplicationMutationExecutor,
  ApplicationPlanRequest,
  ApplicationRisk,
  ApplicationSemanticOperationExecutor,
  ApplicationStepExecutionResult,
} from './types'

const RISK_RANK: Record<ApplicationRisk, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 }

interface UndoRecord {
  steps: ApplicationPlannedStep[]
  results: ApplicationCompletedStepResult[]
}

function defaultOpaqueRef(kind: 'plan' | 'transaction' | 'undo'): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2).padEnd(16, '0')}`
  return `${kind}:${random}`
}

function failure(
  code: Extract<ApplicationTransactionResult, { status: 'failed' }>['code'],
  message: string,
  recoverable: boolean,
  extra: Partial<Omit<Extract<ApplicationTransactionResult, { status: 'failed' }>, 'status' | 'code' | 'message' | 'recoverable'>> = {}
): ApplicationTransactionResult {
  return applicationTransactionResultSchema.parse({ status: 'failed', code, message, recoverable, ...extra })
}

/**
 * 从 `PARTIAL_FAILURE:<n>:<原始错误>` / `COMPENSATED_FAILURE:<下标>:<原始错误>` 里取回原因。
 *
 * 这些包装串以前只用来判分支，原始错误连一个字都没进最终结果——调用方拿到的永远是
 * "事务执行失败"这六个字。实测排查三维布置时，模型收到的就是这句，它既不知道是
 * targetObjectId 填错了，也不可能自我修正。
 */
function failureCause(message: string): string {
  const cause = /^(?:PARTIAL_FAILURE|COMPENSATED_FAILURE):[^:]*:([\s\S]+)$/.exec(message)
  const detail = cause?.[1]?.trim()
  return detail ? `原因：${detail}` : ''
}

function mergeRevisions(target: Record<string, number>, source: Record<string, number>): void {
  for (const [scope, revision] of Object.entries(source)) target[scope] = revision
}

function planRevisions(plan: ApplicationChangePlan): Record<string, number> {
  const revisions: Record<string, number> = {}
  for (const step of plan.steps) {
    for (const [scope, revision] of Object.entries(step.expectedRevisions)) {
      const current = revisions[scope]
      if (current !== undefined && current !== revision) throw new Error(`PLAN_REVISION_CONFLICT:${scope}`)
      revisions[scope] = revision
    }
  }
  return revisions
}

function assertExpectedRevisions(
  expected: Record<string, number>,
  actual: Record<string, number>
): void {
  for (const [scope, revision] of Object.entries(expected)) {
    if (actual[scope] !== revision) throw new Error(`REVISION_CONFLICT:${scope}:${revision}/${actual[scope]}`)
  }
}

export class ApplicationControlExecutionEngine implements ApplicationControlExecutionApi {
  private readonly mutationExecutors = new Map<string, ApplicationMutationExecutor>()
  private readonly collectionExecutors = new Map<string, ApplicationCollectionExecutor>()
  private readonly operationExecutors = new Map<string, ApplicationSemanticOperationExecutor>()
  private readonly undoRecords = new Map<string, UndoRecord>()
  private readonly now: () => Date
  private readonly createOpaqueRef: (kind: 'plan' | 'transaction' | 'undo') => string
  private readonly store: ApplicationExecutionPlanStore
  private readonly verifier: ApplicationTransactionVerifier
  private readonly planner: ApplicationPlanBuilder
  private readonly describeCollectionWriters?: ApplicationControlExecutionDependencies['describeCollectionWriters']

  constructor(
    private readonly registry: ApplicationReflectionRegistry,
    dependencies: ApplicationControlExecutionDependencies = {}
  ) {
    this.describeCollectionWriters = dependencies.describeCollectionWriters
    this.now = dependencies.now ?? (() => new Date())
    this.createOpaqueRef = dependencies.createOpaqueRef ?? defaultOpaqueRef
    this.store = new ApplicationExecutionPlanStore(
      dependencies.maxPlans ?? 128,
      dependencies.maxIdempotencyResults ?? 256
    )
    this.verifier = new ApplicationTransactionVerifier(registry)
    this.planner = new ApplicationPlanBuilder({
      registry,
      now: this.now,
      createPlanRef: () => this.createOpaqueRef('plan'),
      getMutationExecutor: (entityType) => this.mutationExecutors.get(entityType),
      getOperationExecutor: (capabilityId, version) => this.getOperationExecutor(capabilityId, version),
    })
  }

  registerMutationExecutor(executor: ApplicationMutationExecutor): void {
    if (this.mutationExecutors.has(executor.entityType)) {
      throw new Error(`MUTATION_EXECUTOR_DUPLICATE:${executor.entityType}`)
    }
    this.mutationExecutors.set(executor.entityType, executor)
  }

  registerCollectionExecutor(executor: ApplicationCollectionExecutor): void {
    if (this.collectionExecutors.has(executor.entityType)) {
      throw new Error(`COLLECTION_EXECUTOR_DUPLICATE:${executor.entityType}`)
    }
    this.collectionExecutors.set(executor.entityType, executor)
  }

  registerOperationExecutor(executor: ApplicationSemanticOperationExecutor): void {
    const key = this.operationKey(executor.capabilityId, executor.capabilityVersion)
    if (this.operationExecutors.has(key)) throw new Error(`OPERATION_EXECUTOR_DUPLICATE:${key}`)
    this.operationExecutors.set(key, executor)
  }

  registerVerifier(verifier: ApplicationCustomVerifier): void {
    this.verifier.register(verifier)
  }

  async plan(
    request: ApplicationPlanRequest,
    context: ApplicationExecutionContext
  ): Promise<ApplicationChangePlan> {
    const plan = await this.planner.build(request, context)
    this.store.savePlan(plan)
    return plan
  }

  async commit(
    input: ApplicationCommitRequest,
    context: ApplicationExecutionContext
  ): Promise<ApplicationTransactionResult> {
    const request = applicationCommitRequestSchema.parse(input)
    try {
      const idempotent = this.store.getIdempotent(request.idempotencyKey, request.planRef)
      if (idempotent) return idempotent
    } catch {
      return failure('INVALID_PLAN', '幂等键已用于其他计划。', false)
    }
    const stored = this.store.getPlan(request.planRef)
    if (!stored || stored.committed) return failure('INVALID_PLAN', '计划不存在或已经提交。', false)
    if (new Date(stored.plan.expiresAt).getTime() <= this.now().getTime()) {
      return failure('INVALID_PLAN', '计划已过期，请重新读取状态并规划。', true)
    }
    const approvalFailure = this.checkApproval(stored.plan, request)
    if (approvalFailure) return approvalFailure
    const transactionRef = this.createOpaqueRef('transaction')
    const expected = planRevisions(stored.plan)
    try {
      assertExpectedRevisions(expected, request.expectedRevisions)
      const current = await this.readCurrentRevisions(stored.plan.steps, context)
      assertExpectedRevisions(expected, current)
      await this.preflightPlan(stored.plan.steps, context, stored.plan.transactionMode)
      const execution = await this.executePlan(stored.plan, context)
      if (execution.deferred) {
        this.store.markCommitted(stored.plan.planRef)
        const result = execution.deferred.status === 'submitted'
          ? applicationTransactionResultSchema.parse({
              status: 'submitted',
              transactionRef,
              taskRef: execution.deferred.taskRef,
              resultingRevisions: execution.deferred.resultingRevisions,
              submittedAt: this.now().toISOString(),
            })
          : applicationTransactionResultSchema.parse({
              status: 'waiting_user',
              transactionRef,
              reason: execution.deferred.reason,
              resumeRef: execution.deferred.resumeRef,
            })
        this.store.saveIdempotent(request.idempotencyKey, request.planRef, result)
        return result
      }
      const evidence = execution.completed.flatMap((item) => item.evidence)
      if (evidence.length === 0) throw new Error('SUCCESS_EVIDENCE_REQUIRED')
      const verification = await this.verifier.verify(
        stored.plan.verificationConditions,
        evidence,
        context,
        this.now()
      )
      const resultingRevisions: Record<string, number> = {}
      execution.completed.forEach((result) => mergeRevisions(resultingRevisions, result.resultingRevisions))
      const undoRef = this.createUndoRef(stored.plan.steps, execution.completed)
      this.store.markCommitted(stored.plan.planRef)
      if (!verification.verified) {
        const result = failure('VERIFICATION_FAILED', '提交已执行，但结构化验证未通过。', true, {
          transactionRef,
          currentRevisions: resultingRevisions,
          verification,
          ...(undoRef ? { undoRef } : {}),
          partial: {
            completedStepIndexes: execution.completed.map((_, index) => index),
            compensatedStepIndexes: [],
            uncompensatedStepIndexes: execution.completed.map((_, index) => index),
          },
        })
        this.store.saveIdempotent(request.idempotencyKey, request.planRef, result)
        return result
      }
      const result = applicationTransactionResultSchema.parse({
        status: 'completed',
        transactionRef,
        resultingRevisions,
        producedRefs: execution.completed.flatMap((item) => item.producedRefs),
        evidence: [...evidence, ...verification.evidence],
        verification,
        ...(undoRef ? { undoRef } : {}),
        completedAt: this.now().toISOString(),
      })
      this.store.saveIdempotent(request.idempotencyKey, request.planRef, result)
      return result
    } catch (error) {
      const result = await this.handleExecutionFailure(error, stored.plan, transactionRef, context)
      this.store.saveIdempotent(request.idempotencyKey, request.planRef, result)
      return result
    }
  }

  async undo(
    input: ApplicationUndoRequest,
    context: ApplicationExecutionContext
  ): Promise<ApplicationTransactionResult> {
    const request = applicationUndoRequestSchema.parse(input)
    try {
      const idempotent = this.store.getIdempotent(request.idempotencyKey, request.undoRef)
      if (idempotent) return idempotent
    } catch {
      return failure('INVALID_PLAN', '幂等键已用于其他撤销操作。', false)
    }
    const record = this.undoRecords.get(request.undoRef)
    if (!record) return failure('NOT_FOUND', '撤销引用不存在或已使用。', false)
    try {
      const current = await this.readCurrentRevisions(record.steps, context)
      const resultingRevisions: Record<string, number> = {}
      record.results.forEach((result) => mergeRevisions(resultingRevisions, result.resultingRevisions))
      assertExpectedRevisions(resultingRevisions, request.expectedRevisions)
      assertExpectedRevisions(request.expectedRevisions, current)
      const results: ApplicationCompletedStepResult[] = []
      for (let index = record.steps.length - 1; index >= 0; index -= 1) {
        const step = record.steps[index]
        const original = record.results[index]
        if (!original.undoToken) throw new Error('UNDO_NOT_SUPPORTED')
        const result = await this.undoStep(step, original.undoToken, context)
        results.push(result)
      }
      this.undoRecords.delete(request.undoRef)
      const evidence = results.flatMap((result) => result.evidence)
      const undoRevisions: Record<string, number> = {}
      results.forEach((result) => mergeRevisions(undoRevisions, result.resultingRevisions))
      const result = applicationTransactionResultSchema.parse({
        status: 'completed',
        transactionRef: this.createOpaqueRef('transaction'),
        resultingRevisions: undoRevisions,
        producedRefs: results.flatMap((item) => item.producedRefs),
        evidence,
        verification: { verified: true, evidence: [], unmetConditions: [], checkedAt: this.now().toISOString() },
        completedAt: this.now().toISOString(),
      })
      this.store.saveIdempotent(request.idempotencyKey, request.undoRef, result)
      return result
    } catch (error) {
      const result = this.toFailure(error)
      this.store.saveIdempotent(request.idempotencyKey, request.undoRef, result)
      return result
    }
  }

  private async executePlan(
    plan: ApplicationChangePlan,
    context: ApplicationExecutionContext
  ): Promise<{ completed: ApplicationCompletedStepResult[]; deferred?: Exclude<ApplicationStepExecutionResult, { status: 'completed' }> }> {
    if (plan.transactionMode === 'atomic' && plan.steps.length > 1) {
      const steps = plan.steps as Array<Extract<ApplicationPlannedStep, { kind: 'mutation' }>>
      const executor = this.mutationExecutors.get(steps[0].entityType)
      if (!executor?.applyAtomic) throw new Error('ATOMIC_GROUP_NOT_SUPPORTED')
      return { completed: await executor.applyAtomic(steps, context) }
    }
    const completed: ApplicationCompletedStepResult[] = []
    try {
      for (const step of plan.steps) {
        if (context.signal?.aborted) throw new Error('CANCELLED')
        const result = await this.executeStep(step, context)
        if (result.status !== 'completed') {
          if (plan.steps.length !== 1) throw new Error('DEFERRED_GROUP_NOT_SUPPORTED')
          return { completed, deferred: result }
        }
        completed.push(result)
      }
      return { completed }
    } catch (error) {
      const original = error instanceof Error ? error.message : String(error)
      // `atomic` 也必须补偿。此前只有 `compensatable` 走补偿，于是声明 atomic 的计划失败后
      // 把已完成的步骤原样留在应用里，却对调用方自称"事务"——三维布置就是这么留下一个
      // 压在立方体上的圆柱体的。只有 `non_reversible` 才允许不补偿，那是它的字面语义。
      if (plan.transactionMode === 'non_reversible') {
        throw new Error(`PARTIAL_FAILURE:${completed.length}:${original}`)
      }
      const compensated: number[] = []
      for (let index = completed.length - 1; index >= 0; index -= 1) {
        try {
          await this.compensateStep(plan.steps[index], completed[index], context)
          compensated.push(index)
        } catch (compensationError) {
          // 补偿失败不能顶掉原始错误：原始错误才是调用方需要据以决策的那条。这里如实降级
          // 成"部分未补偿"，并把两条信息都带出去。
          const detail = compensationError instanceof Error
            ? compensationError.message
            : String(compensationError)
          throw new Error(
            `PARTIAL_FAILURE:${completed.length}:${original}（补偿在第 ${index} 步失败：${detail}）`
          )
        }
      }
      throw new Error(`COMPENSATED_FAILURE:${compensated.join(',')}:${original}`)
    }
  }

  /**
   * 声明了可回退语义的**多步**计划，必须每一步都真的能补偿——在执行任何一步之前验明。
   *
   * 否则会出现"计划自称 atomic、执行器却没有补偿能力"的组合：中途失败时应用被改了一半，
   * 而调用方（包括模型）是按 atomic 的承诺来决策的。让这种组合在预检就失败，比在改坏之后
   * 才发现要好得多。
   *
   * 只查多步计划：单步计划失败时 `completed` 是空的，补偿循环一次都不会执行，这时要求执行器
   * 实现 compensate 是纯粹的死要求。**单步内部的部分写入引擎补偿不了**（失败的那步不在
   * `completed` 里），那必须由执行器自己回滚——三维布置就是这么修的。
   */
  private assertCompensable(steps: ApplicationPlannedStep[], mode: ApplicationTransactionMode): void {
    if (mode === 'non_reversible' || steps.length < 2) return
    for (const step of steps) {
      const executor = step.kind === 'mutation'
        ? this.mutationExecutors.get(step.entityType)
        : step.kind === 'collection'
          ? this.collectionExecutors.get(step.entityType)
          : this.getOperationExecutor(step.capabilityId, step.capabilityVersion)
      if (executor && !executor.compensate) {
        const label = step.kind === 'operation' ? step.capabilityId : step.entityType
        throw new Error(`COMPENSATION_NOT_SUPPORTED:${label} 无法补偿，不能用于 ${mode} 事务`)
      }
    }
  }

  /**
   * 集合写入的预检：类型必须声明 creatable/removable，创建时必须给齐必填属性，数量不得超上限。
   *
   * 全部在执行之前做完——这是三维布置那次事故的教训：任何能靠输入判断的错误都不该等到写了
   * 一半才抛。
   */
  private assertCollectionAllowed(
    step: Extract<ApplicationPlannedStep, { kind: 'collection' }>,
    context: ApplicationExecutionContext
  ): void {
    const descriptor = this.registry.describe({ entityTypes: [step.entityType] }, context).entities[0]
    if (!descriptor) throw new Error(`ENTITY_TYPE_NOT_FOUND:${step.entityType}`)
    const rule = descriptor.collectionWrite
    const operation = step.operation.kind === 'create' ? 'create' : 'remove'
    if (!rule) {
      throw new Error(
        `COLLECTION_WRITE_NOT_DECLARED:${step.entityType} 未声明可增删${this.collectionWriterHint(step.entityType, operation)}`
      )
    }
    if (step.operation.kind === 'create') {
      if (!rule.creatable) {
        throw new Error(
          `COLLECTION_CREATE_NOT_ALLOWED:${step.entityType}${this.collectionWriterHint(step.entityType, 'create')}`
        )
      }
      if (step.operation.items.length > rule.maxItemsPerChange) {
        throw new Error(
          `COLLECTION_TOO_MANY_ITEMS:${step.entityType} 一次最多创建 ${rule.maxItemsPerChange} 个，`
          + `本次 ${step.operation.items.length} 个`
        )
      }
      for (const [index, item] of step.operation.items.entries()) {
        const missing = rule.requiredPropertyIds.filter((propertyId) => !(propertyId in item.properties))
        if (missing.length > 0) {
          throw new Error(`COLLECTION_REQUIRED_PROPERTY_MISSING:第 ${index} 项缺少 ${missing.join('、')}`)
        }
      }
      return
    }
    if (!rule.removable) {
      throw new Error(
        `COLLECTION_REMOVE_NOT_ALLOWED:${step.entityType}${this.collectionWriterHint(step.entityType, 'remove')}`
      )
    }
    if (step.operation.targets.length > rule.maxItemsPerChange) {
      throw new Error(`COLLECTION_TOO_MANY_ITEMS:${step.entityType} 一次最多删除 ${rule.maxItemsPerChange} 个`)
    }
  }

  /**
   * 拒绝通用增删时，把真正能做这件事的专用能力一并说出来。
   *
   * 没有这一句，模型收到的是死胡同，只能推断"应用做不到"——那正是它上一次凭空否认能力的
   * 来源。有这一句，同一个拒绝就变成一次改道。
   */
  private collectionWriterHint(entityType: string, operation: 'create' | 'remove'): string {
    const writers = this.describeCollectionWriters?.(entityType, operation) ?? []
    if (writers.length === 0) return ''
    return `；${operation === 'create' ? '创建' : '删除'}这类实体走专用能力：${writers.join('、')}`
  }

  private async preflightPlan(
    steps: ApplicationPlannedStep[],
    context: ApplicationExecutionContext,
    mode: ApplicationTransactionMode
  ): Promise<void> {
    this.assertCompensable(steps, mode)
    for (const step of steps) {
      if (step.kind === 'mutation') {
        const propertyIds = step.mutations.map((mutation) => mutation.propertyId)
        const availability = await this.registry.getPropertyAvailability(step.target, propertyIds, context)
        const blocked = availability.filter((item) => !item.writable)
        if (blocked.length > 0) {
          // 带上是哪几条、为什么：只说"不可写"会让一个本可自纠的失败变成任务中断。
          throw new Error(`PROPERTY_NOT_WRITABLE:${blocked
            .map((item) => `${item.propertyId}（${item.reasons.join('；') || '无写权限'}）`)
            .join('、')}`)
        }
        continue
      }
      if (step.kind === 'collection') {
        this.assertCollectionAllowed(step, context)
        if (!this.collectionExecutors.has(step.entityType)) {
          throw new Error(`COLLECTION_EXECUTOR_NOT_FOUND:${step.entityType}`)
        }
        continue
      }
      const executor = this.requireOperationExecutor(step)
      if (!executor.requiredPermissions.every((permission) => context.permissions.has(permission))) {
        throw new Error(`PERMISSION_DENIED:${step.capabilityId}`)
      }
      executor.normalizeInput(step.input)
    }
  }

  private async executeStep(
    step: ApplicationPlannedStep,
    context: ApplicationExecutionContext
  ): Promise<ApplicationStepExecutionResult> {
    if (step.kind === 'mutation') {
      const executor = this.mutationExecutors.get(step.entityType)
      if (!executor) throw new Error(`MUTATION_EXECUTOR_NOT_FOUND:${step.entityType}`)
      return await executor.apply(step, context)
    }
    if (step.kind === 'collection') {
      this.assertCollectionAllowed(step, context)
      const executor = this.collectionExecutors.get(step.entityType)
      if (!executor) throw new Error(`COLLECTION_EXECUTOR_NOT_FOUND:${step.entityType}`)
      return await executor.apply(step, context)
    }
    const executor = this.getOperationExecutor(step.capabilityId, step.capabilityVersion)
    if (!executor) throw new Error(`OPERATION_EXECUTOR_NOT_FOUND:${step.capabilityId}`)
    if (!executor.requiredPermissions.every((permission) => context.permissions.has(permission))) {
      throw new Error(`PERMISSION_DENIED:${step.capabilityId}`)
    }
    return await executor.execute(executor.normalizeInput(step.input), context)
  }

  private async readCurrentRevisions(
    steps: ApplicationPlannedStep[],
    context: ApplicationExecutionContext
  ): Promise<Record<string, number>> {
    const revisions: Record<string, number> = {}
    for (const step of steps) {
      const current = step.kind === 'mutation'
        ? (await this.registry.readEntity(step.target, [], context)).revisions
        : step.kind === 'collection'
          ? (await this.registry.readEntity(step.parent, [], context)).revisions
          : await this.requireOperationExecutor(step).getCurrentRevisions(step.input)
      mergeRevisions(revisions, current)
    }
    return revisions
  }

  private checkApproval(
    plan: ApplicationChangePlan,
    request: ApplicationCommitRequest
  ): ApplicationTransactionResult | undefined {
    if (plan.risk === 'R4') return failure('PERMISSION_DENIED', '该计划风险等级禁止执行。', false)
    if (!plan.requiresApproval) return undefined
    if (!request.approvedRisk || RISK_RANK[request.approvedRisk] < RISK_RANK[plan.risk]) {
      return failure('PERMISSION_DENIED', '计划需要匹配风险等级的明确批准。', true)
    }
    return undefined
  }

  private createUndoRef(
    steps: ApplicationPlannedStep[],
    results: ApplicationCompletedStepResult[]
  ): string | undefined {
    const supported = results.length === steps.length && results.every((result, index) => {
      if (!result.undoToken) return false
      const step = steps[index]
      return step.kind === 'mutation'
        ? Boolean(this.mutationExecutors.get(step.entityType)?.undo)
        : step.kind === 'collection'
          ? Boolean(this.collectionExecutors.get(step.entityType)?.undo)
          : Boolean(this.getOperationExecutor(step.capabilityId, step.capabilityVersion)?.undo)
    })
    if (!supported) return undefined
    const undoRef = this.createOpaqueRef('undo')
    this.undoRecords.set(undoRef, { steps, results })
    return undoRef
  }

  private async undoStep(
    step: ApplicationPlannedStep,
    undoToken: string,
    context: ApplicationExecutionContext
  ): Promise<ApplicationCompletedStepResult> {
    const executor = step.kind === 'mutation'
      ? this.mutationExecutors.get(step.entityType)
      : step.kind === 'collection'
        ? this.collectionExecutors.get(step.entityType)
        : this.getOperationExecutor(step.capabilityId, step.capabilityVersion)
    if (!executor?.undo) throw new Error('UNDO_NOT_SUPPORTED')
    return await executor.undo(undoToken, context)
  }

  private async compensateStep(
    step: ApplicationPlannedStep,
    result: ApplicationCompletedStepResult,
    context: ApplicationExecutionContext
  ): Promise<ApplicationEvidence[]> {
    if (step.kind === 'mutation') {
      const executor = this.mutationExecutors.get(step.entityType)
      if (!executor?.compensate) throw new Error('COMPENSATION_NOT_SUPPORTED')
      return await executor.compensate(step, result, context)
    }
    if (step.kind === 'collection') {
      const executor = this.collectionExecutors.get(step.entityType)
      if (!executor?.compensate) throw new Error('COMPENSATION_NOT_SUPPORTED')
      return await executor.compensate(step, result, context)
    }
    const executor = this.getOperationExecutor(step.capabilityId, step.capabilityVersion)
    if (!executor?.compensate) throw new Error('COMPENSATION_NOT_SUPPORTED')
    return await executor.compensate(step.input, result, context)
  }

  private async handleExecutionFailure(
    error: unknown,
    plan: ApplicationChangePlan,
    transactionRef: string,
    _context: ApplicationExecutionContext
  ): Promise<ApplicationTransactionResult> {
    const message = error instanceof Error ? error.message : String(error)
    const compensated = /^COMPENSATED_FAILURE:([^:]*):/.exec(message)
    if (compensated) {
      const indexes = compensated[1] ? compensated[1].split(',').map(Number) : []
      return failure('EXECUTION_FAILED', `事务执行失败，已完成步骤均已补偿，应用状态未改变。${failureCause(message)}`, true, {
        transactionRef,
        partial: { completedStepIndexes: indexes, compensatedStepIndexes: indexes, uncompensatedStepIndexes: [] },
      })
    }
    const partial = /^PARTIAL_FAILURE:(\d+):/.exec(message)
    if (partial) {
      const count = Number(partial[1])
      const indexes = Array.from({ length: count }, (_, index) => index)
      // 零步完成时**不能**说"部分步骤已完成且未补偿、不可重试"。这句话曾经无视 count 硬写
      // 出来：单步事务失败时一步都没写，调用方却被告知应用已被改动且不可重试。实测中模型
      // 就是读到这句之后按规则停止了所有后续写入——它的行为是对的，是这条报告在骗它。
      if (count === 0) {
        return failure('EXECUTION_FAILED', `事务执行失败，没有任何步骤被提交，应用状态未改变。${failureCause(message)}`, true, {
          transactionRef,
          partial: { completedStepIndexes: [], compensatedStepIndexes: [], uncompensatedStepIndexes: [] },
        })
      }
      return failure('EXECUTION_FAILED', `事务执行失败，前 ${count} 步已完成且未补偿，应用处于中间状态。${failureCause(message)}`, false, {
        transactionRef,
        partial: { completedStepIndexes: indexes, compensatedStepIndexes: [], uncompensatedStepIndexes: indexes },
      })
    }
    return this.toFailure(error, transactionRef, planRevisions(plan))
  }

  private toFailure(
    error: unknown,
    transactionRef?: string,
    currentRevisions?: Record<string, number>
  ): ApplicationTransactionResult {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('REVISION_CONFLICT')) {
      return failure('CONFLICT', '应用状态已变化，请重新观察并规划。', true, { transactionRef, currentRevisions })
    }
    // 属性写不了要报出是哪条、以及这个实体上有哪些能写——原始错误里已经带了这些，
    // 归类时丢掉它们，模型看到的就只剩"权限或可写状态已变化"，无从自纠。
    if (message.includes('PROPERTY_NOT_WRITABLE') || message.includes('PROPERTY_OPERATION_NOT_SUPPORTED')) {
      return failure('PERMISSION_DENIED', `属性写入被拒绝。原因：${message}`, true, { transactionRef })
    }
    if (message.includes('PERMISSION_DENIED')) {
      return failure('PERMISSION_DENIED', '提交时权限或属性可写状态已变化。', true, { transactionRef })
    }
    if (message.includes('NOT_FOUND')) return failure('NOT_FOUND', `计划引用的对象不存在。原因：${message}`, true, { transactionRef })
    if (message === 'CANCELLED') return failure('CANCELLED', '操作已取消。', false, { transactionRef })
    // 兜底分支同样要带上原始错误：否则任何未归类的失败对调用方都只是"应用事务执行失败"，
    // 既无法自我修正，也无法据以判断该不该重试。
    return failure('EXECUTION_FAILED', `应用事务执行失败。原因：${message}`, false, { transactionRef })
  }

  private requireOperationExecutor(
    step: Extract<ApplicationPlannedStep, { kind: 'operation' }>
  ): ApplicationSemanticOperationExecutor {
    const executor = this.getOperationExecutor(step.capabilityId, step.capabilityVersion)
    if (!executor) throw new Error(`OPERATION_EXECUTOR_NOT_FOUND:${step.capabilityId}`)
    return executor
  }

  private getOperationExecutor(
    capabilityId: string,
    version: number
  ): ApplicationSemanticOperationExecutor | undefined {
    return this.operationExecutors.get(this.operationKey(capabilityId, version))
  }

  private operationKey(capabilityId: string, version: number): string {
    return `${capabilityId}@${version}`
  }
}
