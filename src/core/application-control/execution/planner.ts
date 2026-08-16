import {
  applicationChangePlanSchema,
  type ApplicationChangePlan,
  type ApplicationPlannedStep,
  type ApplicationPropertyMutation,
  type ApplicationVerificationCondition,
} from '../transactions'
import type { ApplicationReflectionRegistry } from '../registry'
import type { JsonValue } from '../identifiers'
import type {
  ApplicationExecutionContext,
  ApplicationMutationExecutor,
  ApplicationPlanRequest,
  ApplicationRisk,
  ApplicationSemanticOperationExecutor,
} from './types'
import { assertCollectionOperationAvailable } from './availability'
import { acceptedPropertyOperations } from './writerTable'

const RISK_RANK: Record<ApplicationRisk, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 }

function highestRisk(left: ApplicationRisk, right: ApplicationRisk): ApplicationRisk {
  return RISK_RANK[left] >= RISK_RANK[right] ? left : right
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function applyMutation(current: JsonValue | undefined, mutation: ApplicationPropertyMutation): JsonValue {
  if (mutation.operation === 'set') return mutation.value as JsonValue
  if (mutation.operation === 'clear') return null
  if (!Array.isArray(current)) throw new Error(`INVALID_MUTATION_OPERATION:${mutation.propertyId}`)
  if (mutation.operation === 'append') return [...current, mutation.value as JsonValue]
  const index = current.findIndex((item) => jsonEqual(item, mutation.value as JsonValue))
  if (index < 0) throw new Error(`MUTATION_VALUE_NOT_FOUND:${mutation.propertyId}`)
  return current.filter((_, itemIndex) => itemIndex !== index)
}

function lowerReplaceListMutation(
  current: JsonValue | undefined,
  desired: JsonValue,
  propertyId: string,
): ApplicationPropertyMutation[] {
  if (!Array.isArray(current) || !Array.isArray(desired)) {
    throw new Error(`PROPERTY_OPERATION_NOT_SUPPORTED:${propertyId} 的 set 仅能替换引用列表。`)
  }
  const removals = current
    .filter((item) => !desired.some((candidate) => jsonEqual(candidate, item)))
    .map((value) => ({ propertyId, operation: 'remove' as const, value }))
  const additions = desired
    .filter((item) => !current.some((candidate) => jsonEqual(candidate, item)))
    .map((value) => ({ propertyId, operation: 'append' as const, value }))
  return [...removals, ...additions]
}

/**
 * 同一事务可以按顺序多次写同一个属性，中间值是过程，不是最终世界状态。
 * 验证器只应检查最后一次写入；否则 `seek(0) → seek(1) → seek(2)` 会被要求在提交后
 * 同时等于 0、1、2，事务明明执行成功也必然被判失败。
 */
function finalVerificationConditions(
  conditions: ApplicationVerificationCondition[],
): ApplicationVerificationCondition[] {
  const lastPropertyCondition = new Map<string, number>()
  conditions.forEach((condition, index) => {
    if (condition.kind !== 'property_equals') return
    lastPropertyCondition.set(
      `${condition.target.kind}\u0000${condition.target.id}\u0000${condition.propertyId}`,
      index,
    )
  })
  return conditions.filter((condition, index) => {
    if (condition.kind !== 'property_equals') return true
    return lastPropertyCondition.get(
      `${condition.target.kind}\u0000${condition.target.id}\u0000${condition.propertyId}`,
    ) === index
  })
}

/**
 * A property write followed by deletion of the same entity is an intermediate
 * state, not a final-state invariant. The executor receipts still record both
 * operations, but the final verifier must not require the deleted entity to be
 * readable. Only planner-generated property checks are filtered here; explicit
 * caller verification conditions remain authoritative (and contradictory
 * requests therefore still fail).
 */
function omitGeneratedConditionsSupersededByRemoval(
  conditions: ApplicationVerificationCondition[],
  steps: readonly ApplicationPlannedStep[],
): ApplicationVerificationCondition[] {
  const finallyRemoved = new Set<string>()
  for (const step of steps) {
    if (step.kind === 'mutation') {
      finallyRemoved.delete(`${step.target.kind}\u0000${step.target.id}`)
      continue
    }
    if (step.kind !== 'collection') continue
    if (step.operation.kind === 'remove') {
      step.operation.targets.forEach((target) => {
        finallyRemoved.add(`${target.kind}\u0000${target.id}`)
      })
    }
  }
  return conditions.filter((condition) => (
    condition.kind !== 'property_equals'
    || !finallyRemoved.has(`${condition.target.kind}\u0000${condition.target.id}`)
  ))
}

function assertRevisions(
  expected: Record<string, number>,
  current: Record<string, number>,
  requiredScopes: string[]
): void {
  for (const scope of requiredScopes) {
    if (expected[scope] === undefined) throw new Error(`EXPECTED_REVISION_REQUIRED:${scope}`)
    if (current[scope] !== expected[scope]) {
      throw new Error(`REVISION_CONFLICT:${scope}:${expected[scope]}/${current[scope]}`)
    }
  }
}

function stateBlocksCanBeSatisfied(
  blocks: readonly { kind: string; affectedEntityTypes?: string[]; revisionScopes?: string[] }[],
  earlierSteps: readonly ApplicationPlannedStep[],
  getMutationExecutor: (entityType: string) => ApplicationMutationExecutor | undefined,
  getOperationExecutor: ApplicationPlanBuilderDependencies['getOperationExecutor'],
): boolean {
  const stateBlocks = blocks.filter((block) => block.kind === 'state')
  if (stateBlocks.length === 0) return false
  const impacts = earlierSteps.flatMap((step) => {
    if (step.kind === 'mutation') {
      const contract = getMutationExecutor(step.entityType)?.effectContract
      return [
        { entityType: step.entityType, revisionScopes: [] as readonly string[] },
        ...(contract?.cascades ?? []),
      ]
    }
    if (step.kind === 'collection') return [{ entityType: step.entityType, revisionScopes: [] as readonly string[] }]
    const contract = getOperationExecutor(step.capabilityId, step.capabilityVersion)?.effectContract
    return [...(contract?.direct ?? []), ...(contract?.cascades ?? [])]
  })
  return stateBlocks.every((block) => impacts.some((impact) => (
    (block.affectedEntityTypes?.length ?? 0) === 0
      || block.affectedEntityTypes?.includes(impact.entityType)
  ) && (
    (block.revisionScopes?.length ?? 0) === 0
      || impact.revisionScopes.length === 0
      || block.revisionScopes?.some((scope) => impact.revisionScopes.includes(scope))
  )))
}

export interface ApplicationPlanBuilderDependencies {
  registry: ApplicationReflectionRegistry
  now: () => Date
  createPlanRef: () => string
  getMutationExecutor: (entityType: string) => ApplicationMutationExecutor | undefined
  getOperationExecutor: (
    capabilityId: string,
    capabilityVersion: number
  ) => ApplicationSemanticOperationExecutor | undefined
}

export class ApplicationPlanBuilder {
  constructor(private readonly dependencies: ApplicationPlanBuilderDependencies) {}

  async build(
    request: ApplicationPlanRequest,
    context: ApplicationExecutionContext
  ): Promise<ApplicationChangePlan> {
    if (!request.summary.trim()) throw new Error('PLAN_SUMMARY_REQUIRED')
    if (request.steps.length === 0 || request.steps.length > 256) throw new Error('INVALID_PLAN_STEPS')
    let risk: ApplicationRisk = 'R0'
    const normalizedSteps: ApplicationPlannedStep[] = []
    const requestedVerificationConditions: ApplicationVerificationCondition[] = [
      ...(request.verificationConditions ?? []),
    ]
    const generatedVerificationConditions: ApplicationVerificationCondition[] = []

    for (const step of request.steps) {
      if (step.kind === 'mutation') {
        const prepared = await this.prepareMutation(step, context, normalizedSteps)
        normalizedSteps.push(prepared.step)
        generatedVerificationConditions.push(...prepared.conditions)
        risk = highestRisk(risk, 'R1')
      } else if (step.kind === 'collection') {
        const descriptor = this.dependencies.registry.describe(
          { entityTypes: [step.entityType] }, context,
        ).entities[0]
        /*
         * 静态未声明沿用 commit 的失败报告路径，它会附上目录派生的专用能力 recovery；
         * 只有结构上支持的集合才查询动态状态并在计划阶段尽早拒绝。
         */
        let revisions: Record<string, number>
        if (descriptor?.collectionWrite) {
          const availability = await this.dependencies.registry.getCollectionAvailability(
            step.parent, step.entityType, context,
          )
          const current = availability[step.operation.kind]
          if (!current.available && !stateBlocksCanBeSatisfied(
            current.blocks ?? [], normalizedSteps,
            this.dependencies.getMutationExecutor, this.dependencies.getOperationExecutor,
          )) {
            assertCollectionOperationAvailable(availability, step.operation.kind)
          }
          revisions = availability.revisions
        } else {
          revisions = (await this.dependencies.registry.readEntity(step.parent, [], context)).revisions
        }
        assertRevisions(step.expectedRevisions, revisions, Object.keys(revisions))
        normalizedSteps.push(step)
        if (step.operation.kind === 'remove') {
          generatedVerificationConditions.push(...step.operation.targets.map((target) => ({
            kind: 'entity_absent' as const,
            target,
          })))
        }
        risk = highestRisk(risk, 'R1')
      } else {
        const executor = this.dependencies.getOperationExecutor(step.capabilityId, step.capabilityVersion)
        if (!executor) throw new Error(`OPERATION_EXECUTOR_NOT_FOUND:${step.capabilityId}`)
        if (!executor.requiredPermissions.every((permission) => context.permissions.has(permission))) {
          throw new Error(`PERMISSION_DENIED:${step.capabilityId}`)
        }
        const input = executor.normalizeInput(step.input)
        const revisions = await executor.getCurrentRevisions(input)
        assertRevisions(step.expectedRevisions, revisions, Object.keys(revisions))
        normalizedSteps.push({ ...step, input })
        risk = highestRisk(risk, executor.risk)
      }
    }
    this.assertTransactionMode(request.transactionMode, normalizedSteps)
    const now = this.dependencies.now()
    const expiresInMs = request.expiresInMs ?? 10 * 60 * 1_000
    if (!Number.isInteger(expiresInMs) || expiresInMs < 1_000 || expiresInMs > 60 * 60 * 1_000) {
      throw new Error('INVALID_PLAN_EXPIRY')
    }
    return applicationChangePlanSchema.parse({
      contractVersion: 'application-control/v2',
      planRef: this.dependencies.createPlanRef(),
      summary: request.summary.trim(),
      risk,
      requiresApproval: RISK_RANK[risk] >= RISK_RANK.R2,
      atomic: request.transactionMode === 'atomic',
      transactionMode: request.transactionMode,
      steps: normalizedSteps,
      verificationConditions: finalVerificationConditions([
        ...requestedVerificationConditions,
        ...omitGeneratedConditionsSupersededByRemoval(generatedVerificationConditions, normalizedSteps),
      ]),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiresInMs).toISOString(),
    })
  }

  private async prepareMutation(
    step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>,
    context: ApplicationExecutionContext,
    earlierSteps: readonly ApplicationPlannedStep[],
  ): Promise<{
    step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>
    conditions: ApplicationVerificationCondition[]
  }> {
    const executor = this.dependencies.getMutationExecutor(step.entityType)
    if (!executor) {
      throw new Error(`MUTATION_EXECUTOR_NOT_FOUND:${step.entityType}`)
    }
    const propertyIds = step.mutations.map((mutation) => mutation.propertyId)
    if (new Set(propertyIds).size !== propertyIds.length) throw new Error('DUPLICATE_PROPERTY_MUTATION')
    const snapshot = await this.dependencies.registry.readEntity(step.target, propertyIds, context)
    const scopes = new Set<string>()
    for (const propertyId of propertyIds) {
      const descriptor = this.dependencies.registry.getProperty(propertyId)
      if (!descriptor || descriptor.entityType !== step.entityType) {
        /*
         * 走注册表那条同样的报错，好拿到「这个实体有哪些属性」的清单。
         *
         * 属性写错名是通用写入最高频的摩擦：模型手里只有一个错误码时只能一次次猜，实测连猜
         * 三次都没对。descriptor 存在但属于别的实体也走这里——那句「可用属性」正好点破它
         * 把 shot 的属性写到了 object 上。
         */
        throw new Error(
          `PROPERTY_NOT_FOUND:${propertyId}`
          + `（${step.entityType} 可用属性：${this.dependencies.registry
            .listProperties(step.entityType).map((item) => item.id).slice(0, 24).join('、')}`
          + '；属性 id 必须写完整，含实体类型前缀）'
        )
      }
      descriptor.revisionScopes.forEach((scope) => scopes.add(scope))
    }
    assertRevisions(step.expectedRevisions, snapshot.revisions, [...scopes])
    // provider 可以把当前工程内唯一的短引用规范化成完整稳定引用。计划及后续执行必须使用
    // snapshot.ref，否则计划阶段虽然读到了实体，执行器仍会收到模型截断的 id 而失败。
    const normalizedTarget = snapshot.ref
    const availability = new Map((await this.dependencies.registry.getPropertyAvailability(
      normalizedTarget,
      propertyIds,
      context
    )).map((item) => [item.propertyId, item]))
    const conditions: ApplicationVerificationCondition[] = []
    const mutations = step.mutations.flatMap((mutation) => {
      const propertyAvailability = availability.get(mutation.propertyId)
      const descriptor = this.dependencies.registry.getProperty(mutation.propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${mutation.propertyId}`)
      const staticallyWritable = !descriptor.readOnlyReason
        && descriptor.requiredPermissions.write.every((permission) => context.permissions.has(permission))
      const canDependOnEarlierSteps = propertyAvailability
        ? stateBlocksCanBeSatisfied(
            propertyAvailability.blocks ?? [], earlierSteps,
            this.dependencies.getMutationExecutor, this.dependencies.getOperationExecutor,
          )
        : false
      if (!propertyAvailability?.writable && !(staticallyWritable && canDependOnEarlierSteps)) {
        /*
         * 把 reasons 一并抛出去。
         *
         * 只报一句 `PROPERTY_NOT_WRITABLE:<id>` 是死胡同：模型不知道是权限、是这个属性有意
         * 只读、还是当前状态下暂时不可写，于是只能推断"应用不支持改这个"，最后变成一次凭空
         * 的能力否认。readOnlyReason 与 provider 给的动态原因本来就在手里，不给才是浪费。
         */
        const reasons = propertyAvailability?.reasons ?? []
        throw new Error(
          `PROPERTY_NOT_WRITABLE:${mutation.propertyId}${reasons.length > 0 ? `（${reasons.join('；')}）` : ''}`
        )
      }
      const currentValue = snapshot.properties[mutation.propertyId]
      const resultingValue = this.dependencies.registry.normalizePropertyValue(
        step.entityType,
        mutation.propertyId,
        applyMutation(currentValue, mutation),
        context
      )
      if (descriptor.verificationStrategy !== 'execution') {
        conditions.push({
          kind: 'property_equals',
          target: normalizedTarget,
          propertyId: mutation.propertyId,
          expected: resultingValue,
        })
      }
      const writerOperations = executor.propertyOperations.get(mutation.propertyId)
      const accepted = acceptedPropertyOperations(writerOperations, descriptor.value.kind)
      if (!accepted.has(mutation.operation)) {
        throw new Error(
          `PROPERTY_OPERATION_NOT_SUPPORTED:${mutation.propertyId}`
          + ` 支持 ${[...accepted].join(' / ')} 操作，收到 ${mutation.operation}。`
        )
      }
      if (mutation.operation === 'set' && !writerOperations?.has('set')) {
        return lowerReplaceListMutation(currentValue, resultingValue, mutation.propertyId)
      }
      return [mutation.operation === 'set' || mutation.operation === 'clear'
        ? { ...mutation, value: mutation.operation === 'set' ? resultingValue : undefined }
        : mutation]
    })
    if (mutations.length === 0) throw new Error('NO_STATE_CHANGE')
    return { step: { ...step, target: normalizedTarget, mutations }, conditions }
  }

  private assertTransactionMode(
    mode: ApplicationPlanRequest['transactionMode'],
    steps: ApplicationPlannedStep[]
  ): void {
    if (steps.length <= 1) return
    if (mode === 'atomic') {
      if (!steps.every((step) => step.kind === 'mutation')) throw new Error('ATOMIC_GROUP_NOT_SUPPORTED')
      const entityTypes = new Set(steps.map((step) => step.entityType))
      const entityType = steps[0]?.kind === 'mutation' ? steps[0].entityType : ''
      const executor = this.dependencies.getMutationExecutor(entityType)
      if (entityTypes.size !== 1 || !executor?.applyAtomic) throw new Error('ATOMIC_GROUP_NOT_SUPPORTED')
    }
    if (mode === 'compensatable') {
      for (const step of steps) {
        // collection 步骤的补偿能力由引擎的 assertCompensable 统一判定：它拿得到集合执行器
        // 注册表，计划器拿不到，不要在这里再造一份判定。
        if (step.kind === 'collection') continue
        const executor = step.kind === 'mutation'
          ? this.dependencies.getMutationExecutor(step.entityType)
          : this.dependencies.getOperationExecutor(step.capabilityId, step.capabilityVersion)
        if (!executor?.compensate) throw new Error('COMPENSATION_NOT_SUPPORTED')
      }
    }
  }
}
