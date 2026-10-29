import { ApplicationTransactionVerifier } from './verifier'
import { describe, expect, it, vi } from 'vitest'
import { createFixture, createEngine, context, mutationStep, collectionStep, removalStep } from './engineTestFixture'

describe('ApplicationControlExecutionEngine', () => {
  it.each([['NOT_FOUND：已移到回收区', true], ['索引读取失败', false]] as const)('删除验证识别领域缺失，拒绝将读取失败当成删除成功：%s', async (message, verified) => {
    const fixture = createFixture()
    vi.spyOn(fixture.registry, 'readEntity').mockRejectedValue(new Error(message))
    const result = await new ApplicationTransactionVerifier(fixture.registry).verify([
      { kind: 'entity_absent', target: { kind: 'sample.item', id: 'removed' } },
    ], [], context(), new Date())
    expect(result.verified).toBe(verified)
  })
  it('计划中删除后不再对同一目标使用旧快照写属性', async () => {
    const { engine } = createEngine(createFixture())
    await expect(engine.plan({ summary: '删除后再写', transactionMode: 'non_reversible', steps: [removalStep('one'), mutationStep('one', 6)] }, context())).rejects.toThrow('PROPERTY_OPERATION_CONFLICT')
  })

  it('两次属性写入中间有语义操作时拒绝沿用计划内旧值', async () => {
    const { engine } = createEngine(createFixture())
    engine.registerOperationExecutor({ capabilityId: 'transform_sample_item', capabilityVersion: 1, requiredPermissions: ['sample:write'], supportsAtomic: false,
      effectContract: { direct: [], cascades: [] }, normalizeInput: input => input, getCurrentRevisions: async () => ({ 'sample.scope': 0 }),
      execute: vi.fn(),
    })
    await expect(engine.plan({ summary: '写入间夹语义操作', transactionMode: 'non_reversible', steps: [mutationStep('one', 4),
      { kind: 'operation', capabilityId: 'transform_sample_item', capabilityVersion: 1, input: {}, expectedRevisions: { 'sample.scope': 0 } }, mutationStep('one', 6),
    ] }, context())).rejects.toThrow('PROPERTY_OPERATION_CONFLICT')
  })
  it.each([
    ['append', 'append', ['link-1', 'link-2', 'link-3', 'link-4']],
    ['remove', 'append', ['link-2', 'link-4']],
    ['set', 'set', ['link-1']],
    ['append', 'set', ['link-1', 'link-2', 'link-3']],
    ['append', 'set', ['link-1']],
    ['remove', 'set', ['link-2', 'link-1']],
  ] as const)('计划内列表累积 %s → %s → %j', async (first, second, ids) => {
    const fixture = createFixture()
    const { engine } = createEngine(fixture)
    const link = (id: string) => ({ kind: 'sample.link', id })
    const desired = ids.map(link)
    const plan = await engine.plan({ summary: '累积修改列表', transactionMode: 'compensatable', steps: [
      { kind: 'mutation', entityType: 'sample.item', target: { kind: 'sample.item', id: 'one' }, expectedRevisions: { 'sample.scope': 0 },
        mutations: [{ propertyId: 'sample.links', operation: first, value: first === 'set' ? [link('link-3')] : link(first === 'remove' ? 'link-1' : 'link-3') }] },
      { kind: 'mutation', entityType: 'sample.item', target: { kind: 'sample.item', id: 'one' }, expectedRevisions: { 'sample.scope': 0 },
        mutations: [{ propertyId: 'sample.links', operation: second, value: second === 'set' ? desired : link('link-4') }] },
    ] }, context())
    expect(plan.verificationConditions).toEqual([{ kind: 'property_equals', target: { kind: 'sample.item', id: 'one' }, propertyId: 'sample.links', expected: desired }])
    const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: { 'sample.scope': 0 }, idempotencyKey: 'list-accumulation' }, context())
    expect(result.status).toBe('completed')
    expect(fixture.links.get('one')).toEqual(desired)
  })

  it('零步失败的新计划可复用幂等键，成功结果仍拒绝跨计划复用', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    vi.spyOn(executor, 'apply').mockRejectedValueOnce(new Error('temporary failure'))
    const plan = () => engine.plan({ summary: '重试写入', transactionMode: 'compensatable', steps: [mutationStep('one', 6)] }, context())
    const commit = (planRef: string) => engine.commit({ planRef, expectedRevisions: { 'sample.scope': 0 }, idempotencyKey: 'retry-same-operation' }, context())
    expect(await commit((await plan()).planRef)).toMatchObject({ status: 'failed', partial: { completedStepIndexes: [] } })
    expect(await commit((await plan()).planRef)).toMatchObject({ status: 'completed' })
    const next = await engine.plan({ summary: '另一计划', transactionMode: 'compensatable', steps: [mutationStep('one', 8, fixture.revisions.value)] }, context())
    expect(await commit(next.planRef)).toMatchObject({ status: 'failed', code: 'INVALID_PLAN' })
  })

  it('撤销记录只保留最近 256 次，旧回执失效而最新回执可用', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    const forget = vi.fn()
    Object.assign(executor, { forget })
    const refs: string[] = []
    for (let i = 0; i < 257; i++) {
      const revision = fixture.revisions.value
      const plan = await engine.plan({ summary: '修改数值', transactionMode: 'compensatable', steps: [mutationStep('one', (i % 5) * 2, revision)] }, context())
      const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: { 'sample.scope': revision }, idempotencyKey: `bounded-undo-operation-${i}` }, context())
      if (result.status !== 'completed' || !result.undoRef) throw new Error(JSON.stringify(result))
      refs.push(result.undoRef)
    }
    expect(forget).toHaveBeenCalledTimes(1)
    const undo = (undoRef: string) => engine.undo({ undoRef, expectedRevisions: { 'sample.scope': fixture.revisions.value }, idempotencyKey: `undo-${undoRef}` }, context())
    expect(await undo(refs[0])).toMatchObject({ status: 'failed', code: 'NOT_FOUND' })
    expect(await undo(refs.at(-1)!)).toMatchObject({ status: 'completed' })
    expect(forget).toHaveBeenCalledTimes(2)
  })
  it.each(['collection', 'operation'] as const)('%s 回执淘汰和消费都释放对应 token', async (kind) => {
    const fixture = createFixture()
    const { engine } = createEngine(fixture)
    const forget = vi.fn()
    let serial = 0
    const completed = () => ({ status: 'completed' as const, resultingRevisions: { 'sample.scope': 0 }, directRefs: [{ kind: 'sample.item', id: 'one' }], evidence: [{ kind: 'operation_result' as const, fact: '已完成测试操作', capturedAt: new Date().toISOString() }],
      ...(kind === 'operation' ? { directEffects: [{ effect: 'execute' as const, entityType: 'sample.item', refs: [{ kind: 'sample.item', id: 'one' }], propertyIds: [], origin: { kind: 'direct' as const } }] } : {}),
    })
    const execute = async () => ({ ...completed(), undoToken: `snapshot-${++serial}` })
    const undo = async () => completed()
    engine.registerCollectionExecutor({ entityType: 'sample.item', effectContract: { direct: [], cascades: [] },
      apply: async () => { fixture.values.delete('one'); return execute() }, undo, forget })
    engine.registerOperationExecutor({ capabilityId: 'release_sample', capabilityVersion: 1, requiredPermissions: ['sample:write'], supportsAtomic: false,
      effectContract: { direct: [], cascades: [] }, normalizeInput: input => input, getCurrentRevisions: async () => ({ 'sample.scope': 0 }), execute, undo, forget })
    let latest = ''
    for (let index = 0; index < 257; index++) {
      fixture.values.set('one', 2)
      const plan = await engine.plan({ summary: '释放回执', transactionMode: 'non_reversible', steps: [kind === 'collection' ? removalStep('one') :
        { kind: 'operation', capabilityId: 'release_sample', capabilityVersion: 1, input: {}, expectedRevisions: { 'sample.scope': 0 } }] }, context())
      const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: { 'sample.scope': 0 }, idempotencyKey: `snapshot-test-release-${index}` }, context())
      if (result.status !== 'completed' || !result.undoRef) throw new Error(JSON.stringify(result))
      latest = result.undoRef
    }
    expect(forget.mock.calls).toEqual([['snapshot-1']])
    expect(await engine.undo({ undoRef: latest, expectedRevisions: { 'sample.scope': 0 }, idempotencyKey: 'snapshot-test-release-undo' }, context())).toMatchObject({ status: 'completed' })
    expect(forget.mock.calls).toEqual([['snapshot-1'], ['snapshot-257']])
  })

  it('撤销零步失败保留快照，部分成功失败则释放整张回执且不重复执行', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    const forget = vi.fn()
    Object.assign(executor, { forget })
    const plan = await engine.plan({ summary: '两个撤销步骤', transactionMode: 'compensatable', steps: [mutationStep('one', 6), mutationStep('two', 8)] }, context())
    const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: { 'sample.scope': 0 }, idempotencyKey: 'snapshot-test-partial-release' }, context())
    if (result.status !== 'completed' || !result.undoRef) throw new Error(JSON.stringify(result))
    const original = executor.undo.bind(executor)
    const undoSpy = vi.spyOn(executor, 'undo')
    undoSpy.mockRejectedValueOnce(new Error('temporary'))
    const request = { undoRef: result.undoRef, expectedRevisions: result.resultingRevisions }
    expect(await engine.undo({ ...request, idempotencyKey: 'snapshot-test-zero-progress' }, context())).toMatchObject({ status: 'failed' })
    expect(forget).not.toHaveBeenCalled()
    undoSpy.mockImplementationOnce(original).mockRejectedValueOnce(new Error('partial'))
    expect(await engine.undo({ ...request, idempotencyKey: 'snapshot-test-partial-progress' }, context())).toMatchObject({ status: 'failed' })
    expect(forget).toHaveBeenCalledTimes(2)
    expect(await engine.undo({ ...request, idempotencyKey: 'snapshot-test-after-partial' }, context())).toMatchObject({ status: 'failed', code: 'NOT_FOUND' })
  })

  it('仅声明为无序集合的属性忽略顺序和重复，缺项与多项仍失败', async () => {
    const fixture = createFixture()
    const { engine } = createEngine(fixture)
    const descriptor = fixture.registry.getProperty('sample.links')!
    const first = { kind: 'sample.link', id: 'link-1' }
    const second = { kind: 'sample.link', id: 'link-2' }
    const verify = (expected: Array<{ kind: string; id: string }>) => engine.verifyRecovery([
      { kind: 'property_equals', target: { kind: 'sample.item', id: 'one' }, propertyId: 'sample.links', expected },
    ], [], context())
    expect((await verify([second, first])).verified).toBe(false)
    descriptor.valueComparison = 'unordered_set'
    expect((await verify([second, first, first])).verified).toBe(true)
    expect((await verify([first])).verified).toBe(false)
    expect((await verify([first, second, { kind: 'sample.link', id: 'extra' }])).verified).toBe(false)
  })
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
    }, context())).rejects.toThrow('应在 0 到 10 之间')
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

  it('语义操作直接提交并验证正式结果', async () => {
    const fixture = createFixture()
    const { engine } = createEngine(fixture)
    engine.registerOperationExecutor({
      effectContract: { direct: [], cascades: [] },
      capabilityId: 'publish_sample_item',
      capabilityVersion: 1,
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
    const completed = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'idempotency-approved-1',
    }, context())
    expect(completed.status).toBe('completed')
  })
})
