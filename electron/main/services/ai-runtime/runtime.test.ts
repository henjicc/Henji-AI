import { AiRuntimeError } from '@henjicc/ai-sdk'
import type { HostGenerateResponse } from './host-response'
const submissions = vi.hoisted(() => new Map<string, { response: HostGenerateResponse; phase: string }>())
vi.mock('./generation-submissions', () => ({
  completePolledGenerationSubmission: vi.fn(),
  claimGenerationSubmission: (id: string) => submissions.get(id)?.response ?? null,
  completeGenerationSubmission: (id: string, response: HostGenerateResponse, phase = 'completed') => submissions.set(id, { response, phase }),
  readGenerationSubmission: (id: string) => submissions.get(id)?.response ?? null,
  readGenerationSubmissionStage: (id: string) => submissions.has(id) ? { phase: submissions.get(id)!.phase, modelId: 'fal-ai-z-image-turbo' } : undefined,
}))
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  generate: vi.fn(),
  continuePolling: vi.fn(),
  saveMediaFromUrlTracked: vi.fn(),
  releaseSavedMediaFileLease: vi.fn(),
  pendingWrite: vi.fn(),
  pendingRows: new Map<string, { result_json: string; completed_at: number }>(),
}))

vi.mock('../keystore', () => ({
  getAiProviderApiKey: vi.fn(() => null),
  getAiProviderKeyStatus: vi.fn(() => []),
}))

vi.mock('../logging', () => ({
  createMainLogger: vi.fn(() => mocks.logger),
  sanitizeJsonValue: vi.fn((value: unknown) => value),
}))

vi.mock('./media-store', () => ({
  saveMediaFromUrlTracked: mocks.saveMediaFromUrlTracked,
  releaseSavedMediaFileLease: mocks.releaseSavedMediaFileLease,
}))

vi.mock('../db', () => ({ getDb: () => ({ prepare: () => ({
  run: (id: string, json: string, time: number) => { mocks.pendingWrite(id, json, time); mocks.pendingRows.set(id, { result_json: json, completed_at: time }) },
  get: (id: string) => mocks.pendingRows.get(id),
}) }) }))
vi.mock('../db-locations', () => ({ databaseLocations: { use: (action: (scope: { encodeValue: (value: unknown) => unknown; decodeValue: (value: unknown) => unknown }) => unknown) => action({ encodeValue: value => value, decodeValue: value => value }) } }))

vi.mock('./progress', () => ({
  getProgressEstimate: vi.fn(),
  recordProgressSample: vi.fn(),
}))

vi.mock('./sdk-runtime', () => ({
  sdkAIClient: {
    catalog: {
      list: vi.fn(() => []),
      resolveParams: vi.fn(),
    },
    cancel: vi.fn(),
    generate: mocks.generate,
    continuePolling: mocks.continuePolling,
  },
}))

vi.mock('./trace', () => ({
  buildGenerateTrace: vi.fn(() => ({
    phase: 'generate',
    route: 'https://queue.example.test/generate',
    method: 'POST',
    responseBody: { status: 'completed' },
  })),
  buildContinuePollingTrace: vi.fn(() => ({
    phase: 'poll',
    route: 'https://queue.example.test/task/status',
    method: 'GET',
    responseBody: { status: 'completed' },
  })),
}))

import { consumePendingResult } from './pending-results'
import { cancelRuntimeTask, hasActiveGenerationWork, continuePolling, generate } from './runtime'
import { createDiagnosticTransport } from './network-transport'

const request = {
  modelId: 'fal-ai-z-image-turbo',
  taskId: ' task-1 ',
  params: { prompt: 'test' },
  requestId: 'local-redraw-chain-1',
}

function mockCompletedProviderResult(): void {
  mocks.continuePolling.mockImplementation(async (
    _request: unknown,
    options: {
      onRequestBuilt: (info: {
        providerId: string
        route: string
        method: string
        requestBody: Record<string, unknown>
      }) => void
    },
  ) => {
    options.onRequestBuilt({
      providerId: 'fal',
      route: 'https://queue.example.test/task/status',
      method: 'GET',
      requestBody: {},
    })
    return {
      status: 'completed',
      url: 'https://media.example.test/result.png',
      urls: ['https://media.example.test/result.png'],
      taskId: 'task-1',
      metadata: { status_url: 'https://queue.example.test/task/status' },
    }
  })
}

function mockCompletedGenerateResult(): void {
  mocks.generate.mockImplementation(async (
    _request: unknown,
    options: {
      onRequestBuilt: (info: {
        providerId: string
        route: string
        method: string
        requestBody: Record<string, unknown>
      }) => void
    },
  ) => {
    options.onRequestBuilt({
      providerId: 'fal',
      route: 'https://queue.example.test/generate',
      method: 'POST',
      requestBody: { prompt: 'test' },
    })
    return {
      status: 'completed',
      url: 'https://media.example.test/result.png',
      urls: ['https://media.example.test/result.png'],
      metadata: {},
    }
  })
}

describe('ai-runtime continuePolling 日志闭环', () => {
  it('KIE 接受创建后失败，日志记录实际 recordInfo 和原始关键字段，不再把创建 route 标为轮询', async () => {
    const payload = { code: 200, data: { state: 'fail', failCode: '500', failMsg: 'Internal Error, Please try again later.', param: '{}', costTime: 4, createTime: 1, completeTime: 5 } }
    mocks.continuePolling.mockImplementationOnce(async (_request: unknown, options: { onRequestBuilt: (info: { providerId: string; route: string; method: string; requestBody: object }) => void }) => {
      options.onRequestBuilt({ providerId: 'kie', route: '/api/v1/jobs/createTask', method: 'GET', requestBody: {} })
      const transport = createDiagnosticTransport(vi.fn().mockResolvedValue(Response.json(payload)), vi.fn())
      await transport.fetch('https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task-1')
      throw new AiRuntimeError('provider_internal_error', 'KIE 服务内部错误，可稍后手动重试。')
    })
    await expect(continuePolling({ ...request, modelId: 'kie-eleven-v3-dialogue' })).rejects.toThrow('KIE 服务内部错误')
    expect(mocks.logger.error).toHaveBeenCalledWith('后端轮询失败', expect.objectContaining({ requestId: request.requestId, taskId: 'task-1', providerId: 'kie', context: { phase: 'poll', route: 'https://api.kie.ai/api/v1/jobs/recordInfo', method: 'GET', responseBody: { ...payload, data: { ...payload.data, param: {} } } } }))
    expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain('/api/v1/jobs/createTask')
  })
  it.each(['generate', 'continuePolling'] as const)('%s 保留供应商端点诊断并关联原请求', async phase => {
    const details = { submissionState: 'not_sent', attempts: [{ host: 'api.apib.ai', code: 'ECONNRESET', stage: 'before_send', durationMs: 10 }] }
    const failure = new AiRuntimeError('provider_network_error', '连接失败', details)
    mocks[phase].mockRejectedValueOnce(failure)
    const input = { ...request, requestId: `diagnostic-${phase}` }
    await expect(phase === 'generate' ? generate(input) : continuePolling(input)).rejects.toBe(failure)
    expect(mocks.logger.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      requestId: input.requestId, error: expect.objectContaining({ code: 'provider_network_error', details }),
    }))
  })
  beforeEach(() => {
    vi.clearAllMocks()
    submissions.clear()
    mocks.pendingRows.clear()
    mocks.pendingWrite.mockReset()
    mocks.saveMediaFromUrlTracked.mockResolvedValue({
      filePath: '/tmp/result.png',
      created: true,
    })
    mocks.releaseSavedMediaFileLease.mockResolvedValue(undefined)
  })

  it('即时完成的生成响应携带本次新建媒体所有权', async () => {
    mockCompletedGenerateResult()

    await expect(generate({
      modelId: request.modelId,
      params: request.params,
      requestId: request.requestId,
    })).resolves.toMatchObject({
      status: 'completed',
      filePaths: ['/tmp/result.png'],
      createdFilePaths: ['/tmp/result.png'],
    })
  })

  it('供应商完成但媒体保存失败，只重试保存原响应，供应商仅执行一次', async () => {
    mockCompletedGenerateResult()
    mocks.saveMediaFromUrlTracked.mockRejectedValueOnce(new Error('media-disk-full'))
    const input = { modelId: request.modelId, params: request.params, requestId: request.requestId }
    await expect(generate(input)).rejects.toThrow('media-disk-full')
    expect(submissions.get(request.requestId)?.phase).toBe('provider')
    await expect(generate(input)).resolves.toMatchObject({ status: 'completed', filePaths: ['/tmp/result.png'] })
    expect(submissions.get(request.requestId)?.phase).toBe('completed')
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    await generate(input)
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.saveMediaFromUrlTracked).toHaveBeenCalledTimes(2)
  })
  it('成功链路记录 start/result，并使用规范化 taskId 保存 pending 结果', async () => {
    mockCompletedProviderResult()

    await expect(continuePolling(request)).resolves.toMatchObject({
      status: 'completed',
      taskId: 'task-1',
      filePaths: ['/tmp/result.png'],
      createdFilePaths: ['/tmp/result.png'],
    })

    expect(consumePendingResult('task-1')).toMatchObject({ filePaths: ['/tmp/result.png'] })
    expect(mocks.continuePolling).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'local-redraw-chain-1' }),
      expect.any(Object),
    )
    expect(mocks.logger.info).toHaveBeenCalledWith(
      '后端开始轮询',
      expect.objectContaining({
        event: 'ai_runtime.poll.start',
        taskId: 'task-1',
        requestId: 'local-redraw-chain-1',
      }),
    )
    expect(mocks.logger.info).toHaveBeenCalledWith(
      '后端轮询结果',
      expect.objectContaining({ event: 'ai_runtime.poll.result', taskId: 'task-1' }),
    )
    expect(mocks.logger.error).not.toHaveBeenCalled()
  })

  it('SDK 给出的多个结果地址逐个保存并按输出顺序返回', async () => {
    mocks.generate.mockImplementation(async (_request: unknown, options: { onRequestBuilt: (info: { providerId: string; route: string; method: string; requestBody: Record<string, unknown> }) => void }) => {
      options.onRequestBuilt({ providerId: 'fal', route: 'https://queue.example.test/generate', method: 'POST', requestBody: {} })
      return { status: 'completed', url: 'https://media.example.test/a.png|||https://media.example.test/b.png', urls: ['https://media.example.test/a.png', 'https://media.example.test/b.png'], metadata: {} }
    })
    mocks.saveMediaFromUrlTracked.mockImplementation(async (url: string) => ({ filePath: url.endsWith('a.png') ? '/tmp/a.png' : '/tmp/b.png', created: true }))
    const result = await generate({ modelId: request.modelId, params: request.params, requestId: 'multi-output' })
    expect(result).toMatchObject({
      urls: ['https://media.example.test/a.png', 'https://media.example.test/b.png'],
      filePaths: ['/tmp/a.png', '/tmp/b.png'],
    })
    expect(result).not.toHaveProperty('url')
    expect(result).not.toHaveProperty('filePath')
  })

  it('内容寻址媒体已存在时不把共享文件交给调用方回收', async () => {
    mockCompletedProviderResult()
    mocks.saveMediaFromUrlTracked.mockResolvedValue({
      filePath: '/tmp/existing-result.png',
      created: false,
    })

    await expect(continuePolling(request)).resolves.toMatchObject({
      filePaths: ['/tmp/existing-result.png'],
      createdFilePaths: [],
    })
  })

  it('真实回执的数据库写失败明确报未确认，保留媒体并可在超过一天后恢复', async () => {
    mockCompletedProviderResult()
    const failure = new Error('pending store unavailable')
    mocks.pendingWrite.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw failure })
    await expect(continuePolling(request)).rejects.toThrow('结果已生成、保存未确认')
    expect(mocks.releaseSavedMediaFileLease).not.toHaveBeenCalled()
    expect(mocks.logger.error).toHaveBeenCalledWith('结果已生成，保存尚未确认', expect.objectContaining({ taskId: 'task-1', error: failure }))
    expect(consumePendingResult('task-1')).toMatchObject({ filePaths: ['/tmp/result.png'] })
    mocks.pendingRows.get('task-1')!.completed_at = Date.now() - 48 * 60 * 60 * 1000
    expect(consumePendingResult('task-1')).toMatchObject({ filePaths: ['/tmp/result.png'] })
  })

  it('取消贯穿主进程保存，及时释放忙碌状态并保留供应商回执', async () => {
    mockCompletedProviderResult()
    let started!: () => void
    const saving = new Promise<void>(resolve => { started = resolve })
    mocks.saveMediaFromUrlTracked.mockImplementationOnce((_url: string, context: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })
      started()
    }))
    const result = continuePolling(request)
    const failed = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await saving
    expect(hasActiveGenerationWork()).toBe(true)
    cancelRuntimeTask('task-1')
    await failed
    expect(hasActiveGenerationWork()).toBe(false)
    expect(consumePendingResult('task-1')).toMatchObject({ urls: ['https://media.example.test/result.png'] })
  })
})
