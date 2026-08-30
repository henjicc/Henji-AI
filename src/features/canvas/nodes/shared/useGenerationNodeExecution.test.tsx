// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import type { TFunction } from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'

const { executorCleanup, registerCanvasNodeExecutor } = vi.hoisted(() => {
  const cleanup = vi.fn()
  return {
    executorCleanup: cleanup,
    registerCanvasNodeExecutor: vi.fn(() => cleanup),
  }
})

vi.mock('@/features/canvas/application/canvasExecutionService', () => ({
  registerCanvasNodeExecutor,
}))

import { useGenerationNodeExecution } from './useGenerationNodeExecution'

describe('useGenerationNodeExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('节点普通重渲染时保持同一个生成执行器，避免当前运行被重试并创建双占位节点', () => {
    const t = vi.fn((key: string) => key) as unknown as TFunction
    const setPromptInvalid = vi.fn()
    const { rerender, unmount } = renderHook(({ revision }) => {
      useGenerationNodeExecution({
        nodeId: 'generation-node',
        modelType: 'image',
        resultNodeType: CANVAS_NODE_TYPES.exportImage,
        acceptedKinds: ['image'],
        acceptedMediaKinds: ['image'],
        capability: null,
        showModelInput: true,
        requirePrompt: true,
        promptRequiredKey: 'promptRequired',
        apiKeyRequiredKey: 'apiKeyRequired',
        resultTitleKey: 'resultTitle',
        resultNodeExtraData: { revision },
        prepareGenerationRequest: async () => ({ resultNodeData: { revision } }),
        setPromptInvalid,
        t,
      })
    }, { initialProps: { revision: 0 } })

    expect(registerCanvasNodeExecutor).toHaveBeenCalledTimes(1)

    rerender({ revision: 1 })

    expect(registerCanvasNodeExecutor).toHaveBeenCalledTimes(1)
    expect(executorCleanup).not.toHaveBeenCalled()

    unmount()
    expect(executorCleanup).toHaveBeenCalledTimes(1)
  })
})
