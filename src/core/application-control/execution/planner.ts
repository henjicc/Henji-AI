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
    const verificationConditions: ApplicationVerificationCondition[] = [
      ...(request.verificationConditions ?? []),
    ]

    for (const step of request.steps) {
      if (step.kind === 'mutation') {
        const prepared = await this.prepareMutation(step, context)
        normalizedSteps.push(prepared.step)
        verificationConditions.push(...prepared.conditions)
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
      contractVersion: 'application-control/v1',
      planRef: this.dependencies.createPlanRef(),
      summary: request.summary.trim(),
      risk,
      requiresApproval: RISK_RANK[risk] >= RISK_RANK.R2,
      atomic: request.transactionMode === 'atomic',
      transactionMode: request.transactionMode,
      steps: normalizedSteps,
      verificationConditions,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiresInMs).toISOString(),
    })
  }

  private async prepareMutation(
    step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>,
    context: ApplicationExecutionContext
  ): Promise<{
    step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>
    conditions: ApplicationVerificationCondition[]
  }> {
    if (!this.dependencies.getMutationExecutor(step.entityType)) {
      throw new Error(`MUTATION_EXECUTOR_NOT_FOUND:${step.entityType}`)
    }
    const propertyIds = step.mutations.map((mutation) => mutation.propertyId)
    if (new Set(propertyIds).size !== propertyIds.length) throw new Error('DUPLICATE_PROPERTY_MUTATION')
    const snapshot = await this.dependencies.registry.readEntity(step.target, propertyIds, context)
    const scopes = new Set<string>()
    for (const propertyId of propertyIds) {
      const descriptor = this.dependencies.registry.getProperty(propertyId)
      if (!descriptor || descriptor.entityType !== step.entityType) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      descriptor.revisionScopes.forEach((scope) => scopes.add(scope))
    }
    assertRevisions(step.expectedRevisions, snapshot.revisions, [...scopes])
    const availability = new Map((await this.dependencies.registry.getPropertyAvailability(
      step.target,
      propertyIds,
      context
    )).map((item) => [item.propertyId, item]))
    const conditions: ApplicationVerificationCondition[] = []
    const mutations = step.mutations.map((mutation) => {
      if (!availability.get(mutation.propertyId)?.writable) {
        throw new Error(`PROPERTY_NOT_WRITABLE:${mutation.propertyId}`)
      }
      const resultingValue = this.dependencies.registry.normalizePropertyValue(
        step.entityType,
        mutation.propertyId,
        applyMutation(snapshot.properties[mutation.propertyId], mutation),
        context
      )
      conditions.push({
        kind: 'property_equals',
        target: step.target,
        propertyId: mutation.propertyId,
        expected: resultingValue,
      })
      return mutation.operation === 'set' || mutation.operation === 'clear'
        ? { ...mutation, value: mutation.operation === 'set' ? resultingValue : undefined }
        : mutation
    })
    return { step: { ...step, mutations }, conditions }
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
        const executor = step.kind === 'mutation'
          ? this.dependencies.getMutationExecutor(step.entityType)
          : this.dependencies.getOperationExecutor(step.capabilityId, step.capabilityVersion)
        if (!executor?.compensate) throw new Error('COMPENSATION_NOT_SUPPORTED')
      }
    }
  }
}
