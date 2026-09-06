import { expect, it, vi } from 'vitest'
import { ApplicationControlExecutionEngine } from './engine'
import { createFixture, FixtureMutationExecutor, context, mutationStep } from './engineTestFixture'
import type { ApplicationPersistenceParticipant } from './persistence'

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { promise, resolve } }

it.each(['scope', 'owner'] as const)('排队期间%s变化时不借新宿主写入或扩张已有锁', async (change) => {
  const fixture = createFixture(), entered = deferred(), gate = deferred()
  const confirm = vi.fn(async () => { entered.resolve(); await gate.promise })
  let declarations = ['sample.scope']
  const owner = (): ApplicationPersistenceParticipant => ({ key: 'owner', get persistenceEffects() {
    return [{ declarationId: 'sample.save', effect: 'update' as const, entityType: 'sample.item', propertyIds: [], revisionScopes: declarations }]
  }, begin: () => ({ confirm, release() {} }) })
  let currentOwner = owner()
  const engine = new ApplicationControlExecutionEngine(fixture.registry, { resolvePersistenceParticipants: () => [currentOwner] })
  const executor = new FixtureMutationExecutor(fixture)
  engine.registerMutationExecutor(executor)
  const plan = await engine.plan({ summary: '占住保存作用域', transactionMode: 'compensatable', steps: [mutationStep('one', 6)] }, context())
  const first = engine.commit({ planRef: plan.planRef, expectedRevisions: { 'sample.scope': 0 }, idempotencyKey: 'scope-owner-first' }, context())
  await entered.promise
  // 等待者基线已经是最新 revision，确保测试不会仅被旧基线守卫偶然挡住。
  const waitingPlan = await engine.plan({ summary: '排队事务', transactionMode: 'compensatable', steps: [mutationStep('two', 8, 1)] }, context())
  const waiting = engine.commit({ planRef: waitingPlan.planRef, expectedRevisions: { 'sample.scope': 1 }, idempotencyKey: 'scope-owner-waiting' }, context())
  if (change === 'scope') declarations = ['sample.scope', 'canvas']
  else currentOwner = owner()
  gate.resolve(); await first
  expect(await waiting).toMatchObject({ status: 'failed', code: 'CONFLICT' })
  expect(executor.applyCount).toBe(1)
  expect(fixture.values.get('two')).toBe(4)
  expect(confirm).toHaveBeenCalledTimes(1)
})

it('排队撤销取消不使用 token；释放后原 token 仍可撤销', async () => {
  const fixture = createFixture(), gate = deferred(), entered = deferred()
  const engine = new ApplicationControlExecutionEngine(fixture.registry)
  const executor = new FixtureMutationExecutor(fixture)
  engine.registerMutationExecutor(executor)
  const plan = await engine.plan({ summary: '创建撤销令牌', transactionMode: 'compensatable', steps: [mutationStep('one', 6)] }, context())
  const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: { 'sample.scope': 0 }, idempotencyKey: 'first-for-cancelled-undo' }, context())
  if (result.status !== 'completed' || !result.undoRef) throw new Error('missing undo')
  const undo = executor.undo.bind(executor)
  vi.spyOn(executor, 'undo').mockImplementationOnce(async (token) => { entered.resolve(); await gate.promise; return undo(token) })
  const first = engine.undo({ undoRef: result.undoRef, expectedRevisions: result.resultingRevisions, idempotencyKey: 'undo-owner-first-000' }, context())
  await entered.promise
  const controller = new AbortController()
  const waiting = engine.undo({ undoRef: result.undoRef, expectedRevisions: result.resultingRevisions, idempotencyKey: 'undo-owner-wait-0000' }, { ...context(), signal: controller.signal })
  controller.abort()
  expect(await waiting).toMatchObject({ status: 'failed', code: 'CANCELLED' })
  gate.resolve(); expect(await first).toMatchObject({ status: 'completed' })
  expect(executor.undo).toHaveBeenCalledTimes(1)
  expect(fixture.revisions.value).toBe(2)
})

it('等待scope期间撤销写权限被撤回，锁内拒绝且不使用undo token', async () => {
  const fixture = createFixture(), gate = deferred(), entered = deferred()
  const engine = new ApplicationControlExecutionEngine(fixture.registry)
  const executor = new FixtureMutationExecutor(fixture)
  engine.registerMutationExecutor(executor)
  const undo = vi.spyOn(executor, 'undo')
  const plan = await engine.plan({ summary: '待撤销修改', transactionMode: 'compensatable', steps: [mutationStep('one', 6)] }, context())
  const applied = await engine.commit({ planRef: plan.planRef, expectedRevisions: { 'sample.scope': 0 }, idempotencyKey: 'permission-undo-apply' }, context())
  if (applied.status !== 'completed' || !applied.undoRef) throw new Error('missing undo')
  engine.registerOperationExecutor({ capabilityId: 'hold_scope', capabilityVersion: 1, risk: 'R0', requiredPermissions: [], supportsAtomic: true,
    effectContract: { direct: [], cascades: [] }, normalizeInput: (input) => input,
    getCurrentRevisions: async () => ({ 'sample.scope': fixture.revisions.value }),
    execute: async () => { entered.resolve(); await gate.promise; return { status: 'completed', directRefs: [],
      resultingRevisions: { 'sample.scope': fixture.revisions.value }, evidence: [{ kind: 'operation_result', fact: '读取完成', capturedAt: new Date().toISOString() }] } } })
  const barrier = await engine.plan({ summary: '同scope执行中', transactionMode: 'atomic', steps: [{ kind: 'operation', capabilityId: 'hold_scope',
    capabilityVersion: 1, input: {}, expectedRevisions: applied.resultingRevisions }] }, context())
  const holding = engine.commit({ planRef: barrier.planRef, expectedRevisions: applied.resultingRevisions, idempotencyKey: 'permission-undo-block' }, context())
  await entered.promise
  const undoContext = context()
  const input = { undoRef: applied.undoRef, expectedRevisions: applied.resultingRevisions, idempotencyKey: 'permission-undo-wait' }
  const waiting = engine.undo(input, undoContext)
  ;(undoContext.permissions as Set<string>).delete('sample:write')
  gate.resolve(); await holding
  expect(await waiting).toMatchObject({ status: 'failed', code: 'PERMISSION_DENIED' })
  expect(undo).not.toHaveBeenCalled()
  expect(fixture.values.get('one')).toBe(6)
  expect(fixture.revisions.value).toBe(1)
  expect(await engine.undo({ ...input, idempotencyKey: 'permission-undo-restored' }, context())).toMatchObject({ status: 'completed' })
})
