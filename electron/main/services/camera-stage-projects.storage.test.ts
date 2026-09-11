import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeSchema } from './db'
import { AgentOperationStore } from './agent-runtime/persistence/operation-store'
import { operationRecordSchema } from '../../../src/core/assistant/operations'
import { registerCameraStageProjectsIpc } from '../ipc/camera-stage-projects'
import { getCameraStageProject, upsertCameraStageProject } from './camera-stage-projects'

const fixture = vi.hoisted(() => ({
  database: null as Database.Database | null,
  handlers: new Map<string, (input: unknown, event: { sender: { id: number } }) => unknown>(),
  clearCover: vi.fn(),
}))
vi.mock('./db', async (original) => ({ ...await original<typeof import('./db')>(), getDb: () => fixture.database! }))
vi.mock('../ipc/registry', async (original) => ({ ...await original<typeof import('../ipc/registry')>(),
  registerIpcHandler: (channel: string, parse: (input: unknown) => unknown,
    handle: (input: unknown, event: { sender: { id: number } }) => unknown) => {
    fixture.handlers.set(channel, (input, event) => handle(parse(input), event))
  },
}))
vi.mock('./project-covers', () => ({ clearProjectCover: fixture.clearCover }))

describe.skipIf(!process.versions.electron)('三维工程正式 IPC 的原生事务保存关联', () => {
  let operations: AgentOperationStore
  let operationId: string
  const target = { kind: 'camera_stage.project', id: 'project' }
  const event = { sender: { id: 5 } }
  const record = { id: 'project', name: '原名', createdAt: 1, updatedAt: 2, objectCount: 0, sceneJson: '{}' }
  const correlation = () => ({ operationId, boundaryId: 'boundary', targets: [target] })
  const invoke = (channel: string, input: unknown) => fixture.handlers.get(`cameraStageProjects:${channel}`)!(input, event)
  beforeEach(() => {
    fixture.database = new Database(':memory:')
    initializeSchema(fixture.database)
    fixture.database.prepare('INSERT INTO agent_threads(thread_id,title,created_at,updated_at) VALUES (?,?,?,?)')
      .run('thread', '测试', 1, 1)
    fixture.database.prepare(`INSERT INTO agent_runs(run_id,thread_id,goal,request_json,state_json,status,
      checkpoint_version,checkpoint_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run('run', 'thread', '修改工程', '{}', '{}', 'running', 'test', '{}', 1, 1)
    operations = new AgentOperationStore(fixture.database)
    operationId = operationRecordSchema.parse(operations.execute({ action: 'prepare', intent: {
      runId: 'run', threadId: 'thread', key: 'operation', toolCallId: 'call', toolName: 'change_application_entities',
      toolVersion: 1, inputDigest: 'a'.repeat(64), authorizationDigest: 'b'.repeat(64), readOnly: false,
      container: false, targets: [target], targetBindings: {}, expectedRevisions: {},
    } })).operationId
    operations.execute({ action: 'dispatch', runId: 'run', operationId })
    operations.claimExecution('run', operationId)
    operations.bindTransport({ operationId, callId: 'transport', runId: 'run', toolCallId: 'call',
      idempotencyKey: 'operation', webContentsId: 5, rendererSessionId: 'session' })
    fixture.clearCover.mockReset().mockResolvedValue(undefined)
    upsertCameraStageProject(record)
    registerCameraStageProjectsIpc()
  })
  afterEach(() => { vi.restoreAllMocks(); fixture.database?.close(); fixture.database = null })

  it.each(['upsert', 'rename'])('%s 与操作回执原子提交，日志失败不能留下未记录的修改', (channel) => {
    const input = channel === 'upsert' ? { ...record, name: '新名', operationCorrelation: correlation() }
      : { projectId: 'project', name: '新名', updatedAt: 3, operationCorrelation: correlation() }
    const failure = vi.spyOn(AgentOperationStore.prototype, 'recordPersistence')
      .mockImplementationOnce(() => { throw new Error('保存记录失败') })
    expect(() => invoke(channel, input)).toThrow('保存记录失败')
    expect(getCameraStageProject('project')?.name).toBe('原名')
    expect(operations.get(operationId)?.persistenceReceipts).toEqual([])
    failure.mockRestore()
    invoke(channel, input)
    operations.markInterrupted()
    expect(getCameraStageProject('project')?.name).toBe('新名')
    expect(operations.get(operationId)).toMatchObject({ state: 'unknown', persistenceReceipts: [{ targets: [target] }] })
    expect(() => invoke(channel, { ...input, name: '借旧操作再次修改' })).toThrow('OPERATION_PERSISTENCE_CONFLICT')
    expect(getCameraStageProject('project')?.name).toBe('新名')
  })

  it('删除只在原生删除与操作记录一同提交后确认，封面等待期间不持有 SQLite 事务', async () => {
    fixture.clearCover.mockImplementation(async () => { expect(fixture.database!.inTransaction).toBe(false) })
    const input = { projectId: 'project', operationCorrelation: correlation() }
    const failure = vi.spyOn(AgentOperationStore.prototype, 'recordPersistence')
      .mockImplementationOnce(() => { throw new Error('保存记录失败') })
    await expect(invoke('delete', input)).rejects.toThrow('保存记录失败')
    expect(getCameraStageProject('project')).not.toBeNull()
    failure.mockRestore()
    await invoke('delete', input)
    expect(getCameraStageProject('project')).toBeNull()
    expect(operations.get(operationId)?.persistenceReceipts).toHaveLength(1)
  })

  it('错误宿主或跨工程关联不能进入删除与封面清理', async () => {
    const remove = fixture.handlers.get('cameraStageProjects:delete')!
    await expect(remove({ projectId: 'project', operationCorrelation: correlation() }, { sender: { id: 6 } }))
      .rejects.toThrow('OPERATION_OWNER_INVALID')
    await expect(remove({ projectId: 'other', operationCorrelation: correlation() }, event))
      .rejects.toThrow('OPERATION_PERSISTENCE_TARGET_INVALID')
    expect(fixture.clearCover).not.toHaveBeenCalled()
    expect(getCameraStageProject('project')).not.toBeNull()
  })

  it('不存在的工程重命名不能写入成功保存事实', () => {
    fixture.database!.prepare('DELETE FROM camera_stage_projects').run()
    expect(() => invoke('rename', { projectId: 'project', name: '新名', updatedAt: 3, operationCorrelation: correlation() }))
      .toThrow('NOT_FOUND')
    expect(operations.get(operationId)?.persistenceReceipts).toEqual([])
  })
})
