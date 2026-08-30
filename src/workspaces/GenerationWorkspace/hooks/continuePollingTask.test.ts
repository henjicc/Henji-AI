// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GenerationTask } from '../types'

const mocks = vi.hoisted(() => ({
  consumePendingResult: vi.fn(),
  continuePolling: vi.fn(),
  normalizeMediaResultForDesktop: vi.fn(),
  getMediaDimensions: vi.fn(),
  getMediaDurationFormatted: vi.fn(),
  releaseManagedGenerationMedia: vi.fn(),
}))

vi.mock('@/core/services/GenerationService', () => ({
  GenerationService: {
    getInstance: () => ({ continuePolling: mocks.continuePolling }),
  },
}))

vi.mock('@/utils/mediaDimensions', () => ({
  getMediaDimensions: mocks.getMediaDimensions,
  getMediaDurationFormatted: mocks.getMediaDurationFormatted,
}))

vi.mock('../utils/mediaResult', () => ({
  normalizeMediaResultForDesktop: mocks.normalizeMediaResultForDesktop,
}))

vi.mock('../utils/progressAnimation', () => ({
  resolveProgressSettleDelayMs: () => 0,
}))

vi.mock('@/platform', () => ({
  getPlatform: () => ({
    image: {
      releaseManagedGenerationMedia: mocks.releaseManagedGenerationMedia,
    },
  }),
}))

vi.mock('@/core/logging', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}))

import { continuePollingTask } from './continuePollingTask'

function createTask(): GenerationTask {
  return {
    id: 'task-1',
    createdAt: new Date(0),
    type: 'image',
    prompt: '猫',
    model: 'model-a',
    status: 'error',
    serverTaskId: 'server-task-1',
  }
}

function installNativePendingResult(): void {
  Object.defineProperty(window, 'henjiNative', {
    configurable: true,
    value: {
      ai: {
        consumePendingResult: mocks.consumePendingResult,
      },
    },
  })
}

describe('GenerationWorkspace 缓存续查媒体所有权', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installNativePendingResult()
    mocks.getMediaDimensions.mockResolvedValue('1024x1024')
    mocks.getMediaDurationFormatted.mockResolvedValue(null)
    mocks.releaseManagedGenerationMedia.mockResolvedValue(undefined)
    mocks.normalizeMediaResultForDesktop.mockResolvedValue({
      url: 'henji-media://result.png',
      filePath: '/data/Media/result.png',
    })
  })

  it('命中 pending 缓存后把新建文件随成功结果转移给任务', async () => {
    mocks.consumePendingResult.mockResolvedValue({
      url: 'https://media.example.test/result.png',
      filePath: '/data/Media/result.png',
      createdFilePaths: ['/data/Media/result.png'],
    })
    const updateTask = vi.fn()

    await continuePollingTask({
      task: createTask(),
      genericGenerateFailed: '生成失败',
      notify: vi.fn(),
      updateTask,
      updateProgress: vi.fn(),
      toUserMessage: () => '生成失败',
    })

    expect(mocks.continuePolling).not.toHaveBeenCalled()
    expect(updateTask).toHaveBeenLastCalledWith('task-1', expect.objectContaining({
      status: 'success',
      result: expect.objectContaining({ filePath: '/data/Media/result.png' }),
    }))
    expect(mocks.releaseManagedGenerationMedia).not.toHaveBeenCalled()
  })

  it('pending 缓存已消费但结果提交失败时回收本次新建文件', async () => {
    mocks.consumePendingResult.mockResolvedValue({
      filePath: '/data/Media/result.png',
      createdFilePaths: ['/data/Media/result.png'],
    })
    mocks.normalizeMediaResultForDesktop.mockRejectedValue(new Error('normalize failed'))

    await continuePollingTask({
      task: createTask(),
      genericGenerateFailed: '生成失败',
      notify: vi.fn(),
      updateTask: vi.fn(),
      updateProgress: vi.fn(),
      toUserMessage: () => '本地结果处理失败',
    })

    expect(mocks.releaseManagedGenerationMedia).toHaveBeenCalledWith([
      '/data/Media/result.png',
    ])
  })

  it('pending 缓存没有新建文件所有权时失败也不触发释放', async () => {
    mocks.consumePendingResult.mockResolvedValue({
      filePath: '/data/Media/existing-result.png',
      createdFilePaths: [],
    })
    mocks.normalizeMediaResultForDesktop.mockRejectedValue(new Error('normalize failed'))

    await continuePollingTask({
      task: createTask(),
      genericGenerateFailed: '生成失败',
      notify: vi.fn(),
      updateTask: vi.fn(),
      updateProgress: vi.fn(),
      toUserMessage: () => '本地结果处理失败',
    })

    expect(mocks.releaseManagedGenerationMedia).not.toHaveBeenCalled()
  })
})
