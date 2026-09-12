import type { AiGenerateResponseDto } from '@henjicc/ai-sdk'
const submissions = vi.hoisted(() => new Map<string, { response: AiGenerateResponseDto; phase: string }>())
vi.mock('./generation-submissions', () => ({
  claimGenerationSubmission: (id: string) => submissions.get(id)?.response ?? null,
  completeGenerationSubmission: (id: string, response: AiGenerateResponseDto, phase = 'completed') => submissions.set(id, { response, phase }),
  readGenerationSubmission: (id: string) => submissions.get(id)?.response ?? null,
  readGenerationSubmissionStage: (id: string) => submissions.has(id) ? { phase: submissions.get(id)!.phase, modelId: 'fal-ai-z-image-turbo' } : undefined,
}))
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  generate: vi.fn(),
  continuePolling: vi.fn(),
  saveMediaFromUrlTracked: vi.fn(),
  releaseSavedMediaFileLease: vi.fn(),
  savePendingResult: vi.fn(),
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

vi.mock('./pending-results', () => ({
  savePendingResult: mocks.savePendingResult,
}))

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

import { continuePolling, generate } from './runtime'

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
      metadata: {},
    }
  })
}

describe('ai-runtime continuePolling 日志闭环', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    submissions.clear()
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
      filePath: '/tmp/result.png',
      createdFilePaths: ['/tmp/result.png'],
    })
  })

  it('供应商完成但媒体保存失败，只重试保存原响应，供应商仅执行一次', async () => {
    mockCompletedGenerateResult()
    mocks.saveMediaFromUrlTracked.mockRejectedValueOnce(new Error('media-disk-full'))
    const input = { modelId: request.modelId, params: request.params, requestId: request.requestId }
    await expect(generate(input)).rejects.toThrow('media-disk-full')
    expect(submissions.get(request.requestId)?.phase).toBe('provider')
    await expect(generate(input)).resolves.toMatchObject({ status: 'completed', filePath: '/tmp/result.png' })
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
      filePath: '/tmp/result.png',
      createdFilePaths: ['/tmp/result.png'],
    })

    expect(mocks.savePendingResult).toHaveBeenCalledWith('task-1', expect.any(Object))
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

  it('内容寻址媒体已存在时不把共享文件交给调用方回收', async () => {
    mockCompletedProviderResult()
    mocks.saveMediaFromUrlTracked.mockResolvedValue({
      filePath: '/tmp/existing-result.png',
      created: false,
    })

    await expect(continuePolling(request)).resolves.toMatchObject({
      filePath: '/tmp/existing-result.png',
      createdFilePaths: [],
    })
  })

  it('落盘后的 pending 保存失败也记录 failed，首个异常保持原样抛出', async () => {
    mockCompletedProviderResult()
    const failure = new Error('pending store unavailable')
    mocks.savePendingResult.mockImplementation(() => {
      throw failure
    })

    await expect(continuePolling(request)).rejects.toBe(failure)

    expect(mocks.releaseSavedMediaFileLease).toHaveBeenCalledWith('/tmp/result.png')
    expect(mocks.logger.error).toHaveBeenCalledWith(
      '后端轮询失败',
      expect.objectContaining({
        event: 'ai_runtime.poll.failed',
        taskId: 'task-1',
        error: expect.objectContaining({ message: 'pending store unavailable' }),
      }),
    )
  })
})
