import {
  applicationCommitRequestSchema,
  applicationTransactionResultSchema,
  applicationUndoRequestSchema,
  type ApplicationChangePlan,
  type ApplicationCommitRequest,
  type ApplicationPlannedStep,
  type ApplicationTransactionResult,
  type ApplicationUndoRequest,
} from '../transactions'
import type { ApplicationReflectionRegistry } from '../registry'
import { ApplicationExecutionPlanStore } from './planStore'
import { ApplicationPlanBuilder } from './planner'
import { ApplicationTransactionVerifier } from './verifier'
import { ApplicationExecutionSupport } from './executionSupport'
import { ApplicationExecutionProgressFailure, ApplicationPersistenceBoundaryFailure, withApplicationPersistenceBoundary, type ApplicationPersistenceReceipt } from './persistence'
import { acceptedPropertyOperations, type ApplicationMutationOperation } from './writerTable'
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

export class ApplicationControlExecutionEngine extends ApplicationExecutionSupport implements ApplicationControlExecutionApi {
  private readonly undoRecords = new Map<string, UndoRecord>()
  private readonly now: () => Date
  private readonly createOpaqueRef: (kind: 'plan' | 'transaction' | 'undo') => string
  private readonly store: ApplicationExecutionPlanStore
  private readonly verifier: ApplicationTransactionVerifier
  private readonly planner: ApplicationPlanBuilder
  private readonly resolvePersistenceParticipants?: ApplicationControlExecutionDependencies['resolvePersistenceParticipants']

  constructor(
    registry: ApplicationReflectionRegistry,
    dependencies: ApplicationControlExecutionDependencies = {}
  ) {
    super(registry, dependencies.describeCollectionWriters)
    this.resolvePersistenceParticipants = dependencies.resolvePersistenceParticipants
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

  /** 返回通用计划入口实际接受的操作；包含计划器可安全编译的高层 set 语义。 */
  getAcceptedPropertyOperations(
    entityType: string,
    propertyId: string,
  ): readonly ApplicationMutationOperation[] {
    const executor = this.mutationExecutors.get(entityType)
    const descriptor = this.registry.getProperty(propertyId)
    return [...acceptedPropertyOperations(
      executor?.propertyOperations.get(propertyId),
      descriptor?.entityType === entityType ? descriptor.value.kind : undefined,
    )]
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
      const persistenceReceipts: ApplicationPersistenceReceipt[] = []
      const execution = await withApplicationPersistenceBoundary({
        participants: this.resolvePersistenceParticipants?.(stored.plan.steps, context) ?? [],
        context,
        execute: (batchContext) => this.executePlan(stored.plan, batchContext),
        completed: (result) => result.completed,
        onReceipt: (receipt) => persistenceReceipts.push(receipt),
      })
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
      persistenceReceipts.forEach((receipt) => mergeRevisions(resultingRevisions, receipt.resultingRevisions))
      const undoRef = this.createUndoRef(stored.plan.steps, execution.completed)
      this.store.markCommitted(stored.plan.planRef)
      if (!verification.verified) {
        const detail = verification.unmetConditions.join('；')
        const result = failure(
          'VERIFICATION_FAILED',
          `提交已执行，但结构化验证未通过${detail ? `：${detail}` : '。'}`,
          true,
          {
          transactionRef,
          currentRevisions: resultingRevisions,
          verification,
          ...(undoRef ? { undoRef } : {}),
          partial: {
            completedStepIndexes: execution.completed.map((_, index) => index),
            compensatedStepIndexes: [],
            uncompensatedStepIndexes: execution.completed.map((_, index) => index),
          },
          },
        )
        this.store.saveIdempotent(request.idempotencyKey, request.planRef, result)
        return result
      }
      const result = applicationTransactionResultSchema.parse({
        status: 'completed',
        transactionRef,
        resultingRevisions,
        resultRefs: execution.completed.flatMap((item) => item.directRefs),
        effects: [...this.collectEffects(stored.plan.steps, execution.completed), ...persistenceReceipts.flatMap((receipt) => receipt.effects)],
        evidence: [...evidence, ...verification.evidence],
        verification,
        ...(undoRef ? { undoRef } : {}),
        completedAt: this.now().toISOString(),
      })
      this.store.saveIdempotent(request.idempotencyKey, request.planRef, result)
      return result
    } catch (error) {
      if (error instanceof ApplicationPersistenceBoundaryFailure) this.store.markCommitted(stored.plan.planRef)
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
      const persistenceReceipts: ApplicationPersistenceReceipt[] = []
      const results = await withApplicationPersistenceBoundary({
        participants: this.resolvePersistenceParticipants?.(record.steps, context) ?? [],
        context,
        execute: async (batchContext) => {
          const applied: ApplicationCompletedStepResult[] = []
          try {
            for (let index = record.steps.length - 1; index >= 0; index -= 1) {
              const original = record.results[index]
              if (!original.undoToken) throw new Error('UNDO_NOT_SUPPORTED')
              applied.push(await this.undoStep(record.steps[index], original.undoToken, batchContext))
            }
          } catch (error) {
            if (batchContext.persistenceScopes?.size) {
              if (applied.length > 0) this.undoRecords.delete(request.undoRef)
              throw new ApplicationExecutionProgressFailure(`撤销执行失败：${String(error)}`, applied, [], error,
                applied.map((_, index) => record.steps.length - 1 - index))
            }
            throw error
          }
          return applied
        },
        completed: (result) => result,
        completedIndexes: (result) => result.map((_, index) => record.steps.length - 1 - index),
        onReceipt: (receipt) => persistenceReceipts.push(receipt),
      })
      this.undoRecords.delete(request.undoRef)
      const evidence = results.flatMap((result) => result.evidence)
      const undoRevisions: Record<string, number> = {}
      results.forEach((result) => mergeRevisions(undoRevisions, result.resultingRevisions))
      persistenceReceipts.forEach((receipt) => mergeRevisions(undoRevisions, receipt.resultingRevisions))
      const result = applicationTransactionResultSchema.parse({
        status: 'completed',
        transactionRef: this.createOpaqueRef('transaction'),
        resultingRevisions: undoRevisions,
        resultRefs: results.flatMap((item) => item.directRefs),
        effects: [...this.collectEffects([...record.steps].reverse(), results), ...persistenceReceipts.flatMap((receipt) => receipt.effects)],
        evidence,
        verification: { verified: true, evidence: [], unmetConditions: [], checkedAt: this.now().toISOString() },
        completedAt: this.now().toISOString(),
      })
      this.store.saveIdempotent(request.idempotencyKey, request.undoRef, result)
      return result
    } catch (error) {
      if (error instanceof ApplicationPersistenceBoundaryFailure) this.undoRecords.delete(request.undoRef)
      const result = error instanceof ApplicationPersistenceBoundaryFailure
        ? await this.describePersistenceFailure(error, record.steps, context) : this.toFailure(error)
      this.store.saveIdempotent(request.idempotencyKey, request.undoRef, result)
      return result
    }
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

  private async handleExecutionFailure(
    error: unknown,
    plan: ApplicationChangePlan,
    transactionRef: string,
    _context: ApplicationExecutionContext
  ): Promise<ApplicationTransactionResult> {
    if (error instanceof ApplicationPersistenceBoundaryFailure) return this.describePersistenceFailure(error, plan.steps, _context, transactionRef)
    if (error instanceof ApplicationExecutionProgressFailure) return this.toFailure(error, transactionRef)
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

  /** commit 与 undo 共用实际已执行事实；撤销的索引始终指向原计划步骤。 */
  private async describePersistenceFailure(error: ApplicationPersistenceBoundaryFailure,
    steps: ApplicationPlannedStep[], context: ApplicationExecutionContext, transactionRef?: string): Promise<ApplicationTransactionResult> {
    const result = this.toFailure(error, transactionRef)
    if (result.status !== 'failed') return result
    const compensated = error.executionFailure?.compensatedStepIndexes ?? []
    const remaining = error.completed.map((item, offset) => ({ item, index: error.completedStepIndexes[offset] }))
      .filter(({ index }) => !compensated.includes(index))
    const effects = this.collectEffects(remaining.map(({ index }) => steps[index]), remaining.map(({ item }) => item))
    const current = await this.readCurrentRevisions(steps, context).catch(() => ({}))
    return { ...result, currentRevisions: { ...result.currentRevisions, ...current },
      effects: [...effects, ...(result.effects ?? [])] }
  }

  private toFailure(
    error: unknown,
    transactionRef?: string,
    currentRevisions?: Record<string, number>
  ): ApplicationTransactionResult {
    if (error instanceof ApplicationExecutionProgressFailure) {
      const indexes = error.completedStepIndexes
      const uncompensated = indexes.filter((index) => !error.compensatedStepIndexes.includes(index))
      return failure('EXECUTION_FAILED', `操作未完整完成：${error.message}。请先检查当前内容，不要重复已执行的步骤。`.slice(0, 2000), uncompensated.length === 0, {
        transactionRef, partial: { completedStepIndexes: indexes, compensatedStepIndexes: error.compensatedStepIndexes,
          uncompensatedStepIndexes: uncompensated },
      })
    }
    if (error instanceof ApplicationPersistenceBoundaryFailure) {
      const indexes = error.completedStepIndexes
      const compensated = error.executionFailure?.compensatedStepIndexes ?? []
      const revisions: Record<string, number> = {}
      error.completed.forEach((result) => mergeRevisions(revisions, result.resultingRevisions))
      error.receipts.forEach((receipt) => mergeRevisions(revisions, receipt.resultingRevisions))
      return failure('EXECUTION_FAILED', error.executionFailure
        ? `${error.message} 原业务失败：${error.executionFailure.message}`.slice(0, 2000) : error.message, true, {
        transactionRef,
        currentRevisions: revisions,
        effects: error.receipts.flatMap((receipt) => receipt.effects),
        partial: { completedStepIndexes: indexes, compensatedStepIndexes: compensated,
          uncompensatedStepIndexes: indexes.filter((index) => !compensated.includes(index)) },
        persistence: error.failure.facts,
      })
    }
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('REVISION_CONFLICT')) {
      return failure('CONFLICT', '应用状态已变化，请重新观察并规划。', true, { transactionRef, currentRevisions })
    }
    // 属性写不了要报出是哪条、以及这个实体上有哪些能写——原始错误里已经带了这些，
    // 归类时丢掉它们，模型看到的就只剩"权限或可写状态已变化"，无从自纠。
    if (message.includes('PROPERTY_NOT_WRITABLE') || message.includes('PROPERTY_OPERATION_NOT_SUPPORTED')) {
      return failure('PERMISSION_DENIED', `属性写入被拒绝。原因：${message}`, true, { transactionRef })
    }
    if (message.includes('COLLECTION_CREATE_NOT_AVAILABLE') || message.includes('COLLECTION_REMOVE_NOT_AVAILABLE')) {
      return failure('PERMISSION_DENIED', `集合写入被拒绝。原因：${message}`, true, { transactionRef })
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


}
