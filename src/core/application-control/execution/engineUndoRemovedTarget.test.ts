import { describe, expect, it, vi } from 'vitest'
import type { ApplicationCollectionExecutor } from './types'
import {
  context,
  createEngine,
  createFixture,
  mutationStep,
  removalStep,
} from './engineTestFixture'

function registerReversibleRemoval(
  engine: ReturnType<typeof createEngine>['engine'],
  fixture: ReturnType<typeof createFixture>,
  executionOrder: string[] = [],
): void {
  const removedValues = new Map<string, { id: string; value: number }>()
  let sequence = 0
  const restore = async (undoToken: string) => {
    const removed = removedValues.get(undoToken)
    if (!removed) throw new Error('NOT_FOUND')
    executionOrder.push('restore-entity')
    fixture.values.set(removed.id, removed.value)
    fixture.revisions.value += 1
    removedValues.delete(undoToken)
    return {
      status: 'completed' as const,
      resultingRevisions: { 'sample.scope': fixture.revisions.value },
      directRefs: [{
        kind: 'sample.item', id: removed.id, revision: fixture.revisions.value,
      }],
      evidence: [],
    }
  }
  const collectionExecutor: ApplicationCollectionExecutor = {
    entityType: 'sample.item',
    effectContract: { direct: [], cascades: [] },
    async apply(step) {
      if (step.operation.kind !== 'remove') throw new Error('EXPECTED_REMOVE')
      const target = step.operation.targets[0]
      const value = fixture.values.get(target.id)
      if (value === undefined) throw new Error('NOT_FOUND')
      const undoToken = `remove:${++sequence}`
      removedValues.set(undoToken, { id: target.id, value })
      fixture.values.delete(target.id)
      fixture.revisions.value += 1
      return {
        status: 'completed',
        resultingRevisions: { 'sample.scope': fixture.revisions.value },
        directRefs: step.operation.targets,
        evidence: [],
        undoToken,
      }
    },
    async compensate(_step, result) {
      if (!result.undoToken) throw new Error('UNDO_NOT_SUPPORTED')
      return (await restore(result.undoToken)).evidence
    },
    undo: restore,
  }
  engine.registerCollectionExecutor(collectionExecutor)
}

describe('ApplicationControlExecutionEngine removed-target undo', () => {
  it('同一可补偿计划先修改再删除实体时按逆序恢复并撤销修改', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    const executionOrder: string[] = []
    const undoMutation = executor.undo.bind(executor)
    vi.spyOn(executor, 'undo').mockImplementation(async (undoToken) => {
      executionOrder.push('undo-mutation')
      return await undoMutation(undoToken)
    })
    registerReversibleRemoval(engine, fixture, executionOrder)

    const plan = await engine.plan({
      summary: '先更新再删除后可整体撤销',
      transactionMode: 'compensatable',
      steps: [mutationStep('one', 6), removalStep('one')],
    }, context())
    const committed = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'update-remove-commit',
    }, context())

    expect(committed.status).toBe('completed')
    expect(fixture.values.has('one')).toBe(false)
    expect(committed.status === 'completed' && committed.resultingRevisions).toEqual({
      'sample.scope': 2,
    })
    if (committed.status !== 'completed' || !committed.undoRef) {
      throw new Error('UNDO_REF_MISSING')
    }

    const undone = await engine.undo({
      undoRef: committed.undoRef,
      expectedRevisions: committed.resultingRevisions,
      idempotencyKey: 'update-remove-undo',
    }, context())

    if (undone.status === 'failed') {
      throw new Error(`撤销不应在逆序执行前失败：${undone.code}:${undone.message}`)
    }
    expect(undone.status).toBe('completed')
    expect(executionOrder).toEqual(['restore-entity', 'undo-mutation'])
    expect(fixture.values.get('one')).toBe(2)
    expect(undone.status === 'completed' && undone.resultingRevisions).toEqual({
      'sample.scope': 4,
    })
    expect(undone.status === 'completed' && undone.effects.map((effect) => effect.effect))
      .toEqual(['create', 'update'])
  })

  it('不是同一记录 direct remove 解释的缺失实体仍保持 NOT_FOUND 且不执行撤销', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    const plan = await engine.plan({
      summary: '只修改实体',
      transactionMode: 'compensatable',
      steps: [mutationStep('one', 6)],
    }, context())
    const committed = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'mutation-only-commit',
    }, context())
    if (committed.status !== 'completed' || !committed.undoRef) throw new Error('UNDO_REF_MISSING')
    fixture.values.delete('one')

    const undone = await engine.undo({
      undoRef: committed.undoRef,
      expectedRevisions: committed.resultingRevisions,
      idempotencyKey: 'mutation-only-undo',
    }, context())

    expect(undone).toMatchObject({ status: 'failed', code: 'NOT_FOUND' })
    expect(executor.undoValues.size).toBe(1)
  })

  it('direct remove 的集合 revision 已过期时保持冲突且不执行撤销', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    registerReversibleRemoval(engine, fixture)
    const plan = await engine.plan({
      summary: '删除后发生外部写入',
      transactionMode: 'compensatable',
      steps: [mutationStep('one', 6), removalStep('one')],
    }, context())
    const committed = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'stale-remove-commit',
    }, context())
    if (committed.status !== 'completed' || !committed.undoRef) throw new Error('UNDO_REF_MISSING')
    fixture.revisions.value += 1

    const undone = await engine.undo({
      undoRef: committed.undoRef,
      expectedRevisions: committed.resultingRevisions,
      idempotencyKey: 'stale-remove-undo',
    }, context())

    expect(undone).toMatchObject({ status: 'failed', code: 'CONFLICT' })
    expect(fixture.values.has('one')).toBe(false)
    expect(executor.undoValues.size).toBe(1)
  })

  it('被跳过 mutation 的 revision scope 无集合权威 probe 覆盖时拒绝撤销', async () => {
    const fixture = createFixture()
    const { engine, executor } = createEngine(fixture)
    Object.defineProperty(executor, 'effectContract', {
      value: {
        direct: [],
        cascades: [{
          declarationId: 'sample.detached-effect',
          effect: 'update',
          entityType: 'sample.detached',
          propertyIds: [],
          revisionScopes: ['sample.detached.scope'],
        }],
      },
    })
    registerReversibleRemoval(engine, fixture)
    const plan = await engine.plan({
      summary: '删除前修改含独立 revision scope',
      transactionMode: 'compensatable',
      steps: [mutationStep('one', 6), removalStep('one')],
    }, context())
    const committed = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { 'sample.scope': 0 },
      idempotencyKey: 'uncovered-scope-commit',
    }, context())
    if (committed.status !== 'completed' || !committed.undoRef) throw new Error('UNDO_REF_MISSING')

    const undone = await engine.undo({
      undoRef: committed.undoRef,
      expectedRevisions: committed.resultingRevisions,
      idempotencyKey: 'uncovered-scope-undo',
    }, context())

    expect(undone).toMatchObject({ status: 'failed', code: 'CONFLICT' })
    expect(fixture.values.has('one')).toBe(false)
    expect(executor.undoValues.size).toBe(1)
  })
})
