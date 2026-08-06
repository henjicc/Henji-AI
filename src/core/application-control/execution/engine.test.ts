import { describe, expect, it } from 'vitest'

import type { ApplicationEntityProvider, ApplicationEntityRegistration } from '../registry'
import { ApplicationReflectionRegistry } from '../registry'
import type { ApplicationPlannedStep } from '../transactions'
import {
  ApplicationControlExecutionEngine,
  type ApplicationExecutionContext,
  type ApplicationMutationExecutor,
} from './index'

const catalogVersion = 'application-capabilities/v2'
const digest = `sha256:${'c'.repeat(64)}`

function schemaRef(kind: 'entity' | 'property', id: string) {
  return { catalogVersion, kind, id, version: 1, digest } as const
}

interface Fixture {
  registry: ApplicationReflectionRegistry
  values: Map<string, number>
  revisions: { value: number }
  writable: { value: boolean }
}

function createFixture(): Fixture {
  const values = new Map([['one', 2], ['two', 4]])
  const revisions = { value: 0 }
  const writable = { value: true }
  const provider: ApplicationEntityProvider = {
    entityType: 'sample.item',
    async listEntities() {
      return {
        refs: [...values.keys()].map((id) => ({ kind: 'sample.item', id })),
        nextCursor: null,
        revisions: { 'sample.scope': revisions.value },
      }
    },
    async readEntity(ref) {
      const value = values.get(ref.id)
      if (value === undefined) throw new Error('NOT_FOUND')
      return {
        ref,
        entityType: 'sample.item',
        revisions: { 'sample.scope': revisions.value },
        properties: { 'sample.value': value },
        capturedAt: new Date().toISOString(),
      }
    },
    async getPropertyAvailability(_ref, propertyIds) {
      return propertyIds.map((propertyId) => ({
        propertyId,
        readable: true,
        writable: writable.value,
        reasons: writable.value ? [] : ['当前状态只读'],
        requiredPermissions: ['sample:read'],
        revisions: { 'sample.scope': revisions.value },
      }))
    },
  }
  const registration: ApplicationEntityRegistration = {
    entity: {
      id: 'sample.item',
      domain: 'sample',
      version: 1,
      title: '样例',
      description: '事务测试实体。',
      refKind: 'sample.item',
      dataClass: 'C1',
      exposures: ['assistant'],
      parentTypes: [],
      revisionScopes: ['sample.scope'],
      queryCapabilityIds: ['get_sample_item'],
      schemaRef: schemaRef('entity', 'sample.item'),
    },
    properties: [{
      id: 'sample.value',
      entityType: 'sample.item',
      version: 1,
      title: '数值',
      description: '0 到 10 的偶数。',
      value: { kind: 'integer', hardRange: { min: 0, max: 10, step: 2 } },
      nullable: false,
      dataClass: 'C1',
      exposures: ['assistant'],
      requiredPermissions: { read: ['sample:read'], write: ['sample:write'] },
      revisionScopes: ['sample.scope'],
      schemaRef: schemaRef('property', 'sample.value'),
    }],
    provider,
  }
  const registry = new ApplicationReflectionRegistry(catalogVersion)
  registry.register(registration)
  return { registry, values, revisions, writable }
}

class FixtureMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = 'sample.item'
  readonly writableProperties = new Set(['sample.item.value'])
  readonly propertyOperations = new Map([['sample.item.value', new Set(['set' as const])]])
  readonly undoValues = new Map<string, { id: string; value: number }>()
  failOnId?: string
  applyCount = 0
  atomicCount = 0

  constructor(private readonly fixture: Fixture) {}

  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>) {
    this.applyCount += 1
    if (step.target.id === this.failOnId) throw new Error('EXPECTED_FAILURE')
    const before = this.fixture.values.get(step.target.id)
    if (before === undefined) throw new Error('NOT_FOUND')
    const value = step.mutations[0].value
    if (typeof value !== 'number') throw new Error('INVALID_INPUT')
    this.fixture.values.set(step.target.id, value)
    this.fixture.revisions.value += 1
    const undoToken = `token:${step.target.id}:${this.applyCount}`
    this.undoValues.set(undoToken, { id: step.target.id, value: before })
    return {
      status: 'completed' as const,
      resultingRevisions: { 'sample.scope': this.fixture.revisions.value },
      producedRefs: [{ kind: 'sample.item', id: step.target.id, revision: this.fixture.revisions.value }],
      evidence: [{
        kind: 'property_value' as const,
        target: { kind: 'sample.item', id: step.target.id },
        fact: `实体 ${step.target.id} 已更新。`,
        data: value,
        capturedAt: new Date().toISOString(),
      }],
      undoToken,
    }
  }

  async applyAtomic(steps: Array<Extract<ApplicationPlannedStep, { kind: 'mutation' }>>) {
    this.atomicCount += 1
    const before = new Map(this.fixture.values)
    try {
      return await Promise.all(steps.map((step) => this.apply(step)))
    } catch (error) {
      this.fixture.values = before
      throw error
    }
  }

  async compensate(
    _step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>,
    result: Awaited<ReturnType<FixtureMutationExecutor['apply']>>
  ) {
    if (!result.undoToken) throw new Error('UNDO_NOT_SUPPORTED')
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string) {
    const entry = this.undoValues.get(undoToken)
    if (!entry) throw new Error('NOT_FOUND')
    this.fixture.values.set(entry.id, entry.value)
    this.fixture.revisions.value += 1
    this.undoValues.delete(undoToken)
    return {
      status: 'completed' as const,
      resultingRevisions: { 'sample.scope': this.fixture.revisions.value },
      producedRefs: [{ kind: 'sample.item', id: entry.id, revision: this.fixture.revisions.value }],
      evidence: [{
        kind: 'property_value' as const,
        target: { kind: 'sample.item', id: entry.id },
        fact: `实体 ${entry.id} 已撤销。`,
        data: entry.value,
        capturedAt: new Date().toISOString(),
      }],
    }
  }
}

function context(permissions = ['sample:read', 'sample:write']): ApplicationExecutionContext {
  return {
    requestId: 'request-one',
    exposure: 'assistant',
    permissions: new Set(permissions),
    acceptedDataClasses: new Set(['C0', 'C1']),
  }
}

function mutationStep(id: string, value: number, revision = 0): ApplicationPlannedStep {
  return {
    kind: 'mutation',
    target: { kind: 'sample.item', id },
    entityType: 'sample.item',
    expectedRevisions: { 'sample.scope': revision },
    mutations: [{ propertyId: 'sample.value', operation: 'set', value }],
  }
}

function createEngine(fixture: Fixture) {
  let sequence = 0
  const engine = new ApplicationControlExecutionEngine(fixture.registry, {
    now: () => new Date('2026-08-01T00:00:00.000Z'),
    createOpaqueRef: (kind) => `${kind}:${String(++sequence).padStart(20, '0')}`,
  })
  const executor = new FixtureMutationExecutor(fixture)
  engine.registerMutationExecutor(executor)
  return { engine, executor }
}

describe('ApplicationControlExecutionEngine', () => {
  it('计划阶段拒绝越界值且不执行领域写入', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    await expect(engine.plan({
      summary: '设置非法值',
      transactionMode: 'atomic',
      steps: [mutationStep('one', 11)],
    }, context())).rejects.toThrow('ABOVE_MAXIMUM')
    expect(executor.applyCount).toBe(0)
    expect(fixture.values.get('one')).toBe(2)
  })

  it('提交复核 revision 与权限，冲突时不写入', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    const plan = await engine.plan({
      summary: '更新数值', transactionMode: 'atomic', steps: [mutationStep('one', 6)],
    }, context())
    fixture.revisions.value = 1
    const conflict = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'idempotency-conflict-001',
    }, context())
    expect(conflict.status).toBe('failed')
    expect(conflict.status === 'failed' && conflict.code).toBe('CONFLICT')
    expect(executor.applyCount).toBe(0)
  })

  it('计划后写权限被收回时拒绝提交', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    const plan = await engine.plan({
      summary: '更新数值', transactionMode: 'atomic', steps: [mutationStep('one', 6)],
    }, context())
    const denied = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'idempotency-permission-01',
    }, context(['sample:read']))
    expect(denied.status === 'failed' && denied.code).toBe('PERMISSION_DENIED')
    expect(executor.applyCount).toBe(0)
    expect(fixture.values.get('one')).toBe(2)
  })

  it('提交具备幂等、结构化验证和可逆撤销', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    const plan = await engine.plan({
      summary: '更新数值', transactionMode: 'atomic', steps: [mutationStep('one', 6)],
    }, context())
    const request = {
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'idempotency-commit-0001',
    }
    const first = await engine.commit(request, context())
    const repeated = await engine.commit(request, context())
    expect(first).toEqual(repeated)
    expect(executor.applyCount).toBe(1)
    expect(first.status).toBe('completed')
    expect(first.status === 'completed' && first.verification.verified).toBe(true)
    if (first.status !== 'completed' || !first.undoRef) throw new Error('UNDO_REF_MISSING')
    const undone = await engine.undo({
      undoRef: first.undoRef,
      expectedRevisions: first.resultingRevisions,
      idempotencyKey: 'idempotency-undo-00001',
    }, context())
    expect(undone.status).toBe('completed')
    expect(fixture.values.get('one')).toBe(2)
  })

  it('可补偿事务失败时回滚已完成步骤并报告部分状态', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    executor.failOnId = 'two'
    const plan = await engine.plan({
      summary: '分组更新',
      transactionMode: 'compensatable',
      steps: [mutationStep('one', 6), mutationStep('two', 8)],
    }, context())
    const result = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'idempotency-group-0001',
    }, context())
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.partial?.compensatedStepIndexes).toEqual([0])
    expect(fixture.values.get('one')).toBe(2)
    expect(fixture.values.get('two')).toBe(4)
  })

  it('语义操作风险来自注册执行器且提交需要明确批准', async () => {
    const fixture = createFixture()
    const { engine } = createEngine(fixture)
    engine.registerOperationExecutor({
      capabilityId: 'publish_sample_item',
      capabilityVersion: 1,
      risk: 'R2',
      requiredPermissions: ['sample:write'],
      supportsAtomic: true,
      normalizeInput: (input) => input,
      getCurrentRevisions: async () => ({ 'sample.scope': fixture.revisions.value }),
      execute: async () => ({
        status: 'completed',
        resultingRevisions: { 'sample.scope': fixture.revisions.value },
        producedRefs: [],
        evidence: [{ kind: 'operation_result', fact: '样例已发布。', capturedAt: new Date().toISOString() }],
      }),
    })
    const plan = await engine.plan({
      summary: '发布样例',
      transactionMode: 'atomic',
      steps: [{
        kind: 'operation',
        capabilityId: 'publish_sample_item',
        capabilityVersion: 1,
        input: { id: 'one' },
        expectedRevisions: { 'sample.scope': 0 },
      }],
    }, context())
    expect(plan).toMatchObject({ risk: 'R2', requiresApproval: true })
    const denied = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'idempotency-denied-001',
    }, context())
    expect(denied.status === 'failed' && denied.code).toBe('PERMISSION_DENIED')
    const completed = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'idempotency-approved-1',
      approvedRisk: 'R2',
    }, context())
    expect(completed.status).toBe('completed')
  })
})
