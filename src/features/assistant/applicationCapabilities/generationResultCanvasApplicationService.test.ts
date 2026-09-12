import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getResult: vi.fn(),
  addTrustedMediaCanvasNode: vi.fn(),
  project: { currentProjectId: 'canvas-1' as string | null },
  canvas: { selectedNodeId: 'selected-1' as string | null },
}))
vi.mock('@/stores/projectStore', () => ({ useProjectStore: { getState: () => mocks.project } }))
vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: { getState: () => mocks.canvas } }))

vi.mock('@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand', () => ({
  getVisibleGenerationTaskResult: mocks.getResult,
}))
vi.mock('@/features/canvas/application/canvasApplicationService', () => ({
  addTrustedMediaCanvasNode: mocks.addTrustedMediaCanvasNode,
}))

vi.mock('@/features/canvas/application/canvasProjectRuntime', () => ({ withCanvasProjectRuntime: async (_id: string, execute: (runtime: unknown) => Promise<unknown>) => execute({}) }))
vi.mock('@/features/canvas/application/canvasBatchService', () => ({ runCanvasTransaction: async (_id: string, _count: number, execute: (options: unknown) => Promise<unknown>) => ({ appliedOperations: await execute({}), undoRef: 'batch-undo-1' }) }))
vi.mock('@/features/canvas/application/canvasQueryService', () => ({ readPersistedCanvasProjectSnapshot: async () => ({ nodes: [{ id: 'node-1' }] }) }))
import { addGenerationResultToCanvas } from './generationResultCanvasApplicationService'

describe('generation result canvas bridge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('只凭稳定生成结果引用解析内部媒体，并落成可验证画布节点', async () => {
    mocks.getResult.mockReturnValue({
      taskId: 'task-1', mediaType: 'image', url: 'henji-media://generation/result-1',
      filePath: 'C:/managed-generation/result-1.png', prompt: '赛博朋克海报',
    })
    mocks.addTrustedMediaCanvasNode.mockResolvedValue({
      projectId: 'canvas-1', nodeId: 'node-1', nodeType: 'uploadNode', undoRef: 'undo-1',
    })

    const result = await addGenerationResultToCanvas({
      projectId: 'canvas-1',
      resultRef: { kind: 'generation.result', id: 'task-1' },
      placement: { mode: 'absolute', x: 320, y: 180 },
    })

    expect(mocks.getResult).toHaveBeenCalledWith('task-1')
    expect(mocks.addTrustedMediaCanvasNode).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'canvas-1', nodeType: 'uploadNode',
      placement: { mode: 'absolute', x: 320, y: 180 },
      data: expect.objectContaining({ imageUrl: 'C:/managed-generation/result-1.png' }),
    }), {})
    expect(result).toMatchObject({
      undoRef: 'batch-undo-1',
      resultRef: { kind: 'generation.result', id: 'task-1' },
      nodeRef: { kind: 'canvas.node', id: 'canvas-1:node-1' },
    })
    expect(result).not.toHaveProperty('filePath')
    expect(result).not.toHaveProperty('url')
  })

  it('未完成或失效的生成引用不会调用画布写入', async () => {
    mocks.getResult.mockReturnValue(null)
    await expect(addGenerationResultToCanvas({
      projectId: 'canvas-1',
      resultRef: { kind: 'generation.result', id: 'task-pending' },
      placement: { mode: 'viewport_center' },
    })).rejects.toThrow('GENERATION_RESULT_NOT_AVAILABLE')
    expect(mocks.addTrustedMediaCanvasNode).not.toHaveBeenCalled()
  })
  it.each(['image', 'video', 'audio'] as const)('长提示词的 %s 结果使用短名称并默认放到当前选中节点旁', async mediaType => {
    mocks.getResult.mockReturnValue({ mediaType, url: 'C:/result.bin', prompt: '详细描述'.repeat(300) })
    mocks.addTrustedMediaCanvasNode.mockResolvedValue({ nodeId: 'node-1' })
    await addGenerationResultToCanvas({ projectId: 'canvas-1', resultRef: { kind: 'generation.result', id: 'task-1' } })
    expect(mocks.addTrustedMediaCanvasNode).toHaveBeenCalledWith(expect.objectContaining({
      placement: { mode: 'right_of_node', anchorNodeId: 'selected-1' },
      data: expect.objectContaining({ sourceFileName: '详细描述'.repeat(30) }),
    }), {})
  })
  it('指定其他项目时不误用当前项目的选中节点', async () => {
    mocks.getResult.mockReturnValue({ mediaType: 'image', url: 'C:/result.png', prompt: '' })
    mocks.addTrustedMediaCanvasNode.mockResolvedValue({ nodeId: 'node-1' })
    await addGenerationResultToCanvas({ projectId: 'other-project', resultRef: { kind: 'generation.result', id: 'task-1' } })
    expect(mocks.addTrustedMediaCanvasNode).toHaveBeenCalledWith(expect.objectContaining({
      placement: { mode: 'viewport_center' }, data: expect.objectContaining({ sourceFileName: '生成结果' }),
    }), {})
  })
})
