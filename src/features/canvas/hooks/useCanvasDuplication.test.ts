/** @vitest-environment jsdom */
import { act, renderHook, cleanup } from '@testing-library/react'
import { applyNodeChanges, type NodeChange } from '@xyflow/react'
import type { MouseEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNode } from '../domain/canvasNodes'
import { useCanvasDuplication } from './useCanvasDuplication'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(), fork: vi.fn(), feedback: vi.fn(),
  project: { currentProjectId: 'project' as string | null },
}))
vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: { getState: mocks.getState } }))
vi.mock('@/stores/projectStore', () => ({ useProjectStore: { getState: () => mocks.project } }))
vi.mock('../application/canvasMutationService', () => ({ commitCanvasNodeDuplication: mocks.fork }))
vi.mock('../application/canvasOperationFeedback', () => ({ reportCanvasOperationFailure: mocks.feedback }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('@/features/cameraStage/projects/cameraStageProjectService', () => ({ cloneCameraStageProject: vi.fn() }))
vi.mock('../application/generationPromptDocument', () => ({ rebaseCanvasLocalPromptData: () => null }))
vi.mock('../application/assetGroupGraph', () => ({ reconcileAssetGroupGraph: vi.fn() }))
vi.mock('../application/canvasDuplicationExecutionState', () => ({ resetDuplicatedCanvasExecutionData: vi.fn() }))
vi.mock('../canvasUtils', () => ({
  cloneNodeData: (data: object) => ({ ...data }),
  getNodeSize: () => ({ width: 200, height: 100 }),
  hasRectCollision: () => false,
}))

type ForkInput = { data: Record<string, unknown>; createNode: (data: Record<string, unknown>) => string }
const event = (altKey: boolean) => ({ altKey } as MouseEvent)
const source = (id: string, x: number): CanvasNode => ({
  id, type: 'uploadNode', position: { x, y: 40 }, selected: true, data: {},
} as CanvasNode)

function setup(multiple = false) {
  let nodes = [source('a', 20), ...(multiple ? [source('b', 240)] : [])]
  const original = nodes.slice()
  const persist = vi.fn()
  mocks.getState.mockImplementation(() => ({ nodes, updateNodeData: vi.fn() }))
  const apply = (changes: NodeChange<CanvasNode>[]) => { nodes = applyNodeChanges(changes, nodes) }
  const { result } = renderHook(() => useCanvasDuplication({
    nodes: original, edges: [], selectedNodeIds: original.map((node) => node.id),
    addNode: (type, position, data) => {
      const id = `copy-${nodes.length}`
      nodes = [...nodes, { id, type, position, data } as CanvasNode]
      return id
    },
    applyNodesChange: apply, connectNodes: vi.fn(), setSelectedNode: vi.fn(), scheduleCanvasPersist: persist,
  }))
  const move = (id: string, x: number, dragging = true) => act(() => {
    apply(result.current.routeDuplicationChanges([{ id, type: 'position', position: { x, y: 80 }, dragging }]))
  })
  return { result, original, nodes: () => nodes, move, persist }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.project.currentProjectId = 'project'
  mocks.fork.mockImplementation(async (input: ForkInput) => input.createNode(input.data))
})
afterEach(cleanup)

describe('Alt 拖拽复制', () => {
  it('按下并开始拖动就创建副本，位移只作用于选中的副本', async () => {
    const view = setup(true)
    await act(async () => { view.result.current.handleNodeDragStart(event(true), view.original[0]) })
    expect(view.nodes()).toHaveLength(4)
    view.move('a', 120)
    view.move('b', 340)
    expect(view.nodes().slice(0, 2).map((node) => node.position.x)).toEqual([20, 240])
    expect(view.nodes().slice(2).map((node) => node.position.x)).toEqual([120, 340])
    expect(view.nodes().filter((node) => node.selected).map((node) => node.id)).toEqual(['copy-2', 'copy-3'])
    view.move('a', 120, false)
    view.move('b', 340, false)
    expect(view.result.current.handleNodeDragStop(event(false), view.original[0])).toBe(true)
    expect(view.nodes()).toHaveLength(4)
    expect(view.persist).toHaveBeenCalled()
  })

  it('异步文档复制尚未完成就松手，保留最终位置且原节点从未移动', async () => {
    let finish!: () => void
    mocks.fork.mockImplementation((input: ForkInput) => new Promise<string>((resolve) => {
      finish = () => resolve(input.createNode(input.data))
    }))
    const view = setup()
    act(() => view.result.current.handleNodeDragStart(event(true), view.original[0]))
    view.move('a', 130)
    view.move('a', 180, false)
    expect(view.nodes()[0].position).toEqual({ x: 20, y: 40 })
    expect(view.result.current.handleNodeDragStop(event(false), view.original[0])).toBe(true)
    await act(async () => finish())
    expect(view.nodes()[1]).toMatchObject({ position: { x: 180, y: 80 }, dragging: false })
    expect(view.persist).toHaveBeenCalled()
  })

  it('普通拖动仍移动原节点，不触发复制', () => {
    const view = setup()
    act(() => view.result.current.handleNodeDragStart(event(false), view.original[0]))
    view.move('a', 140)
    expect(view.nodes()[0].position.x).toBe(140)
    expect(mocks.fork).not.toHaveBeenCalled()
    expect(view.result.current.handleNodeDragStop(event(false), view.original[0])).toBe(false)
  })

  it('复制失败给出反馈，释放后下一次普通拖动可以继续', async () => {
    mocks.fork.mockRejectedValueOnce(new Error('文档复制失败'))
    const view = setup()
    await act(async () => view.result.current.handleNodeDragStart(event(true), view.original[0]))
    view.move('a', 120)
    expect(view.nodes()[0].position.x).toBe(20)
    expect(mocks.feedback).toHaveBeenCalledWith(expect.objectContaining({ message: '文档复制失败' }))
    view.result.current.handleNodeDragStop(event(false), view.original[0])
    act(() => view.result.current.handleNodeDragStart(event(false), view.original[0]))
    view.move('a', 140)
    expect(view.nodes()[0].position.x).toBe(140)
  })
})
