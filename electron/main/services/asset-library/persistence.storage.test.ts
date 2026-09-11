import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeSchema } from '../db'
import { AgentOperationStore } from '../agent-runtime/persistence/operation-store'
import { operationRecordSchema } from '../../../../src/core/assistant/operations'
import { registerAssetLibraryIpc } from '../../ipc/asset-library'
import { inspectLibrary, listLibraries } from './index'

const storage = vi.hoisted(() => ({ current: null as Database.Database | null }))
const handlers = vi.hoisted(() => new Map<string, (input: unknown, event: { sender: { id: number } }) => unknown>())
vi.mock('../db', async (original) => ({ ...await original<typeof import('../db')>(), getDb: () => {
  if (!storage.current) throw new Error('测试数据库未初始化')
  return storage.current
} }))
vi.mock('../../ipc/registry', async (original) => ({ ...await original<typeof import('../../ipc/registry')>(),
  registerIpcHandler: (channel: string, parse: (input: unknown) => unknown,
    handle: (input: unknown, event: { sender: { id: number } }) => unknown) => {
    handlers.set(channel, (input, event) => handle(parse(input), event))
  },
}))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

describe.skipIf(!process.versions.electron)('素材正式 IPC 的原子保存关联', () => {
  let operations: AgentOperationStore
  let operationId: string
  function invoke(action: string, input: Record<string, unknown>, senderId = 5): unknown {
    return handlers.get(`assetLibrary:${action}`)!(input, { sender: { id: senderId } })
  }
  function correlation(boundaryId: string, kind?: string, id?: string) {
    return { operationId, boundaryId, targets: kind && id ? [{ kind, id }] : [] }
  }
  beforeEach(() => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    storage.current = database
    initializeSchema(database)
    database.prepare('INSERT INTO agent_threads(thread_id,title,created_at,updated_at) VALUES (?,?,?,?)').run('thread', '素材测试', 1, 1)
    database.prepare(`INSERT INTO agent_runs(run_id,thread_id,goal,request_json,state_json,status,
      checkpoint_version,checkpoint_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run('run', 'thread', '整理素材', '{}', '{}', 'running', 'test', '{}', 1, 1)
    operations = new AgentOperationStore(database)
    operationId = operationRecordSchema.parse(operations.execute({ action: 'prepare', intent: {
      runId: 'run', threadId: 'thread', key: 'operation', toolCallId: 'call', toolName: 'change_application_entities',
      toolVersion: 1, inputDigest: 'a'.repeat(64), authorizationDigest: 'b'.repeat(64), readOnly: false,
      container: false, targets: [{ kind: 'asset.catalog', id: 'default' }], targetBindings: {}, expectedRevisions: {},
    } })).operationId
    operations.execute({ action: 'dispatch', runId: 'run', operationId })
    operations.claimExecution('run', operationId)
    operations.bindTransport({ operationId, callId: 'transport', runId: 'run', toolCallId: 'call',
      idempotencyKey: 'operation', webContentsId: 5, rendererSessionId: 'session' })
    registerAssetLibraryIpc()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    storage.current?.close()
    storage.current = null
    handlers.clear()
  })

  it('新建集合和实际引用一起保存；无回执或错误宿主都不能留下重复业务结果', () => {
    const input = { name: '集合', operationCorrelation: correlation('create') }
    expect(() => invoke('createLibrary', input, 6)).toThrow('OPERATION_OWNER_INVALID')
    const failure = vi.spyOn(AgentOperationStore.prototype, 'recordPersistence').mockImplementationOnce(() => { throw new Error('journal failed') })
    expect(() => invoke('createLibrary', input)).toThrow('journal failed')
    expect(listLibraries()).toEqual([])
    expect(operations.get(operationId)?.persistenceReceipts).toEqual([])
    failure.mockRestore()
    const created = invoke('createLibrary', input) as { id: string }
    expect(listLibraries()).toHaveLength(1)
    operations.markInterrupted()
    const restored = new AgentOperationStore(storage.current!).get(operationId)!
    expect(restored.state).toBe('unknown')
    expect(restored.persistenceReceipts).toMatchObject([{ boundaryId: 'create', targets: [{ kind: 'asset.library', id: created.id }] }])
    expect(() => invoke('createLibrary', { ...input, name: '借旧边界重复创建' })).toThrow('OPERATION_PERSISTENCE_CONFLICT')
    expect(listLibraries()).toHaveLength(1)
  })

  it('素材改名、标签和集合归属的保存失败均回滚；目标错配不能关联到另一个对象', () => {
    const database = storage.current!
    database.prepare('INSERT INTO assets(id,media_type,display_name,file_path,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run('asset', 'image', '原名', 'C:/fixture.png', 'imported', 1, 1)
    const library = invoke('createLibrary', { name: '集合' }) as { id: string }
    for (const [action, payload] of [
      ['updateAsset', { id: 'asset', name: '新名' }],
      ['setAssetTags', { assetId: 'asset', tags: ['标签'] }],
      ['addToLibrary', { assetId: 'asset', libraryId: library.id }],
    ] as const) {
      const failure = vi.spyOn(AgentOperationStore.prototype, 'recordPersistence').mockImplementationOnce(() => { throw new Error('journal failed') })
      expect(() => invoke(action, { ...payload, operationCorrelation: correlation(action, 'asset', 'asset') })).toThrow('journal failed')
      failure.mockRestore()
    }
    expect(database.prepare('SELECT display_name FROM assets WHERE id=?').get('asset')).toEqual({ display_name: '原名' })
    expect(database.prepare('SELECT * FROM asset_tag_items').all()).toEqual([])
    expect(inspectLibrary(library.id).assetIds).toEqual([])
    expect(() => invoke('updateAsset', { id: 'asset', name: '错配', operationCorrelation: correlation('wrong', 'asset', 'other') }))
      .toThrow('OPERATION_PERSISTENCE_TARGET_INVALID')
    invoke('addToLibrary', { assetId: 'asset', libraryId: library.id, operationCorrelation: correlation('added', 'asset', 'asset') })
    expect(inspectLibrary(library.id).assetIds).toEqual(['asset'])
    expect(operations.get(operationId)?.persistenceReceipts[0]?.targets).toEqual([{ kind: 'asset', id: 'asset' }])
  })

  it('集合改名、删除及恢复复用原服务，同步保留各自的保存事实', () => {
    const library = invoke('createLibrary', { name: '集合' }) as { id: string }
    const renamed = { id: library.id, name: '新名', operationCorrelation: correlation('rename', 'asset.library', library.id) }
    const failure = vi.spyOn(AgentOperationStore.prototype, 'recordPersistence').mockImplementationOnce(() => { throw new Error('journal failed') })
    expect(() => invoke('renameLibrary', renamed)).toThrow('journal failed')
    expect(inspectLibrary(library.id).name).toBe('集合')
    failure.mockRestore()
    invoke('renameLibrary', renamed)
    const snapshot = inspectLibrary(library.id)
    invoke('deleteLibrary', { id: library.id, operationCorrelation: correlation('delete', 'asset.library', library.id) })
    expect(listLibraries()).toEqual([])
    invoke('restoreLibrary', { ...snapshot, operationCorrelation: correlation('restore', 'asset.library', library.id) })
    expect(inspectLibrary(library.id)).toEqual(snapshot)
    expect(operations.get(operationId)?.persistenceReceipts.map((item) => item.boundaryId)).toEqual(['rename', 'delete', 'restore'])
  })
})
