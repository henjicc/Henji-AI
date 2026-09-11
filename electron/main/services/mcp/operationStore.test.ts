import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { McpOperationStore } from './operationStore'
import { McpOperationCoordinator } from './operationCoordinator'
import { ApplicationHostBridge } from './applicationHostBridge'
import type { LocalHostRequest } from '../../../../src/core/application-control/localHostContracts'

const opened: Database.Database[] = []
afterEach(() => { for (const db of opened.splice(0)) db.close() })
function fixture(): { db: Database.Database; store: McpOperationStore; coordinator: McpOperationCoordinator; callerId: string; sessionId: string; baseline: string } {
  const db = new Database(':memory:'); opened.push(db)
  db.exec("CREATE TABLE existing_business(id TEXT PRIMARY KEY, value TEXT); INSERT INTO existing_business VALUES('old','keep');")
  const store = new McpOperationStore(db)
  const coordinator = new McpOperationCoordinator(store)
  const callerId = randomUUID(); const sessionId = randomUUID()
  const baseline = store.baseline(callerId, [{ kind: 'settings.registry', id: 'singleton' }], { settings: 1 }, sessionId).id
  return { db, store, coordinator, callerId, sessionId, baseline }
}
const access = { allowWrites: true, allowDestructive: false }
function input(baselineId: string): Record<string, unknown> {
  return { operationId: randomUUID(), baselineIds: [baselineId], summary: '修改主题', changes: [{ kind: 'set_properties', entityType: 'settings.registry', target: { kind: 'settings.registry', id: 'singleton' }, properties: { 'interface.theme_tone': 'dark' } }] }
}

describe('MCP 原生操作记录与恢复', () => {
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
