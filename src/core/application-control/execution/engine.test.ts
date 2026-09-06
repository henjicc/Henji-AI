import { describe, expect, it, vi } from 'vitest'
import { createFixture, createEngine, context, mutationStep, collectionStep, removalStep } from './engineTestFixture'

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
