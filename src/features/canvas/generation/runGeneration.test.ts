import { beforeEach, describe, expect, it, vi } from 'vitest'

const { continuePolling, generate, persistImageLocally } = vi.hoisted(() => ({
  continuePolling: vi.fn(),
  generate: vi.fn(),
  persistImageLocally: vi.fn(),
}))

vi.mock('@/core/ModelRegistry', () => ({
  registry: {
    getModel: () => ({ meta: { id: 'test-model' } }),
    getModelsByType: () => [],
  },
}))
vi.mock('@/core/modelCatalog/controlledExecutionModels', () => ({
  getControlledExecutionModel: () => null,
}))
vi.mock('@/core/services/GenerationService', () => ({
  GenerationService: { getInstance: () => ({ continuePolling, generate }) },
}))
vi.mock('@/features/canvas/application/imageData', () => ({ persistImageLocally }))
vi.mock('@/features/generation/application/taskServerId', () => ({
  extractServerTaskIdFromMetadata: () => null,
}))

import { runCanvasGeneration } from './runGeneration'

describe('runCanvasGeneration 付费请求门禁', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('本地媒体准备期间输入失效时不提交供应商任务', async () => {
    let releaseLocalization: (() => void) | undefined
    persistImageLocally.mockImplementation(async () => {
      await new Promise<void>((resolve) => { releaseLocalization = resolve })
      return '/managed/source.png'
    })
    const assertCurrent = vi.fn(async () => { throw new Error('输入已变化') })
    const running = runCanvasGeneration({
      modelId: 'test-model',
      params: { prompt: '猫' },
      upstream: { images: ['/source.png'] },
      assertCurrent,
    })

    await vi.waitFor(() => expect(persistImageLocally).toHaveBeenCalledWith('/source.png'))
    releaseLocalization?.()

    await expect(running).rejects.toThrow('输入已变化')
    expect(assertCurrent).toHaveBeenCalledTimes(1)
    expect(generate).not.toHaveBeenCalled()
  })

  it('把局部重绘链路 ID 传给模型生成服务', async () => {
    generate.mockResolvedValue({
      status: 'completed',
      filePath: '/managed/result.png',
      createdFilePaths: ['/managed/result.png', '/managed/result.png'],
    })

    await expect(runCanvasGeneration({
      modelId: 'test-model',
      requestId: 'local-redraw-chain-1',
      params: { prompt: '替换杯子' },
    })).resolves.toMatchObject({
      primary: '/managed/result.png',
      createdFilePaths: ['/managed/result.png'],
    })

    expect(generate).toHaveBeenCalledWith(
      'test-model',
      expect.objectContaining({ prompt: '替换杯子' }),
      undefined,
      { progressSource: 'canvas', requestId: 'local-redraw-chain-1' },
    )
  })

  it('异步轮询继续沿用局部重绘链路 ID', async () => {
    generate.mockResolvedValue({ status: 'pending', taskId: 'task-1' })
    continuePolling.mockResolvedValue({
      status: 'completed',
      filePath: '/managed/result.png',
      createdFilePaths: ['/managed/result.png'],
    })

    await expect(runCanvasGeneration({
      modelId: 'test-model',
      requestId: 'local-redraw-chain-2',
      params: { prompt: '替换杯子' },
    })).resolves.toMatchObject({
      primary: '/managed/result.png',
      createdFilePaths: ['/managed/result.png'],
    })

    expect(continuePolling).toHaveBeenCalledWith(
      'test-model',
      'task-1',
      expect.objectContaining({ prompt: '替换杯子' }),
      undefined,
      { progressSource: 'canvas', requestId: 'local-redraw-chain-2' },
    )
  })
})
