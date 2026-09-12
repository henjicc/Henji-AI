import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpOperationStore } from './operationStore'
import { McpOperationCoordinator } from './operationCoordinator'
import { ApplicationHostBridge } from './applicationHostBridge'
import type { LocalHostRequest } from '../../../../src/core/application-control/localHostContracts'
import { reserveGenerationBudget } from './generationBudget'
import { ApplicationToolDispatcher } from './applicationToolDispatcher'

if (!process.versions.electron) throw new Error('本测试必须由正式 Electron SQLite 原生运行器执行，不能跳过原生边界。')

const opened: Database.Database[] = []
afterEach(() => { for (const db of opened.splice(0)) db.close() })
function fixture(): { db: Database.Database; store: McpOperationStore; coordinator: McpOperationCoordinator; callerId: string; sessionId: string; baseline: string } {
  const db = new Database(':memory:'); opened.push(db)
  db.exec("CREATE TABLE existing_business(id TEXT PRIMARY KEY, value TEXT); INSERT INTO existing_business VALUES('old','keep');")
  const store = new McpOperationStore(db)
  // 公开写入范围由宿主从反射注册表派生后送来；原生用例显式给出本用例涉及的实体。
  const coordinator = new McpOperationCoordinator(store, undefined, () => new Set(['settings.registry', 'canvas.project', 'canvas.node']))
  const callerId = randomUUID(); const sessionId = randomUUID()
  const baseline = store.baseline(callerId, [{ kind: 'settings.registry', id: 'singleton' }], { settings: 1 }, sessionId).id
  return { db, store, coordinator, callerId, sessionId, baseline }
}
const access = { allowWrites: true, allowDestructive: false }
function input(baselineId: string): Record<string, unknown> {
  return { operationId: randomUUID(), baselineIds: [baselineId], summary: '修改主题', changes: [{ kind: 'set_properties', entityType: 'settings.registry', target: { kind: 'settings.registry', id: 'singleton' }, properties: { 'interface.theme_tone': 'dark' } }] }
}

describe('MCP 原生操作记录与恢复', () => {
  it('有明确完整回滚事实才结束占用，未知错误和保存失败不冒充回滚', () => {
    for (const [details, expected] of [
      [{ execution: { rolledBack: true } }, 'rolled_back'],
      [{ transaction: { partial: { completedStepIndexes: [0], compensatedStepIndexes: [0], uncompensatedStepIndexes: [] } } }, 'rolled_back'],
      [{ transaction: { partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] } } }, 'unknown'],
      [{ execution: { rolledBack: true }, persistence: {} }, 'partial'],
    ] as const) {
      const f = fixture()
      const record = f.coordinator.prepare(f.callerId, input(f.baseline), f.sessionId, access)
      const requestId = randomUUID(); f.coordinator.dispatched(record, requestId, f.sessionId)
      f.coordinator.complete({ requestId, sessionId: f.sessionId, result: { ok: false, error: { details } } })
      expect(f.store.get(record.operationId, f.callerId)?.state).toBe(expected)
      expect(f.store.unresolved().length).toBe(expected === 'rolled_back' ? 0 : 1)
    }
  })
  it('旧结果导入未知记录不锁住同一画布的独立新增；五个生成可同时登记派发', async () => {
    const f = fixture()
    const project = { kind: 'canvas.project', id: 'user-project' }
    const old = { operationId: randomUUID(), callerId: randomUUID(), inputDigest: 'legacy', state: 'unknown' as const,
      capabilityId: 'add_generation_result_to_canvas' as const, input: { projectId: project.id, resultRef: { kind: 'generation.result', id: 'old-result' } },
      targetRefs: [project, { kind: 'generation.result', id: 'old-result' }],
      result: { ok: false, error: { code: 'INVALID_INPUT', message: 'sourceFileName: Too big' } } }
    f.store.save(old)
    const pending: LocalHostRequest[] = []
    const host = new ApplicationHostBridge(() => undefined, f.coordinator)
    host.register({ sessionId: f.sessionId, generation: 1, ready: true, tools: [] }, { send(channel, value) {
      if (channel !== 'mcp:host:request') return
      const request = value as LocalHostRequest
      if (request.capabilityId === 'prepare_generation_task') host.complete({ sessionId: f.sessionId, requestId: request.requestId,
        result: { ok: true, data: { preparation: { priceEstimate: { comparableCnyAmount: 0.34 } } } } })
      else pending.push(request)
    } })
    const dispatcher = new ApplicationToolDispatcher({ assertActive() {}, access: () => ({ ...access, allowPaid: true }) }, host, f.coordinator)
    const calls = Array.from({ length: 5 }, (_, index) => dispatcher.call(f.callerId, 'create_visible_generation_task', {
      operationId: randomUUID(), modelId: 'fixture', prompt: `新请求 ${index}`, mediaType: 'image',
      destination: { mode: 'canvas', projectId: project.id, sourceNodeIds: ['reference'] },
    }, new AbortController().signal))
    await vi.waitFor(() => expect(pending).toHaveLength(5))
    for (const request of pending) host.complete({ sessionId: f.sessionId, requestId: request.requestId,
      result: { ok: true, data: { taskId: request.operationId, verification: { verified: true } } } })
    for (const reply of await Promise.all(calls)) expect(reply.structuredContent).toMatchObject({ executionState: 'completed' })
    expect(f.store.get(old.operationId, old.callerId)).toEqual(old)
  })

  it('集合追加兼容独立追加，但删除、覆盖、保存失败和未知请求换标识仍拒绝', () => {
    const f = fixture()
    const project = { kind: 'canvas.project', id: 'project' }
    const args = { operationId: randomUUID(), modelId: 'fixture', prompt: '第一张', mediaType: 'image', destination: { mode: 'canvas', projectId: project.id } }
    const first = f.coordinator.prepare(f.callerId, args, f.sessionId, { ...access, allowPaid: true }, 'create_visible_generation_task')
    f.coordinator.dispatched(first, randomUUID(), f.sessionId)
    const create = { operationId: randomUUID(), changes: [{ kind: 'create_items', entityType: 'canvas.node', parent: project, items: [{ properties: { 'canvas.node.node_type': 'uploadNode' } }] }] }
    const append = f.coordinator.prepare(f.callerId, create, f.sessionId, access)
    f.coordinator.dispatched(append, randomUUID(), f.sessionId)
    expect(f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID(), prompt: '第二张' }, f.sessionId, { ...access, allowPaid: true }, 'create_visible_generation_task').state).toBe('prepared')
    expect(() => f.coordinator.prepare(f.callerId, { operationId: randomUUID(), changes: [{ kind: 'set_properties', entityType: project.kind, target: project, properties: { 'canvas.project.name': '改名' } }] }, f.sessionId, access)).toThrow(first.operationId)
    const baseline = f.store.baseline(f.callerId, [project, { kind: 'canvas.node', id: 'project:node' }], { canvas: 1 }, f.sessionId)
    expect(() => f.coordinator.prepare(f.callerId, { operationId: randomUUID(), baselineIds: [baseline.id], changes: [{ kind: 'remove_items', entityType: 'canvas.node', parent: project, targets: [{ kind: 'canvas.node', id: 'project:node' }] }] }, f.sessionId, { ...access, allowDestructive: true })).toThrow('RECOVERY_REQUIRED')
    const active = f.store.get(first.operationId, f.callerId)!
    f.store.save({ ...active, state: 'unknown' })
    expect(() => f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID() }, f.sessionId, { ...access, allowPaid: true }, 'create_visible_generation_task')).toThrow('RECOVERY_REQUIRED')
    f.store.save({ ...active, state: 'partial', result: { ok: false, error: { details: { persistence: {} } } } })
    expect(() => f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID(), prompt: '第三张' }, f.sessionId, { ...access, allowPaid: true }, 'create_visible_generation_task')).toThrow('RECOVERY_REQUIRED')
  })

  it('完整工具派发自动准备生成，保存提交事实并去重，高费用不会进入写宿主', async () => {
    const f = fixture()
    const host = new ApplicationHostBridge(() => undefined, f.coordinator)
    const seen: string[] = []
    let cny = 1
    host.register({ sessionId: f.sessionId, generation: 1, ready: true, tools: [] }, { send(channel, value) {
      if (channel !== 'mcp:host:request') return
      const request = value as LocalHostRequest
      seen.push(request.capabilityId)
      const result = request.capabilityId === 'prepare_generation_task'
        ? { ok: true, data: { preparation: { priceEstimate: { comparableCnyAmount: cny } } } }
        : { ok: true, data: { taskId: 'created-task', status: 'submitted', verification: { verified: true } } }
      host.complete({ sessionId: f.sessionId, requestId: request.requestId, result })
    } })
    const dispatcher = new ApplicationToolDispatcher({ assertActive() {}, access: () => ({ allowWrites: true, allowDestructive: false, allowPaid: true }) }, host, f.coordinator)
    const args = { operationId: randomUUID(), modelId: 'fixture', prompt: '普通生成', mediaType: 'image' }
    const result = await dispatcher.call(f.callerId, 'create_visible_generation_task', args, new AbortController().signal)
    expect(result.structuredContent).toMatchObject({ ok: true, executionState: 'completed' })
    expect(seen).toEqual(['prepare_generation_task', 'create_visible_generation_task'])
    expect(await dispatcher.call(f.callerId, 'create_visible_generation_task', args, new AbortController().signal)).toEqual(result)
    expect(seen).toHaveLength(2)
    cny = 100
    const refused = await dispatcher.call(f.callerId, 'create_visible_generation_task', { ...args, operationId: randomUUID() }, new AbortController().signal)
    expect(refused.structuredContent).toMatchObject({ ok: false, executionState: 'not_executed' })
    expect(seen).toEqual(['prepare_generation_task', 'create_visible_generation_task', 'prepare_generation_task'])
  })
  it('普通修改与生成不要求基线，删除仍绑定读取，未知操作仍禁止重放', () => {
    const f = fixture()
    const args = input(f.baseline); delete args.baselineIds
    const write = f.coordinator.prepare(f.callerId, args, f.sessionId, access)
    expect(write.expectedRevisions).toBeUndefined()
    f.coordinator.dispatched(write, randomUUID(), f.sessionId)
    expect(() => f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID() }, f.sessionId, access)).toThrow('RECOVERY_REQUIRED')
    expect(() => f.coordinator.prepare(f.callerId, { operationId: randomUUID(), changes: [{ kind: 'remove_items', entityType: 'canvas.project', parent: { kind: 'canvas.project', id: 'parent' }, targets: [{ kind: 'canvas.project', id: 'target' }] }] }, f.sessionId, { allowWrites: true, allowDestructive: true })).toThrow('BASELINE_REQUIRED')
    const generated = f.coordinator.prepare(f.callerId, { operationId: randomUUID(), modelId: 'fixture', prompt: '生成图片', mediaType: 'image' }, f.sessionId, { ...access, allowPaid: true }, 'create_visible_generation_task')
    expect(generated.expectedRevisions).toBeUndefined()
  })

  it('五次低价生成放行，高费用与累计费用在提交前拦截，重开账本仍保留预算', () => {
    const f = fixture()
    const reserve = (amount: unknown) => {
      const record = f.coordinator.prepare(f.callerId, { operationId: randomUUID(), modelId: 'fixture', prompt: '预算测试', mediaType: 'image' }, f.sessionId, { ...access, allowPaid: true }, 'create_visible_generation_task')
      reserveGenerationBudget(f.store, record, { ok: true, data: { preparation: { priceEstimate: { comparableCnyAmount: amount } } } })
      return record
    }
    for (let i = 0; i < 5; i++) reserve(1)
    expect(new McpOperationStore(f.db).generationSpendSince(Date.now() - 600_000)).toBe(5)
    expect(() => reserve(51)).toThrow('超出自动生成额度')
    expect(() => reserve(46)).toThrow('超出自动生成额度')
    expect(() => reserve(null)).toThrow('费用暂不可估算')
    const record = reserve(2)
    reserveGenerationBudget(f.store, record, { ok: true, data: { preparation: { priceEstimate: { comparableCnyAmount: 2 } } } })
    expect(f.store.generationSpendSince(Date.now() - 600_000)).toBe(7)
    f.store.save({ ...record, state: 'not_executed' })
    expect(f.store.generationSpendSince(Date.now() - 600_000)).toBe(5)
  })
  it('尚未提交的过期预留必须重新核对当下费用，不能复用旧额度', () => {
    const f = fixture()
    const record = f.store.prepare({ operationId: randomUUID(), callerId: f.callerId, inputDigest: 'expired', input: {}, state: 'prepared', generationEstimate: { cny: 1, reservedAt: Date.now() - 700_000 } })
    expect(() => reserveGenerationBudget(f.store, record, { ok: true, data: { preparation: { priceEstimate: { comparableCnyAmount: 51 } } } })).toThrow('超出自动生成额度')
    reserveGenerationBudget(f.store, record, { ok: true, data: { preparation: { priceEstimate: { comparableCnyAmount: 2 } } } })
    expect(f.store.generationSpendSince(Date.now() - 600_000)).toBe(2)
  })
  it('无版本的任务读取仍绑定原目标与宿主会话，不能以其他任务或旧会话取消', () => {
    const f = fixture()
    const taskRef = { kind: 'camera_stage.render_task', id: 'immutable-task' }
    const read = f.coordinator.rememberRead(f.callerId, { ok: true, data: { taskRef, revisions: {} } }, f.sessionId)
    expect(read.baselineId).toEqual(expect.any(String))
    const args = { operationId: randomUUID(), baselineIds: [read.baselineId], taskRef }
    const allowed = { allowWrites: true, allowDestructive: true }
    const record = f.coordinator.prepare(f.callerId, args, f.sessionId, allowed, 'cancel_camera_stage_render_task')
    expect(record.expectedRevisions).toEqual({})
    expect(record.targetRefs).toContainEqual(taskRef)
    expect(() => f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID(), taskRef: { ...taskRef, id: 'other' } }, f.sessionId, allowed, 'cancel_camera_stage_render_task')).toThrow('BASELINE_TARGET_MISMATCH')
    expect(() => f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID() }, randomUUID(), allowed, 'cancel_camera_stage_render_task')).toThrow('BASELINE_EXPIRED')
  })
  it('桥接等待取消后仍持久记录迟到回执，重载后的其他回执不能替代', async () => {
    const f = fixture()
    const record = f.coordinator.prepare(f.callerId, input(f.baseline), f.sessionId, access)
    let sent: LocalHostRequest | undefined
    const bridge = new ApplicationHostBridge(() => undefined, f.coordinator)
    bridge.register({ sessionId: f.sessionId, generation: 1, ready: true, tools: [] }, { send(channel, value) { if (channel === 'mcp:host:request') sent = value as LocalHostRequest } })
    const controller = new AbortController()
    const waiting = bridge.execute(f.callerId, 'change_application_entities', record.input, controller.signal, { operation: record, ...access })
    const rejected = expect(waiting).rejects.toThrow('取消')
    controller.abort()
    await rejected
    expect(f.store.get(record.operationId, f.callerId)?.state).toBe('unknown')
    if (!sent) throw new Error('request missing')
    const result = { ok: true, data: { verification: { verified: true }, effects: [{ target: 'original' }] } }
    bridge.complete({ sessionId: randomUUID(), requestId: sent.requestId, result })
    expect(f.store.get(record.operationId, f.callerId)?.state).toBe('unknown')
    bridge.complete({ sessionId: f.sessionId, requestId: sent.requestId, result })
    expect(f.store.get(record.operationId, f.callerId)).toMatchObject({ state: 'completed', verificationState: 'verified', result })
  })
  it('关闭原生数据库再打开保留回执，未返回的在途操作只核对为未知', () => {
    const filename = join(tmpdir(), `henji-mcp-${randomUUID()}.sqlite`)
    const callerId = randomUUID(); const operationId = randomUUID()
    let db = new Database(filename)
    try {
      const store = new McpOperationStore(db)
      const record = store.prepare({ operationId, callerId, inputDigest: 'input', input: {}, expectedRevisions: {}, state: 'prepared' })
      store.claim(record, randomUUID(), randomUUID())
      db.close(); db = new Database(filename)
      const restored = new McpOperationCoordinator(new McpOperationStore(db))
      expect(restored.store.get(operationId, callerId)?.state).toBe('unknown')
      expect(restored.store.get(operationId, callerId)?.inputDigest).toBe('input')
    } finally { db.close(); unlinkSync(filename) }
  })
  it('增量迁移保留旧业务，派发前持久登记，原子认领拒绝第二次派发', () => {
    const f = fixture(); const raw = input(f.baseline)
    const record = f.coordinator.prepare(f.callerId, raw, f.sessionId, access)
    expect(f.store.get(record.operationId, f.callerId)?.state).toBe('prepared')
    f.coordinator.dispatched(record, randomUUID(), f.sessionId)
    expect(() => f.coordinator.dispatched(record, randomUUID(), f.sessionId)).toThrow('ALREADY_CLAIMED')
    const restored = new McpOperationCoordinator(new McpOperationStore(f.db))
    expect(restored.store.get(record.operationId, f.callerId)?.state).toBe('unknown')
    expect(f.db.prepare('SELECT value FROM existing_business').get()).toEqual({ value: 'keep' })
    expect(restored.prepare(f.callerId, raw, f.sessionId, access).state).toBe('unknown')
  })
  it('操作绑定主体和输入，原目标基线不能用其他对象或旧宿主替代', () => {
    const f = fixture(); const raw = input(f.baseline)
    const record = f.coordinator.prepare(f.callerId, raw, f.sessionId, access)
    expect(() => f.coordinator.prepare(randomUUID(), raw, f.sessionId, access)).toThrow('PERMISSION_DENIED')
    expect(() => f.coordinator.prepare(f.callerId, { ...raw, summary: '不同请求' }, f.sessionId, access)).toThrow('INPUT_CONFLICT')
    expect(() => f.coordinator.prepare(f.callerId, input(f.baseline), randomUUID(), access)).toThrow('BASELINE_EXPIRED')
    const other = f.store.baseline(f.callerId, [{ kind: 'canvas.project', id: 'B' }], { settings: 1 }, f.sessionId)
    expect(() => f.coordinator.prepare(f.callerId, input(other.id), f.sessionId, access)).toThrow('TARGET_MISMATCH')
    expect(f.store.get(record.operationId, f.callerId)?.state).toBe('prepared')
  })
  it('取消及重启未知保留原关联，匹配的迟到回执能收敛，无关读取不能解除', () => {
    const f = fixture(); const record = f.coordinator.prepare(f.callerId, input(f.baseline), f.sessionId, access)
    const requestId = randomUUID(); f.coordinator.dispatched(record, requestId, f.sessionId)
    f.coordinator.interrupted(requestId, f.sessionId)
    expect(() => f.coordinator.prepare(f.callerId, input(f.baseline), f.sessionId, access)).toThrow('RECOVERY_REQUIRED')
    f.coordinator.rememberRead(f.callerId, { ok: true, data: { ref: { kind: 'canvas.project', id: 'B' }, revisions: { canvas: 2 } } }, f.sessionId)
    f.coordinator.complete({ requestId, sessionId: randomUUID(), result: { ok: true } })
    expect(f.store.get(record.operationId, f.callerId)?.state).toBe('unknown')
    f.coordinator.complete({ requestId, sessionId: f.sessionId, result: { ok: true, data: { effects: [{ kind: 'update' }], verification: { verified: true } } } })
    expect(f.coordinator.result(f.store.get(record.operationId, f.callerId)!)).toMatchObject({ executionState: 'completed', verificationState: 'verified' })
    expect(new McpOperationStore(f.db).get(record.operationId, f.callerId)?.result?.ok).toBe(true)
  })
  it('执行成功不是验证通过，部分事务和独立保存失败保留事实', () => {
    for (const result of [{ ok: true }, { ok: false, error: { details: { persistence: { replayMutation: false } } } }, { ok: false, error: { details: { transaction: { effects: [{ target: 'A' }], partial: { completedStepIndexes: [0] } } } } }]) {
      const f = fixture()
      const record = f.coordinator.prepare(f.callerId, input(f.baseline), f.sessionId, access)
      const requestId = randomUUID(); f.coordinator.dispatched(record, requestId, f.sessionId)
      f.coordinator.complete({ requestId, sessionId: f.sessionId, result })
      const saved = f.store.get(record.operationId, f.callerId)!
      expect(saved.result).toEqual(result)
      expect(saved.verificationState).toBe('unresolved')
      expect(saved.state).toBe(result.ok ? 'completed' : 'partial')
    }
  })
  it('正式零步骤失败标记未执行，已有prepared也不能绕过撤销写权限', () => {
    const f = fixture(); const raw = input(f.baseline)
    const record = f.coordinator.prepare(f.callerId, raw, f.sessionId, access)
    expect(() => f.coordinator.prepare(f.callerId, raw, f.sessionId, { allowWrites: false, allowDestructive: false })).toThrow('PERMISSION_DENIED')
    expect(() => f.coordinator.prepare(f.callerId, raw, randomUUID(), access)).toThrow('BASELINE_EXPIRED')
    const requestId = randomUUID(); f.coordinator.dispatched(record, requestId, f.sessionId)
    f.coordinator.complete({ requestId, sessionId: f.sessionId, result: { ok: false, error: { details: { transaction: { partial: { completedStepIndexes: [] } } } } } })
    expect(f.store.get(record.operationId, f.callerId)?.state).toBe('not_executed')
  })
  it('删除检查实际通用动作，不依赖能力的destructive提示', () => {
    const f = fixture()
    expect(() => f.coordinator.prepare(f.callerId, { ...input(f.baseline), changes: [{ kind: 'remove_items', entityType: 'asset.library', parent: { kind: 'asset.catalog', id: 'default' }, targets: [{ kind: 'asset.library', id: 'A' }] }] }, f.sessionId, access)).toThrow('没有删除授权')
  })
  it('仅保存恢复关联原操作与原会话，验证失败不清除部分事实，验证通过才关闭', () => {
    const f = fixture(); const project = { kind: 'canvas.project', id: 'A' }
    const baselineId = f.store.baseline(f.callerId, [project], { canvas: 1 }, f.sessionId).id
    const raw = { operationId: randomUUID(), baselineIds: [baselineId], summary: '改名', changes: [{ kind: 'set_properties', entityType: project.kind, target: project, properties: { 'canvas.project.name': 'after' } }] }
    const record = f.coordinator.prepare(f.callerId, raw, f.sessionId, access)
    const requestId = randomUUID(); f.coordinator.dispatched(record, requestId, f.sessionId)
    const evidence = [{ kind: 'property_value', target: project, fact: '已改名', data: 'after', capturedAt: new Date().toISOString() }]
    const failure = { ok: false, error: { details: { transaction: { effects: [{ target: project }], persistence: { recovery: { capabilityId: 'retry_canvas_project_save', target: project, replayMutation: false } }, recoveryVerification: { conditions: [{ kind: 'property_equals', target: project, propertyId: 'canvas.project.name', expected: 'after' }], evidence } } } } }
    f.coordinator.complete({ requestId, sessionId: f.sessionId, result: failure })
    expect(() => f.coordinator.prepareSaveRecovery(f.callerId, { operationId: randomUUID(), originalOperationId: record.operationId }, randomUUID(), access)).toThrow('SESSION_LOST')
    for (const verified of [false, true]) {
      const recovery = f.coordinator.prepareSaveRecovery(f.callerId, { operationId: randomUUID(), originalOperationId: record.operationId }, f.sessionId, access)
      expect(recovery.input).toEqual({ projectRef: project })
      const saveRequest = randomUUID(); f.coordinator.dispatched(recovery, saveRequest, f.sessionId)
      f.coordinator.complete({ requestId: saveRequest, sessionId: f.sessionId, result: { ok: true, data: { status: 'persisted', verification: { verified } } } })
      expect(f.store.get(record.operationId, f.callerId)?.state).toBe(verified ? 'completed' : 'partial')
      expect(f.store.get(record.operationId, f.callerId)?.result).toEqual(failure)
    }
  })
})
