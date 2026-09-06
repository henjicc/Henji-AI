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
import { ApplicationExecutionFailureSupport } from './failureSupport'
import { ApplicationExecutionScopeGuard } from './scopeGuard'
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

export class ApplicationControlExecutionEngine extends ApplicationExecutionFailureSupport implements ApplicationControlExecutionApi {
  private readonly scopeGuard = new ApplicationExecutionScopeGuard()
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
    const stored = this.store.getPlan(request.planRef)
    return this.guarded(request.planRef, request.idempotencyKey,
      stored && !stored.committed ? stored.plan.steps : [], context,
      (assertOwnership) => this.commitLocked(request, context, assertOwnership))
  }

  private async commitLocked(request: ApplicationCommitRequest, context: ApplicationExecutionContext,
    assertOwnership: (scopes?: string[]) => void): Promise<ApplicationTransactionResult> {
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
    const persistenceReceipts: ApplicationPersistenceReceipt[] = []
    try {
      assertExpectedRevisions(expected, request.expectedRevisions)
      const current = await this.readCurrentRevisions(stored.plan.steps, context)
      assertExpectedRevisions(expected, current)
      assertOwnership(Object.keys(current))
      await this.preflightPlan(stored.plan.steps, context, stored.plan.transactionMode)
      assertOwnership()
      const checked = await this.readCurrentRevisions(stored.plan.steps, context)
      assertExpectedRevisions(expected, checked)
      assertOwnership(Object.keys(checked))
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
      const effects = [...this.collectEffects(stored.plan.steps, execution.completed), ...persistenceReceipts.flatMap((receipt) => receipt.effects)]
      const resultingRevisions: Record<string, number> = {}
      execution.completed.forEach((result) => mergeRevisions(resultingRevisions, result.resultingRevisions))
      persistenceReceipts.forEach((receipt) => mergeRevisions(resultingRevisions, receipt.resultingRevisions))
      const undoRef = this.createUndoRef(stored.plan.steps, execution.completed)
      this.store.markCommitted(stored.plan.planRef)
      // 从此处起业务已执行；验证器抛错也不能再进入“零步失败”或允许重放的分支。
      const verification = await this.verifier.verify(stored.plan.verificationConditions, evidence, context, this.now())
        .catch(() => ({ verified: false, evidence: [],
          unmetConditions: ['无法完成提交后的正式状态验证，请先读取当前内容，不要重复已执行的修改。'], checkedAt: this.now().toISOString() }))
      if (evidence.length === 0) {
        verification.verified = false
        verification.unmetConditions.push('缺少正式执行证据，请先读取当前内容。')
      }
      if (!verification.verified) {
        const detail = verification.unmetConditions.join('；')
        const result = failure(
          'VERIFICATION_FAILED',
          `提交已执行，但结构化验证未通过${detail ? `：${detail}` : '。'}`,
          true,
          {
          transactionRef,
          currentRevisions: resultingRevisions,
          resultRefs: execution.completed.flatMap((item) => item.directRefs),
          effects,
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
        effects,
        evidence: [...evidence, ...verification.evidence],
        verification,
        ...(undoRef ? { undoRef } : {}),
        completedAt: this.now().toISOString(),
      })
      this.store.saveIdempotent(request.idempotencyKey, request.planRef, result)
      return result
    } catch (error) {
      if (error instanceof ApplicationPersistenceBoundaryFailure
        || (error instanceof ApplicationExecutionProgressFailure && error.completed.length > 0)) this.store.markCommitted(stored.plan.planRef)
      const result = await this.handleExecutionFailure(error, stored.plan, transactionRef, context, persistenceReceipts)
      this.store.saveIdempotent(request.idempotencyKey, request.planRef, result)
      return result
    }
  }

  async undo(
    input: ApplicationUndoRequest,
    context: ApplicationExecutionContext
  ): Promise<ApplicationTransactionResult> {
    const request = applicationUndoRequestSchema.parse(input)
    return this.guarded(request.undoRef, request.idempotencyKey,
      this.undoRecords.get(request.undoRef)?.steps ?? [], context,
      (assertOwnership) => this.undoLocked(request, context, assertOwnership))
  }

  private async undoLocked(request: ApplicationUndoRequest, context: ApplicationExecutionContext,
    assertOwnership: (scopes?: string[]) => void): Promise<ApplicationTransactionResult> {
    try {
      const idempotent = this.store.getIdempotent(request.idempotencyKey, request.undoRef)
      if (idempotent) return idempotent
    } catch {
      return failure('INVALID_PLAN', '幂等键已用于其他撤销操作。', false)
    }
    const record = this.undoRecords.get(request.undoRef)
    if (!record) return failure('NOT_FOUND', '撤销引用不存在或已使用。', false)
    const persistenceReceipts: ApplicationPersistenceReceipt[] = []
    try {
      await this.assertUndoPermissions(record.steps, context)
      const current = await this.readCurrentRevisions(record.steps, context)
      const resultingRevisions: Record<string, number> = {}
      record.results.forEach((result) => mergeRevisions(resultingRevisions, result.resultingRevisions))
      assertExpectedRevisions(resultingRevisions, request.expectedRevisions)
      assertExpectedRevisions(request.expectedRevisions, current)
      assertOwnership(Object.keys(current))
      const assertPermissions = await this.assertUndoPermissions(record.steps, context)
      const checked = await this.readCurrentRevisions(record.steps, context)
      assertExpectedRevisions(request.expectedRevisions, checked)
      assertOwnership(Object.keys(checked))
      assertPermissions()
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
            if (applied.length > 0) this.undoRecords.delete(request.undoRef)
            throw new ApplicationExecutionProgressFailure(`撤销执行失败：${String(error)}`, applied, [], error,
              applied.map((_, index) => record.steps.length - 1 - index))
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
        effects: [...this.collectEffects([...record.steps].reverse(), results, 'undo'), ...persistenceReceipts.flatMap((receipt) => receipt.effects)],
        evidence,
        verification: { verified: true, evidence: [], unmetConditions: [], checkedAt: this.now().toISOString() },
        completedAt: this.now().toISOString(),
      })
      this.store.saveIdempotent(request.idempotencyKey, request.undoRef, result)
      return result
    } catch (error) {
      if (error instanceof ApplicationPersistenceBoundaryFailure) this.undoRecords.delete(request.undoRef)
      const result = error instanceof ApplicationPersistenceBoundaryFailure
        ? await this.describePersistenceFailure(error, record.steps, context, undefined, 'undo')
        : error instanceof ApplicationExecutionProgressFailure
          ? await this.describeProgressFailure(error, record.steps, context, undefined, persistenceReceipts, 'undo') : this.toFailure(error)
      this.store.saveIdempotent(request.idempotencyKey, request.undoRef, result)
      return result
    }
  }

  /** Gateway 实例并非事务所有者；提交、撤销和其幂等结果均在这个共享入口串行确认。 */
  private async guarded(operationRef: string, idempotencyKey: string, steps: ApplicationPlannedStep[],
    context: ApplicationExecutionContext, execute: (assertOwnership: (scopes?: string[]) => void) => Promise<ApplicationTransactionResult>) {
    try {
      const participants = this.resolvePersistenceParticipants?.(steps, context) ?? []
      const scopes = () => [...this.affectedScopes(steps), ...participants.flatMap((owner) =>
        (owner.persistenceEffects ?? []).flatMap((effect) => effect.revisionScopes))]
      const heldScopes = new Set([...scopes(), ...Object.keys(await this.readCurrentRevisions(steps, context))])
      const assertOwnership = (readScopes: string[] = []) => {
        if (context.signal?.aborted) throw new Error('CANCELLED')
        const latest = this.resolvePersistenceParticipants?.(steps, context) ?? []
        const currentScopes = [...readScopes, ...this.affectedScopes(steps), ...latest.flatMap((owner) =>
          (owner.persistenceEffects ?? []).flatMap((effect) => effect.revisionScopes))]
        if (latest.length !== participants.length || latest.some((owner) => !participants.includes(owner))
          || currentScopes.some((scope) => !heldScopes.has(scope))) {
          throw new Error('REVISION_CONFLICT:事务关联作用域或保存宿主已变化，请重新读取并规划')
        }
      }
      return await this.scopeGuard.run([
        ...[...heldScopes].map((scope) => `scope:${scope}`), `operation:${operationRef}`, `idempotency:${idempotencyKey}`,
      ], context.signal, () => execute(assertOwnership))
    } catch (error) { return this.toFailure(error) }
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

}
