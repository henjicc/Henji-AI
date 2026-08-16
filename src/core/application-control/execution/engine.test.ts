import { describe, expect, it, vi } from 'vitest'

import type { ApplicationEntityProvider, ApplicationEntityRegistration } from '../registry'
import { ApplicationReflectionRegistry } from '../registry'
import { unrestrictedCollectionAvailability } from '../reflection'
import type { ApplicationPlannedStep } from '../transactions'
import {
  ApplicationControlExecutionEngine,
  type ApplicationExecutionContext,
  type ApplicationMutationOperation,
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
  links: Map<string, Array<{ kind: string; id: string }>>
  revisions: { value: number }
  writable: { value: boolean }
  dynamicallyBlockedId: { value: string | null }
  collectionAvailable: { value: boolean }
}

function createFixture(): Fixture {
  const values = new Map([['one', 2], ['two', 4]])
  const links = new Map([
    ['one', [{ kind: 'sample.link', id: 'link-1' }, { kind: 'sample.link', id: 'link-2' }]],
    ['two', []],
  ])
  const revisions = { value: 0 }
  const writable = { value: true }
  const dynamicallyBlockedId = { value: null as string | null }
  const collectionAvailable = { value: true }
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
        properties: { 'sample.value': value, 'sample.links': links.get(ref.id) ?? [] },
        capturedAt: new Date().toISOString(),
      }
    },
    async getPropertyAvailability(ref, propertyIds) {
      const available = writable.value && dynamicallyBlockedId.value !== ref.id
      return propertyIds.map((propertyId) => ({
        propertyId,
        readable: true,
        writable: available,
        reasons: available ? [] : ['当前状态只读'],
        blocks: available ? [] : [{
          kind: 'state' as const,
          requirementId: 'sample.unlocked',
          affectedEntityTypes: ['sample.item'],
          revisionScopes: ['sample.scope'],
        }],
        requiredPermissions: ['sample:read'],
        revisions: { 'sample.scope': revisions.value },
      }))
    },
    async getCollectionAvailability(parent) {
      const availability = unrestrictedCollectionAvailability('sample.item', parent, { 'sample.scope': revisions.value })
      return collectionAvailable.value ? availability : {
        ...availability,
        create: { ...availability.create, available: false, reasons: ['当前模式不允许创建'] },
      }
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
      parentTypes: ['sample.parent'],
      revisionScopes: ['sample.scope'],
      queryCapabilityIds: ['get_sample_item'],
      schemaRef: schemaRef('entity', 'sample.item'),
      collectionWrite: {
        creatable: true, removable: true, requiredPropertyIds: ['sample.value'], maxItemsPerChange: 8,
      },
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
    }, {
      id: 'sample.links',
      entityType: 'sample.item',
      version: 1,
      title: '关联项',
      description: '样例关联引用。',
      value: { kind: 'ref_list', refKinds: ['sample.link'] },
      nullable: false,
      dataClass: 'C1',
      exposures: ['assistant'],
      requiredPermissions: { read: ['sample:read'], write: ['sample:write'] },
      revisionScopes: ['sample.scope'],
      schemaRef: schemaRef('property', 'sample.links'),
    }],
    provider,
  }
  const registry = new ApplicationReflectionRegistry(catalogVersion)
  registry.register(registration)
  return { registry, values, links, revisions, writable, dynamicallyBlockedId, collectionAvailable }
}

class FixtureMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly entityType = 'sample.item'
  readonly writableProperties = new Set(['sample.value', 'sample.links'])
  readonly propertyOperations: ReadonlyMap<string, ReadonlySet<ApplicationMutationOperation>> = new Map<string, ReadonlySet<ApplicationMutationOperation>>([
    ['sample.value', new Set(['set' as const])],
    ['sample.links', new Set(['append' as const, 'remove' as const])],
  ])
  readonly undoValues = new Map<string, { id: string; value: number }>()
  failOnId?: string
  applyCount = 0
  atomicCount = 0
  reportUndeclaredCascade = false

  constructor(private readonly fixture: Fixture) {}

  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>) {
    this.applyCount += 1
    if (step.target.id === this.failOnId) throw new Error('EXPECTED_FAILURE')
    const before = this.fixture.values.get(step.target.id)
    if (before === undefined) throw new Error('NOT_FOUND')
    if (step.mutations.every((mutation) => mutation.propertyId === 'sample.links')) {
      let next = [...(this.fixture.links.get(step.target.id) ?? [])]
      for (const mutation of step.mutations) {
        const value = mutation.value as { kind: string; id: string }
        if (mutation.operation === 'append') next.push(value)
        else next = next.filter((item) => JSON.stringify(item) !== JSON.stringify(value))
      }
      this.fixture.links.set(step.target.id, next)
      this.fixture.revisions.value += 1
      return {
        status: 'completed' as const,
        resultingRevisions: { 'sample.scope': this.fixture.revisions.value },
        directRefs: [{ kind: 'sample.item', id: step.target.id, revision: this.fixture.revisions.value }],
        cascadeEffects: [],
        evidence: [{
          kind: 'property_value' as const,
          target: { kind: 'sample.item', id: step.target.id },
          fact: '关联引用已更新。',
          data: next,
          capturedAt: new Date().toISOString(),
        }],
      }
    }
    const value = step.mutations[0].value
    if (typeof value !== 'number') throw new Error('INVALID_INPUT')
    this.fixture.values.set(step.target.id, value)
    if (step.target.id === 'one') this.fixture.dynamicallyBlockedId.value = null
    this.fixture.revisions.value += 1
    const undoToken = `token:${step.target.id}:${this.applyCount}`
    this.undoValues.set(undoToken, { id: step.target.id, value: before })
    return {
      status: 'completed' as const,
      resultingRevisions: { 'sample.scope': this.fixture.revisions.value },
      directRefs: [{ kind: 'sample.item', id: step.target.id, revision: this.fixture.revisions.value }],
      cascadeEffects: this.reportUndeclaredCascade ? [{
        effect: 'create' as const, entityType: 'sample.child', refs: [{ kind: 'sample.child', id: 'unknown-child' }],
        propertyIds: [], origin: { kind: 'cascade' as const, declarationId: 'sample.undeclared' },
      }] : [],
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
      directRefs: [{ kind: 'sample.item', id: entry.id, revision: this.fixture.revisions.value }],
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

function collectionStep(): ApplicationPlannedStep {
  return {
    kind: 'collection',
    parent: { kind: 'sample.parent', id: 'parent-1' },
    entityType: 'sample.item',
    expectedRevisions: { 'sample.scope': 0 },
    operation: { kind: 'create', items: [{ properties: { 'sample.value': 2 } }] },
  }
}

function removalStep(id: string, revision = 0): ApplicationPlannedStep {
  return {
    kind: 'collection',
    parent: { kind: 'sample.parent', id: 'parent-1' },
    entityType: 'sample.item',
    expectedRevisions: { 'sample.scope': revision },
    operation: { kind: 'remove', targets: [{ kind: 'sample.item', id }] },
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
  it('把 ref_list 的整体 set 在计划阶段编译为最小 append/remove 差异', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    const desired = [
      { kind: 'sample.link', id: 'link-2' },
      { kind: 'sample.link', id: 'link-3' },
    ]
    const plan = await engine.plan({
      summary: '整体替换关联项',
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation', target: { kind: 'sample.item', id: 'one' }, entityType: 'sample.item',
        expectedRevisions: { 'sample.scope': 0 },
        mutations: [{ propertyId: 'sample.links', operation: 'set', value: desired }],
      }],
    }, context())

    expect(plan.steps[0]).toMatchObject({
      kind: 'mutation',
      mutations: [
        { propertyId: 'sample.links', operation: 'remove', value: { kind: 'sample.link', id: 'link-1' } },
        { propertyId: 'sample.links', operation: 'append', value: { kind: 'sample.link', id: 'link-3' } },
      ],
    })
    const result = await engine.commit({
      planRef: plan.planRef, expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'idempotency-replace-links',
    }, context())
    if (result.status !== 'completed') throw new Error(JSON.stringify(result))
    expect(executor.applyCount).toBe(1)
    expect(fixture.links.get('one')).toEqual(desired)
  })

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

  it('集合状态在计划后变为不可用时，提交预检拒绝且不调用执行器', async () => {
    const fixture = createFixture()
    const { engine } = createEngine(fixture)
    const apply = vi.fn()
    engine.registerCollectionExecutor({ entityType: 'sample.item', effectContract: { direct: [], cascades: [] }, apply })
    const plan = await engine.plan({
      summary: '创建样例', transactionMode: 'atomic', steps: [collectionStep()],
    }, context())
    fixture.collectionAvailable.value = false

    const result = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'idempotency-collection-01',
    }, context())

    expect(result).toMatchObject({ status: 'failed', code: 'PERMISSION_DENIED' })
    expect(result.status === 'failed' && result.message).toContain('COLLECTION_CREATE_NOT_AVAILABLE')
    expect(apply).not.toHaveBeenCalled()
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

  it('同一事务先更新再删除实体时只验证最终世界状态', async () => {
    const fixture = createFixture()
    const { engine } = createEngine(fixture)
    engine.registerCollectionExecutor({
      entityType: 'sample.item',
      effectContract: { direct: [], cascades: [] },
      async apply(step) {
        if (step.operation.kind !== 'remove') throw new Error('EXPECTED_REMOVE')
        step.operation.targets.forEach((target) => fixture.values.delete(target.id))
        fixture.revisions.value += 1
        return {
          status: 'completed' as const,
          resultingRevisions: { 'sample.scope': fixture.revisions.value },
          directRefs: step.operation.targets,
          cascadeEffects: [],
          evidence: [{
            kind: 'operation_result' as const,
            target: step.parent,
            fact: '目标实体已删除。',
            capturedAt: new Date().toISOString(),
          }],
        }
      },
    })
    const plan = await engine.plan({
      summary: '先改名再删除',
      transactionMode: 'non_reversible',
      steps: [mutationStep('one', 6), removalStep('one')],
    }, context())

    expect(plan.verificationConditions).toEqual([{
      kind: 'entity_absent', target: { kind: 'sample.item', id: 'one' },
    }])
    const result = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'idempotency-update-remove-01',
    }, context())

    expect(result.status).toBe('completed')
    expect(fixture.values.has('one')).toBe(false)
    expect(result.status === 'completed' && result.effects.map((effect) => effect.effect))
      .toEqual(['update', 'delete'])
  })

  it('调用方显式要求已删除实体仍具备属性时保持验证失败', async () => {
    const fixture = createFixture()
    const { engine } = createEngine(fixture)
    const plan = await engine.plan({
      summary: '矛盾的最终状态',
      transactionMode: 'non_reversible',
      steps: [removalStep('one')],
      verificationConditions: [{
        kind: 'property_equals',
        target: { kind: 'sample.item', id: 'one' },
        propertyId: 'sample.value',
        expected: 2,
      }],
    }, context())
    expect(plan.verificationConditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'property_equals', propertyId: 'sample.value' }),
      expect.objectContaining({ kind: 'entity_absent' }),
    ]))
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

  it('后置写入可依赖同一事务前序步骤刚建立的动态可用状态', async () => {
    const fixture = createFixture()
    fixture.dynamicallyBlockedId.value = 'two'
    const { engine, executor } = createEngine(fixture)
    const plan = await engine.plan({
      summary: '先解锁再写入',
      transactionMode: 'compensatable',
      steps: [mutationStep('one', 6), mutationStep('two', 8)],
    }, context())

    const result = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'idempotency-dependent-01',
    }, context())

    expect(result.status).toBe('completed')
    expect(executor.applyCount).toBe(2)
    expect(fixture.values.get('two')).toBe(8)
  })

  it('执行器报告未声明 cascade 时事务拒绝并补偿当前步骤', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    executor.reportUndeclaredCascade = true
    const plan = await engine.plan({
      summary: '拒绝未知级联', transactionMode: 'compensatable', steps: [mutationStep('one', 6)],
    }, context())

    const result = await engine.commit({
      planRef: plan.planRef, expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'idempotency-undeclared-cascade',
    }, context())

    expect(result.status).toBe('failed')
    expect(result.status === 'failed' ? result.message : '').toContain('UNDECLARED_CASCADE_EFFECT')
    expect(fixture.values.get('one')).toBe(2)
  })

  it('语义操作风险来自注册执行器且提交需要明确批准', async () => {
    const fixture = createFixture()
    const { engine } = createEngine(fixture)
    engine.registerOperationExecutor({
      effectContract: { direct: [], cascades: [] },
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
        directRefs: [{ kind: 'sample.item', id: 'a' }],
        directEffects: [{ effect: 'execute', entityType: 'sample.item', refs: [{ kind: 'sample.item', id: 'a' }], propertyIds: [], origin: { kind: 'direct' } }],
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
