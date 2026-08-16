import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getResult: vi.fn(),
  addTrustedMediaCanvasNode: vi.fn(),
}))

vi.mock('@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand', () => ({
  getVisibleGenerationTaskResult: mocks.getResult,
}))
vi.mock('@/features/canvas/application/canvasApplicationService', () => ({
  addTrustedMediaCanvasNode: mocks.addTrustedMediaCanvasNode,
}))

import { addGenerationResultToCanvas } from './generationResultCanvasApplicationService'

describe('generation result canvas bridge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('只凭稳定生成结果引用解析内部媒体，并落成可验证画布节点', () => {
    mocks.getResult.mockReturnValue({
      taskId: 'task-1', mediaType: 'image', url: 'henji-media://generation/result-1',
      filePath: 'C:/managed-generation/result-1.png', prompt: '赛博朋克海报',
    })
    mocks.addTrustedMediaCanvasNode.mockReturnValue({
      projectId: 'canvas-1', nodeId: 'node-1', nodeType: 'uploadNode', undoRef: 'undo-1',
    })

    const result = addGenerationResultToCanvas({
      projectId: 'canvas-1',
      resultRef: { kind: 'generation.result', id: 'task-1' },
      placement: { mode: 'absolute', x: 320, y: 180 },
    })

    expect(mocks.getResult).toHaveBeenCalledWith('task-1')
    expect(mocks.addTrustedMediaCanvasNode).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'canvas-1', nodeType: 'uploadNode',
      placement: { mode: 'absolute', x: 320, y: 180 },
      data: expect.objectContaining({ imageUrl: 'C:/managed-generation/result-1.png' }),
    }))
    expect(result).toMatchObject({
      resultRef: { kind: 'generation.result', id: 'task-1' },
      nodeRef: { kind: 'canvas.node', id: 'node-1' },
    })
    expect(result).not.toHaveProperty('filePath')
    expect(result).not.toHaveProperty('url')
  })

  it('未完成或失效的生成引用不会调用画布写入', () => {
    mocks.getResult.mockReturnValue(null)
    expect(() => addGenerationResultToCanvas({
      projectId: 'canvas-1',
      resultRef: { kind: 'generation.result', id: 'task-pending' },
      placement: { mode: 'viewport_center' },
    })).toThrow('GENERATION_RESULT_NOT_AVAILABLE')
    expect(mocks.addTrustedMediaCanvasNode).not.toHaveBeenCalled()
  })
})
