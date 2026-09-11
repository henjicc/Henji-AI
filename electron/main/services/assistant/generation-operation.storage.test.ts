import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeSchema } from '../db'
import { AgentOperationStore } from '../agent-runtime/persistence/operation-store'
import { operationRecordSchema } from '../../../../src/core/assistant/operations'
import { executeGenerationOperation, continueGenerationOperation } from './generation-operation'

const fixture = vi.hoisted(() => ({ database: null as Database.Database | null, generate: vi.fn(), persist: vi.fn(), poll: vi.fn() }))
vi.mock('../db', async (original) => ({ ...await original<typeof import('../db')>(), getDb: () => fixture.database! }))
// 唯一替换外部生成与像素下载；操作登记、归属和重传判断均使用正式 SQLite 实现。
vi.mock('../ai-runtime/runtime', () => ({ generate: fixture.generate, persistGeneratedResponse: fixture.persist, continuePolling: fixture.poll }))

describe.skipIf(!process.versions.electron)('生成提交持久化关联', () => {
  let operations: AgentOperationStore
  let operationId: string
  const request = { requestId: 'original-task', modelId: 'test-model', params: { prompt: '受控测试' } }
  beforeEach(() => {
    fixture.generate.mockReset()
    fixture.persist.mockReset()
    fixture.poll.mockReset()
    fixture.database = new Database(':memory:')
    initializeSchema(fixture.database)
    fixture.database.prepare('INSERT INTO agent_threads(thread_id,title,created_at,updated_at) VALUES (?,?,?,?)')
      .run('thread', '测试', 1, 1)
    fixture.database.prepare(`INSERT INTO agent_runs(run_id,thread_id,goal,request_json,state_json,status,
      checkpoint_version,checkpoint_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run('run', 'thread', '生成', '{}', '{}', 'running', 'test', '{}', 1, 1)
    operations = new AgentOperationStore(fixture.database)
    operationId = operationRecordSchema.parse(operations.execute({ action: 'prepare', intent: {
      runId: 'run', threadId: 'thread', key: 'operation', toolCallId: 'call', toolName: 'create_visible_generation_task',
      toolVersion: 1, inputDigest: 'a'.repeat(64), authorizationDigest: 'b'.repeat(64), readOnly: false,
      container: false, targets: [], targetBindings: {}, expectedRevisions: {},
    } })).operationId
    operations.execute({ action: 'dispatch', runId: 'run', operationId })
    operations.claimExecution('run', operationId)
    operations.bindTransport({ operationId, callId: 'transport', runId: 'run', toolCallId: 'call',
      idempotencyKey: 'operation', webContentsId: 5, rendererSessionId: 'original' })
  })
  afterEach(() => { fixture.database?.close(); fixture.database = null })

  it('原生调用完成但回执尚未送达时，重传返回原结果，不再次提交', async () => {
    const response = { status: 'pending', taskId: 'provider-task', url: '' }
    fixture.generate.mockImplementation(async () => {
      expect(operations.get(operationId)?.externalCalls[0]?.state).toBe('dispatched')
      return response
    })
    expect(await executeGenerationOperation(request, operationId, 5)).toEqual(response)
    expect(await executeGenerationOperation(request, operationId, 5)).toEqual(response)
    expect(fixture.generate).toHaveBeenCalledTimes(1)
    expect(new AgentOperationStore(fixture.database!).get(operationId)?.externalCalls[0]).toMatchObject({
      target: { kind: 'generation.task', id: request.requestId }, state: 'submitted', response,
    })
    await expect(executeGenerationOperation({ ...request, params: { prompt: '其他请求' } }, operationId, 5))
      .rejects.toThrow('OPERATION_EXTERNAL_CONFLICT')
  })

  it('供应商已返回而保存失败仍保留原结果，重连不能重复付费', async () => {
    const response = { status: 'completed', taskId: 'provider-task', url: 'https://fixture.invalid/result.png' }
    fixture.generate.mockImplementation(async (_request, observer: { onProviderResponse: (value: unknown) => void }) => {
      observer.onProviderResponse(response)
      throw new Error('结果保存中断')
    })
    await expect(executeGenerationOperation(request, operationId, 5)).rejects.toThrow('结果保存中断')
    operations.markInterrupted()
    expect(new AgentOperationStore(fixture.database!).get(operationId)?.externalCalls[0]).toMatchObject({ state: 'submitted', response })
    fixture.persist.mockResolvedValue({ ...response, filePath: '/fixture/saved.png' })
    await expect(executeGenerationOperation(request, operationId, 5)).resolves.toMatchObject({ filePath: '/fixture/saved.png' })
    expect(fixture.persist).toHaveBeenCalledWith(request, response)
    expect(fixture.generate).toHaveBeenCalledTimes(1)
  })

  it('无回执的超时保持未知，错误宿主不能发起原操作的提交', async () => {
    await expect(executeGenerationOperation(request, operationId, 6)).rejects.toThrow('OPERATION_OWNER_INVALID')
    expect(fixture.generate).not.toHaveBeenCalled()
    fixture.generate.mockRejectedValue(new Error('网络中断'))
    await expect(executeGenerationOperation(request, operationId, 5)).rejects.toThrow('网络中断')
    await expect(executeGenerationOperation(request, operationId, 5)).rejects.toThrow('不能重复生成')
    expect(fixture.generate).toHaveBeenCalledTimes(1)
  })

  it('续查必须绑定原模型和供应商任务；完成后重传只返回持久化结果', async () => {
    fixture.generate.mockResolvedValue({ status: 'pending', taskId: 'provider-task', url: '' })
    await executeGenerationOperation(request, operationId, 5)
    operations.markInterrupted()
    const polling = { modelId: request.modelId, requestId: request.requestId, taskId: 'provider-task' }
    await expect(continueGenerationOperation({ ...polling, taskId: 'another-task' }, operationId, 5)).rejects.toThrow('OPERATION_EXTERNAL_CONFLICT')
    await expect(continueGenerationOperation({ ...polling, modelId: 'another-model' }, operationId, 5)).rejects.toThrow('OPERATION_EXTERNAL_CONFLICT')
    await expect(continueGenerationOperation(polling, operationId, 6)).rejects.toThrow('OPERATION_OWNER_INVALID')
    expect(fixture.poll).not.toHaveBeenCalled()
    const result = { status: 'completed', taskId: 'provider-task', url: 'https://fixture.invalid/result.png', filePath: '/fixture/result.png' }
    fixture.poll.mockResolvedValue(result)
    expect(await continueGenerationOperation(polling, operationId, 5)).toEqual(result)
    expect(await continueGenerationOperation(polling, operationId, 5)).toEqual(result)
    expect(fixture.generate).toHaveBeenCalledTimes(1)
    expect(fixture.poll).toHaveBeenCalledTimes(1)
    expect(new AgentOperationStore(fixture.database!).get(operationId)?.externalCalls[0]).toMatchObject({
      state: 'completed', serverTaskId: 'provider-task', response: result,
    })
  })

  it('续查得到结果后保存失败，再次继续仅重试保存，不重复轮询或生成', async () => {
    fixture.generate.mockResolvedValue({ status: 'pending', taskId: 'provider-task', url: '' })
    await executeGenerationOperation(request, operationId, 5)
    const raw = { status: 'completed', taskId: 'provider-task', url: 'https://fixture.invalid/result.png' }
    const polling = { modelId: request.modelId, requestId: request.requestId, taskId: 'provider-task' }
    fixture.poll.mockImplementation(async (_request, observer: { onProviderResponse: (value: unknown) => void }) => {
      observer.onProviderResponse(raw)
      throw new Error('磁盘暂时不可写')
    })
    await expect(continueGenerationOperation(polling, operationId, 5)).rejects.toThrow('磁盘暂时不可写')
    expect(operations.get(operationId)?.externalCalls[0]).toMatchObject({ state: 'submitted', response: raw })
    fixture.persist.mockResolvedValue({ ...raw, filePath: '/fixture/result.png' })
    expect(await continueGenerationOperation(polling, operationId, 5)).toMatchObject({ filePath: '/fixture/result.png' })
    expect(fixture.generate).toHaveBeenCalledTimes(1)
    expect(fixture.poll).toHaveBeenCalledTimes(1)
    expect(fixture.persist).toHaveBeenCalledWith({ modelId: request.modelId, requestId: request.requestId }, raw)
  })
})
