import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  continuePolling: vi.fn(),
  saveMediaFromUrl: vi.fn(),
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
  saveMediaFromUrl: mocks.saveMediaFromUrl,
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
    generate: vi.fn(),
    continuePolling: mocks.continuePolling,
  },
}))

vi.mock('./trace', () => ({
  buildGenerateTrace: vi.fn(),
  buildContinuePollingTrace: vi.fn(() => ({
    phase: 'poll',
    route: 'https://queue.example.test/task/status',
    method: 'GET',
    responseBody: { status: 'completed' },
  })),
}))

import { continuePolling } from './runtime'

const request = {
  modelId: 'fal-ai-z-image-turbo',
  taskId: ' task-1 ',
  params: { prompt: 'test' },
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

describe('ai-runtime continuePolling 日志闭环', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.saveMediaFromUrl.mockResolvedValue('/tmp/result.png')
  })

  it('成功链路记录 start/result，并使用规范化 taskId 保存 pending 结果', async () => {
    mockCompletedProviderResult()

    await expect(continuePolling(request)).resolves.toMatchObject({
      status: 'completed',
      taskId: 'task-1',
      filePath: '/tmp/result.png',
    })

    expect(mocks.savePendingResult).toHaveBeenCalledWith('task-1', expect.any(Object))
    expect(mocks.logger.info).toHaveBeenCalledWith(
      '后端开始轮询',
      expect.objectContaining({ event: 'ai_runtime.poll.start', taskId: 'task-1' }),
    )
    expect(mocks.logger.info).toHaveBeenCalledWith(
      '后端轮询结果',
      expect.objectContaining({ event: 'ai_runtime.poll.result', taskId: 'task-1' }),
    )
    expect(mocks.logger.error).not.toHaveBeenCalled()
  })

  it('落盘后的 pending 保存失败也记录 failed，首个异常保持原样抛出', async () => {
    mockCompletedProviderResult()
    const failure = new Error('pending store unavailable')
    mocks.savePendingResult.mockImplementation(() => {
      throw failure
    })

    await expect(continuePolling(request)).rejects.toBe(failure)

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
