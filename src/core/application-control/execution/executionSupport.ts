import type { ApplicationChangePlan, ApplicationPlannedStep, ApplicationEffectReceipt, ApplicationTransactionMode, ApplicationEvidence } from '../transactions'
import type { ApplicationReflectionRegistry } from '../registry'
import { assertCollectionOperationAvailable } from './availability'
import { ApplicationExecutionProgressFailure, ApplicationPersistenceBoundaryFailure } from './persistence'
import type { ApplicationMutationExecutor, ApplicationCollectionExecutor, ApplicationSemanticOperationExecutor, ApplicationControlExecutionDependencies, ApplicationExecutionContext, ApplicationCompletedStepResult, ApplicationStepExecutionResult } from './types'
import { resolveUndoExpectedAbsentMutations } from './undoRevisionProbe'

function refKey(ref: { kind: string; id: string }): string { return `${ref.kind}\u0000${ref.id}` }
function mergeRevisions(target: Record<string, number>, source: Record<string, number>): void {
  for (const [scope, revision] of Object.entries(source)) target[scope] = revision
}

/** 执行器路由、提交前校验及 Effect 契约；生命周期由 engine 唯一编排。 */
export class ApplicationExecutionSupport {
  protected readonly mutationExecutors = new Map<string, ApplicationMutationExecutor>()
  protected readonly collectionExecutors = new Map<string, ApplicationCollectionExecutor>()
  protected readonly operationExecutors = new Map<string, ApplicationSemanticOperationExecutor>()
  constructor(protected readonly registry: ApplicationReflectionRegistry,
    protected readonly describeCollectionWriters?: ApplicationControlExecutionDependencies['describeCollectionWriters']) {}
  protected affectedScopes(steps: readonly ApplicationPlannedStep[]): string[] {
    const scopes = new Set<string>()
    for (const step of steps) {
      Object.keys(step.expectedRevisions).forEach((scope) => scopes.add(scope))
      const executor = step.kind === 'mutation' ? this.mutationExecutors.get(step.entityType)
        : step.kind === 'collection' ? this.collectionExecutors.get(step.entityType)
          : this.getOperationExecutor(step.capabilityId, step.capabilityVersion)
      for (const effect of [...(executor?.effectContract.direct ?? []), ...(executor?.effectContract.cascades ?? [])]) {
        effect.revisionScopes.forEach((scope) => scopes.add(scope))
      }
      if (step.kind === 'operation') continue
      this.registry.getEntity(step.entityType)?.revisionScopes.forEach((scope) => scopes.add(scope))
      if (step.kind === 'collection') this.registry.getEntity(step.parent.kind)?.revisionScopes.forEach((scope) => scopes.add(scope))
      else for (const mutation of step.mutations) {
        this.registry.getProperty(mutation.propertyId)?.revisionScopes.forEach((scope) => scopes.add(scope))
      }
    }
    return [...scopes]
  }
  /** 撤销检查写权限，不把原集合动作的动态 availability 当成反向动作的准入。 */
  protected async assertUndoPermissions(steps: readonly ApplicationPlannedStep[], context: ApplicationExecutionContext): Promise<() => void> {
    const permissions = new Set<string>()
    for (const step of steps) {
      const required = step.kind === 'operation' ? this.requireOperationExecutor(step).requiredPermissions
        : step.kind === 'mutation' ? step.mutations.flatMap((mutation) => this.registry.getProperty(mutation.propertyId)?.requiredPermissions.write ?? [])
          : (await this.registry.getCollectionAvailability(step.parent, step.entityType, context))[
            step.operation.kind === 'create' ? 'remove' : 'create'].requiredPermissions
      if (step.kind === 'mutation' && step.mutations.some((mutation) => {
        const descriptor = this.registry.getProperty(mutation.propertyId)
        return !descriptor || Boolean(descriptor.readOnlyReason)
      })) throw new Error('PERMISSION_DENIED:撤销所需属性不再可写')
      if (required.some((permission) => !context.permissions.has(permission))) throw new Error('PERMISSION_DENIED:撤销需要原操作的写入权限')
      required.forEach((permission) => permissions.add(permission))
    }
    return () => { if ([...permissions].some((permission) => !context.permissions.has(permission))) throw new Error('PERMISSION_DENIED:撤销写入权限已变化') }
  }
  protected collectEffects(
    steps: ApplicationPlannedStep[],
    results: ApplicationCompletedStepResult[],
    direction: 'commit' | 'undo' = 'commit',
  ): ApplicationEffectReceipt[] {
    return results.flatMap((result, index) => {
      const step = steps[index]
      if (!step) throw new Error('EFFECT_STEP_RESULT_MISMATCH')
      const executor = step.kind === 'mutation'
        ? this.mutationExecutors.get(step.entityType)
        : step.kind === 'collection'
          ? this.collectionExecutors.get(step.entityType)
          : this.getOperationExecutor(step.capabilityId, step.capabilityVersion)
      if (!executor) throw new Error('EFFECT_EXECUTOR_NOT_FOUND')
      const declarations = new Map(executor.effectContract.cascades.map((item) => [item.declarationId, item]))
      for (const effect of result.cascadeEffects ?? []) {
        if (effect.origin.kind !== 'cascade') throw new Error('CASCADE_EFFECT_ORIGIN_INVALID')
        const declaration = declarations.get(effect.origin.declarationId)
        if (!declaration
          || declaration.effect !== effect.effect
          || declaration.entityType !== effect.entityType
          || declaration.propertyIds.some((propertyId) => !effect.propertyIds.includes(propertyId))) {
          throw new Error(`UNDECLARED_CASCADE_EFFECT:${effect.origin.declarationId}`)
        }
      }
      const direct = step.kind === 'mutation'
        ? [{
            effect: 'update' as const,
            entityType: step.entityType,
            refs: result.directRefs,
            propertyIds: step.mutations.map((mutation) => mutation.propertyId),
            origin: { kind: 'direct' as const },
          }]
        : step.kind === 'collection'
          ? [{
              // 只反转引擎已知的集合动作；算法及级联使用 undo 返回的实际声明事实。
              effect: (step.operation.kind === 'create') !== (direction === 'undo') ? 'create' as const : 'delete' as const,
              entityType: step.entityType,
              refs: result.directRefs,
              propertyIds: [],
              origin: { kind: 'direct' as const },
            }]
          : result.directEffects ?? []
      this.assertDirectRefs(step, direct)
      return [...direct, ...(result.cascadeEffects ?? [])]
    })
  }

  protected assertDirectRefs(step: ApplicationPlannedStep, effects: ApplicationEffectReceipt[]): void {
    if (step.kind === 'operation') {
      if (effects.length === 0) throw new Error(`DIRECT_EFFECT_REQUIRED:${step.capabilityId}`)
      return
    }
    const refs = effects.flatMap((effect) => effect.refs)
    if (refs.some((ref) => ref.kind !== step.entityType)) throw new Error('DIRECT_EFFECT_REF_KIND_MISMATCH')
    if (step.kind === 'mutation') {
      const expected = refKey(step.target)
      if (refs.length !== 1 || refKey(refs[0]) !== expected) throw new Error('DIRECT_EFFECT_REF_MISMATCH')
      return
    }
    const expectedCount = step.operation.kind === 'create'
      ? step.operation.items.length
      : step.operation.targets.length
    if (refs.length !== expectedCount) throw new Error('DIRECT_EFFECT_REF_COUNT_MISMATCH')
    if (step.operation.kind === 'remove') {
      const actual = new Set(refs.map(refKey))
      if (step.operation.targets.some((target) => !actual.has(refKey(target)))) {
        throw new Error('DIRECT_EFFECT_REF_MISMATCH')
      }
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
  protected assertCompensable(steps: ApplicationPlannedStep[], mode: ApplicationTransactionMode): void {
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
  protected async assertCollectionAllowed(
    step: Extract<ApplicationPlannedStep, { kind: 'collection' }>,
    context: ApplicationExecutionContext,
    previousSteps: ApplicationPlannedStep[] = [],
  ): Promise<void> {
    const descriptor = this.registry.describe({ entityTypes: [step.entityType] }, context).entities[0]
    if (!descriptor) {
      // 与 registry.requireEntity 同一条道理：只说"没找到"，调用方无从知道正确的叫什么。
      const available = this.registry.describe({}, context).entities.map((entity) => entity.id)
      const domain = step.entityType.split('.')[0] ?? ''
      const sameDomain = domain.length >= 3
        ? available.filter((candidate) => candidate.startsWith(`${domain}.`))
        : []
      const listed = (sameDomain.length > 0 ? sameDomain : available).slice(0, 32)
      throw new Error(
        `ENTITY_TYPE_NOT_FOUND:${step.entityType}`
        + (listed.length > 0 ? `（可用实体类型：${listed.join('、')}）` : '')
      )
    }
    const rule = descriptor.collectionWrite
    const operation = step.operation.kind === 'create' ? 'create' : 'remove'
    if (!rule) {
      throw new Error(
        `COLLECTION_WRITE_NOT_DECLARED:${step.entityType} 未声明可增删${this.collectionWriterHint(step.entityType, operation)}`
      )
    }
    const availability = await this.registry.getCollectionAvailability(step.parent, step.entityType, context)
    const current = availability[operation]
    const previousEffects = this.potentialEffects(previousSteps)
    const stateBlocks = (current.blocks ?? []).filter((block) => block.kind === 'state')
    const canDependOnPreviousSteps = !current.available && stateBlocks.length > 0
      && stateBlocks.every((block) => previousEffects.some((effect) => (
        block.affectedEntityTypes.includes(effect.entityType)
        && (effect.revisionScopes.length === 0
          || block.revisionScopes.some((scope) => effect.revisionScopes.includes(scope)))
      )))
    if (!current.available && !canDependOnPreviousSteps) {
      assertCollectionOperationAvailable(availability, operation)
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
  protected collectionWriterHint(entityType: string, operation: 'create' | 'remove'): string {
    const writers = this.describeCollectionWriters?.(entityType, operation) ?? []
    if (writers.length === 0) return ''
    return `；${operation === 'create' ? '创建' : '删除'}这类实体走专用能力：${writers.join('、')}`
  }

  protected async preflightPlan(
    steps: ApplicationPlannedStep[],
    context: ApplicationExecutionContext,
    mode: ApplicationTransactionMode
  ): Promise<void> {
    this.assertCompensable(steps, mode)
    for (const [stepIndex, step] of steps.entries()) {
      if (step.kind === 'mutation') {
        const propertyIds = step.mutations.map((mutation) => mutation.propertyId)
        const availability = await this.registry.getPropertyAvailability(step.target, propertyIds, context)
        const blocked = availability.filter((item) => !item.writable)
        const dynamicallyDeferred = stepIndex > 0 && blocked.every((item) => {
          const descriptor = this.registry.getProperty(item.propertyId)
          const stateBlocks = (item.blocks ?? []).filter((block) => block.kind === 'state')
          const previousEffects = this.potentialEffects(steps.slice(0, stepIndex))
          return descriptor !== undefined
            && !descriptor.readOnlyReason
            && descriptor.requiredPermissions.write.every((permission) => context.permissions.has(permission))
            && stateBlocks.length > 0
            && stateBlocks.every((block) => previousEffects.some((effect) => (
              block.affectedEntityTypes.includes(effect.entityType)
              && (effect.revisionScopes.length === 0
                || block.revisionScopes.some((scope) => effect.revisionScopes.includes(scope)))
            )))
        })
        if (blocked.length > 0 && !dynamicallyDeferred) {
          // 带上是哪几条、为什么：只说"不可写"会让一个本可自纠的失败变成任务中断。
          throw new Error(`PROPERTY_NOT_WRITABLE:${blocked
            .map((item) => `${item.propertyId}（${item.reasons.join('；') || '无写权限'}）`)
            .join('、')}`)
        }
        continue
      }
      if (step.kind === 'collection') {
        await this.assertCollectionAllowed(step, context, steps.slice(0, stepIndex))
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

  protected potentialEffects(steps: ApplicationPlannedStep[]) {
    return steps.flatMap((step) => {
      if (step.kind === 'mutation') {
        const contract = this.mutationExecutors.get(step.entityType)?.effectContract
        return [{ entityType: step.entityType, revisionScopes: [] as readonly string[] }, ...(contract?.cascades ?? [])]
      }
      if (step.kind === 'collection') return [{ entityType: step.entityType, revisionScopes: [] as readonly string[] }]
      const contract = this.getOperationExecutor(step.capabilityId, step.capabilityVersion)?.effectContract
      return [...(contract?.direct ?? []), ...(contract?.cascades ?? [])]
    })
  }

  protected async executeStep(
    step: ApplicationPlannedStep,
    context: ApplicationExecutionContext
  ): Promise<ApplicationStepExecutionResult> {
    if (step.kind === 'mutation') {
      const propertyIds = step.mutations.map((mutation) => mutation.propertyId)
      const availability = await this.registry.getPropertyAvailability(step.target, propertyIds, context)
      const blocked = availability.filter((item) => !item.writable)
      if (blocked.length > 0) {
        throw new Error(`PROPERTY_NOT_WRITABLE:${blocked
          .map((item) => `${item.propertyId}（${item.reasons.join('；') || '无写权限'}）`)
          .join('、')}`)
      }
      const executor = this.mutationExecutors.get(step.entityType)
      if (!executor) throw new Error(`MUTATION_EXECUTOR_NOT_FOUND:${step.entityType}`)
      return await executor.apply(step, context)
    }
    if (step.kind === 'collection') {
      await this.assertCollectionAllowed(step, context)
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

  protected async readCurrentRevisions(
    steps: ApplicationPlannedStep[],
    context: ApplicationExecutionContext
  ): Promise<Record<string, number>> {
    const revisions: Record<string, number> = {}
    for (const step of steps) {
      const current = step.kind === 'mutation'
        ? (await this.registry.readEntity(step.target, [], context)).revisions
        : step.kind === 'collection'
          ? this.registry.describe({ entityTypes: [step.entityType] }, context).entities[0]?.collectionWrite
            ? (await this.registry.getCollectionAvailability(step.parent, step.entityType, context)).revisions
            : (await this.registry.readEntity(step.parent, [], context)).revisions
          : await this.requireOperationExecutor(step).getCurrentRevisions(step.input)
      mergeRevisions(revisions, current)
    }
    return revisions
  }

  /** 撤销的最终世界可能合法缺少先改后删的实体；只用同记录 direct remove 的父集合作权威 probe。 */
  protected async readUndoCurrentRevisions(
    steps: ApplicationPlannedStep[],
    results: ApplicationCompletedStepResult[],
    context: ApplicationExecutionContext,
  ): Promise<Record<string, number>> {
    const absentMutations = resolveUndoExpectedAbsentMutations(steps, results)
    const revisions: Record<string, number> = {}
    const removalProbes = new Map<number, Record<string, number>>()
    const removalIndexes = new Set(absentMutations.values())
    for (let index = 0; index < steps.length; index += 1) {
      if (absentMutations.has(index)) continue
      const current = await this.readCurrentRevisions([steps[index]], context)
      mergeRevisions(revisions, current)
      if (removalIndexes.has(index)) removalProbes.set(index, current)
    }
    for (const [mutationIndex, removalIndex] of absentMutations) {
      const anchor = removalProbes.get(removalIndex) ?? {}
      for (const scope of this.affectedScopes([steps[mutationIndex]])) {
        if (anchor[scope] === undefined) {
          throw new Error(`REVISION_CONFLICT:UNDO_SCOPE_NOT_COVERED:${scope}`)
        }
      }
    }
    return revisions
  }


  protected async undoStep(
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

  protected async compensateStep(
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


  protected requireOperationExecutor(
    step: Extract<ApplicationPlannedStep, { kind: 'operation' }>
  ): ApplicationSemanticOperationExecutor {
    const executor = this.getOperationExecutor(step.capabilityId, step.capabilityVersion)
    if (!executor) throw new Error(`OPERATION_EXECUTOR_NOT_FOUND:${step.capabilityId}`)
    return executor
  }

  protected getOperationExecutor(
    capabilityId: string,
    version: number
  ): ApplicationSemanticOperationExecutor | undefined {
    return this.operationExecutors.get(this.operationKey(capabilityId, version))
  }

  protected operationKey(capabilityId: string, version: number): string {
    return `${capabilityId}@${version}`
  }
  protected async executePlan(
    plan: ApplicationChangePlan,
    context: ApplicationExecutionContext
  ): Promise<{ completed: ApplicationCompletedStepResult[]; deferred?: Exclude<ApplicationStepExecutionResult, { status: 'completed' }> }> {
    if (plan.transactionMode === 'atomic' && plan.steps.length > 1) {
      const steps = plan.steps as Array<Extract<ApplicationPlannedStep, { kind: 'mutation' }>>
      const executor = this.mutationExecutors.get(steps[0].entityType)
      if (!executor?.applyAtomic) throw new Error('ATOMIC_GROUP_NOT_SUPPORTED')
      const results = await executor.applyAtomic(steps, context)
      try {
        this.collectEffects(steps, results)
      } catch (error) {
        const compensated: number[] = []
        for (let index = results.length - 1; index >= 0; index -= 1) {
          try { await this.compensateStep(steps[index], results[index], context); compensated.push(index) }
          catch (cause) {
            throw new ApplicationExecutionProgressFailure(
              `${String(error)}；补偿失败：${String(cause)}`, results, compensated, error)
          }
        }
        throw new ApplicationExecutionProgressFailure(String(error), results, compensated, error)
      }
      return { completed: results }
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
        this.collectEffects([step], [result])
      }
      return { completed }
    } catch (error) {
      if (error instanceof ApplicationPersistenceBoundaryFailure) {
        // 失败的单步已发生部分修改；保留其正式事实，不能降成零步骤失败或重放。
        const offset = completed.length
        throw new ApplicationPersistenceBoundaryFailure(error.failure, [...completed, ...error.completed], undefined,
          error.receipts, [...completed.map((_, index) => index), ...error.completedStepIndexes.map((index) => offset + index)])
      }
      const original = error instanceof Error ? error.message : String(error)
      const executionFailure = (message: string, compensated: number[] = []) =>
        new ApplicationExecutionProgressFailure(message, completed, compensated, error)
      // `atomic` 也必须补偿。此前只有 `compensatable` 走补偿，于是声明 atomic 的计划失败后
      // 把已完成的步骤原样留在应用里，却对调用方自称"事务"——三维布置就是这么留下一个
      // 压在立方体上的圆柱体的。只有 `non_reversible` 才允许不补偿，那是它的字面语义。
      if (plan.transactionMode === 'non_reversible') {
        throw executionFailure(`PARTIAL_FAILURE:${completed.length}:${original}`)
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
          throw executionFailure(
            `PARTIAL_FAILURE:${completed.length}:${original}（补偿在第 ${index} 步失败：${detail}）`, compensated,
          )
        }
      }
      throw executionFailure(`COMPENSATED_FAILURE:${compensated.join(',')}:${original}`, compensated)
    }
  }

}
