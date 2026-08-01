import {
  applicationCommitRequestSchema,
  applicationTransactionResultSchema,
  applicationUndoRequestSchema,
  type ApplicationChangePlan,
  type ApplicationCommitRequest,
  type ApplicationEvidence,
  type ApplicationPlannedStep,
  type ApplicationTransactionResult,
  type ApplicationUndoRequest,
} from '../transactions'
import type { ApplicationReflectionRegistry } from '../registry'
import { ApplicationExecutionPlanStore } from './planStore'
import { ApplicationPlanBuilder } from './planner'
import { ApplicationTransactionVerifier } from './verifier'
import type {
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
  private readonly operationExecutors = new Map<string, ApplicationSemanticOperationExecutor>()
  private readonly undoRecords = new Map<string, UndoRecord>()
  private readonly now: () => Date
  private readonly createOpaqueRef: (kind: 'plan' | 'transaction' | 'undo') => string
  private readonly store: ApplicationExecutionPlanStore
  private readonly verifier: ApplicationTransactionVerifier
  private readonly planner: ApplicationPlanBuilder

  constructor(
    private readonly registry: ApplicationReflectionRegistry,
    dependencies: ApplicationControlExecutionDependencies = {}
  ) {
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
      await this.preflightPlan(stored.plan.steps, context)
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
      if (plan.transactionMode === 'compensatable') {
        const compensated: number[] = []
        for (let index = completed.length - 1; index >= 0; index -= 1) {
          await this.compensateStep(plan.steps[index], completed[index], context)
          compensated.push(index)
        }
        throw new Error(`COMPENSATED_FAILURE:${compensated.join(',')}:${error instanceof Error ? error.message : String(error)}`)
      }
      throw new Error(`PARTIAL_FAILURE:${completed.length}:${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async preflightPlan(
    steps: ApplicationPlannedStep[],
    context: ApplicationExecutionContext
  ): Promise<void> {
    for (const step of steps) {
      if (step.kind === 'mutation') {
        const propertyIds = step.mutations.map((mutation) => mutation.propertyId)
        const availability = await this.registry.getPropertyAvailability(step.target, propertyIds, context)
        if (availability.some((item) => !item.writable)) throw new Error('PROPERTY_NOT_WRITABLE')
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
      return failure('EXECUTION_FAILED', '事务执行失败，已完成步骤均已补偿。', true, {
        transactionRef,
        partial: { completedStepIndexes: indexes, compensatedStepIndexes: indexes, uncompensatedStepIndexes: [] },
      })
    }
    const partial = /^PARTIAL_FAILURE:(\d+):/.exec(message)
    if (partial) {
      const count = Number(partial[1])
      const indexes = Array.from({ length: count }, (_, index) => index)
      return failure('EXECUTION_FAILED', '事务执行失败，部分步骤已完成且未补偿。', false, {
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
    if (message.includes('PERMISSION_DENIED') || message.includes('PROPERTY_NOT_WRITABLE')) {
      return failure('PERMISSION_DENIED', '提交时权限或属性可写状态已变化。', true, { transactionRef })
    }
    if (message.includes('NOT_FOUND')) return failure('NOT_FOUND', '计划引用的对象不存在。', true, { transactionRef })
    if (message === 'CANCELLED') return failure('CANCELLED', '操作已取消。', false, { transactionRef })
    return failure('EXECUTION_FAILED', '应用事务执行失败。', false, { transactionRef })
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
