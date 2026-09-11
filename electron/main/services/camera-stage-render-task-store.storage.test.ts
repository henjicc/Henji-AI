import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeSchema } from './db'
import { createCameraStageRenderTaskPersistence } from './camera-stage-render-task-store'
import { CameraStageRenderTaskRegistry, type CameraStageRenderRequestDto } from './camera-stage-render-task-registry'
import { AgentOperationStore } from './agent-runtime/persistence/operation-store'
import { operationRecordSchema } from '../../../src/core/assistant/operations'

describe.skipIf(!process.versions.electron)('原生渲染任务持久化', () => {
  let database: Database.Database
  let registry: CameraStageRenderTaskRegistry
  const request: CameraStageRenderRequestDto = { requestId: 'render-1', canvasProjectId: 'canvas-1', nodeId: 'node-1',
    cameraStageProjectId: 'stage-1', resolutionPreset: '720p', outputKind: 'image', selectedTimeSec: 1 }
  const result = { kind: 'image' as const, mediaUrl: 'media://result', mediaPath: '/result.png', savedPath: '/result.png',
    width: 1280, height: 720, aspectRatio: '16:9', selectedTimeSec: 1 }
  const restored = () => new CameraStageRenderTaskRegistry(createCameraStageRenderTaskPersistence(() => database))
  beforeEach(() => { database = new Database(':memory:'); initializeSchema(database); registry = restored() })
  afterEach(() => { vi.restoreAllMocks(); database.close() })

  it('完成结果在回执发送前已保存，重建主机后按原请求读取且不重放', () => {
    registry.register(request, 7)
    registry.markRunning(request.requestId)
    registry.applyEvent({ type: 'completed', requestId: request.requestId, nodeId: request.nodeId, result })
    const next = restored()
    expect(next.require(request, 9)).toMatchObject({ status: 'completed', result })
    expect(next.register(request, 9)).toMatchObject({ idempotent: true, task: { status: 'completed', result } })
    expect(() => next.register({ ...request, outputKind: 'video' }, 9)).toThrow('identity conflicts')
    expect(() => next.require(request, 10)).toThrow('does not belong')
  })

  it('重建主机只把排队和在途任务标为中断，不重新渲染；错误目标不能接管', () => {
    registry.register(request, 7)
    registry.markRunning(request.requestId)
    const next = restored()
    expect(() => next.require({ ...request, nodeId: 'other' }, 9)).toThrow('does not belong')
    expect(next.list(request.canvasProjectId, 9)).toEqual([expect.objectContaining({ status: 'cancelled', result: null })])
    expect(next.register(request, 9).idempotent).toBe(true)
    expect(() => next.markRunning(request.requestId)).toThrow('not queued')
  })

  it('已接收任务的防重放记录跨重启保留，不受内存过期清理影响', () => {
    registry.register(request, 7)
    registry.applyEvent({ type: 'completed', requestId: request.requestId, nodeId: request.nodeId, result })
    registry.acknowledge(request, 7)
    const next = restored()
    expect(next.list(request.canvasProjectId, 9)).toEqual([])
    expect(next.require(request, 9)).toBeNull()
    expect(() => next.register(request, 9)).toThrow('already completed and acknowledged')
    expect(createCameraStageRenderTaskPersistence(() => database).get(request.requestId)?.result).toEqual(result)
  })

  it('媒体已保存但完成通知丢失时，重建后只核对原文件摘要；不匹配或无关目标不能恢复', async () => {
    registry.register(request, 7)
    registry.markRunning(request.requestId)
    registry.prepareOutput(request.requestId, result, 'a'.repeat(64))
    const persistence = createCameraStageRenderTaskPersistence(() => database)
    expect(persistence.get(request.requestId)).toMatchObject({ status: 'running', result: null,
      outputPersistence: { result, digest: 'a'.repeat(64) } })
    const next = restored()
    const check = vi.fn(async () => false)
    await expect(next.reconcileOutput({ ...request, nodeId: 'other' }, 9, check)).rejects.toThrow('RENDER_OUTPUT_OWNER_INVALID')
    expect(check).not.toHaveBeenCalled()
    await next.reconcileOutput(request, 9, check)
    expect(next.require(request, 9)).toMatchObject({ status: 'cancelled', result: null })
    expect(() => next.acknowledge(request, 9)).toThrow('RENDER_OUTPUT_NEEDS_CHECK')
    check.mockResolvedValue(true)
    await next.reconcileOutput(request, 9, check)
    expect(check).toHaveBeenLastCalledWith(result.mediaPath, 'a'.repeat(64))
    expect(next.require(request, 9)).toMatchObject({ status: 'completed', result })
    expect(restored().require(request, 11)).toMatchObject({ status: 'completed', result })
    expect(next.register(request, 9).idempotent).toBe(true)
  })

  it('输出路径登记失败阻止文件写入边界，迟到错误不抹掉已核对结果', async () => {
    registry.register(request, 7)
    registry.markRunning(request.requestId)
    const persistence = createCameraStageRenderTaskPersistence(() => database)
    const save = vi.spyOn(database, 'prepare').mockImplementationOnce(() => { throw new Error('登记失败') })
    expect(() => registry.prepareOutput(request.requestId, result, 'a'.repeat(64))).toThrow('登记失败')
    save.mockRestore()
    expect(persistence.get(request.requestId)?.outputPersistence).toBeUndefined()
    registry.prepareOutput(request.requestId, result, 'a'.repeat(64))
    expect(() => registry.prepareOutput(request.requestId, { ...result, mediaPath: '/other.png' }, 'a'.repeat(64))).toThrow('RENDER_OUTPUT_IDENTITY_CONFLICT')
    await registry.reconcileOutput(request, 7, async () => true)
    registry.applyEvent({ type: 'failed', requestId: request.requestId, nodeId: request.nodeId, message: '通知断开' })
    expect(registry.require(request, 7)).toMatchObject({ status: 'completed', result })
  })

  it('业务任务和助手提交回执原子保存，终态保存失败不能发布成功', () => {
    database.prepare('INSERT INTO agent_threads(thread_id,title,created_at,updated_at) VALUES (?,?,?,?)').run('thread','测试',1,1)
    database.prepare(`INSERT INTO agent_runs(run_id,thread_id,goal,request_json,state_json,status,
      checkpoint_version,checkpoint_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run('run','thread','渲染','{}','{}','running','test','{}',1,1)
    const operations = new AgentOperationStore(database)
    const operation = operationRecordSchema.parse(operations.execute({ action: 'prepare', intent: {
      runId: 'run', threadId: 'thread', key: 'render', toolCallId: 'call', toolName: 'render_camera_stage_output', toolVersion: 1,
      inputDigest: 'a'.repeat(64), authorizationDigest: 'b'.repeat(64), readOnly: false, container: false,
      targets: [], targetBindings: {}, expectedRevisions: {},
    } }))
    operations.execute({ action: 'dispatch', runId: 'run', operationId: operation.operationId })
    operations.claimExecution('run', operation.operationId)
    operations.bindTransport({ operationId: operation.operationId, callId: 'transport', runId: 'run', toolCallId: 'call',
      idempotencyKey: 'render', webContentsId: 7, rendererSessionId: 'original' })
    const correlated = { ...request, operationId: operation.operationId }
    expect(() => registry.register(correlated, 8)).toThrow('OPERATION_OWNER_INVALID')
    expect(database.prepare('SELECT * FROM camera_stage_render_tasks').all()).toEqual([])
    registry.register(correlated, 7)
    expect(operations.get(operation.operationId)?.externalCalls[0]).toMatchObject({ state: 'dispatched', key: request.requestId })
    const failure = vi.spyOn(AgentOperationStore.prototype, 'recordExternalCall').mockImplementation(() => { throw new Error('journal interrupted') })
    expect(() => registry.applyEvent({ type: 'completed', requestId: request.requestId, nodeId: request.nodeId, result })).toThrow('journal interrupted')
    expect(registry.require(request, 7)?.status).toBe('queued')
    expect(createCameraStageRenderTaskPersistence(() => database).get(request.requestId)?.status).toBe('queued')
    failure.mockRestore()
    registry.applyEvent({ type: 'completed', requestId: request.requestId, nodeId: request.nodeId, result })
    expect(operations.get(operation.operationId)?.externalCalls[0]).toMatchObject({ state: 'completed', response: { status: 'completed', result } })
    expect(restored().require(request, 9)?.result).toEqual(result)
  })
})
