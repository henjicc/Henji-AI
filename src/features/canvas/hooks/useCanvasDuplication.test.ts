/** @vitest-environment jsdom */
import { act, renderHook, cleanup } from '@testing-library/react'
import { applyNodeChanges, type NodeChange } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNode } from '../domain/canvasNodes'
import { useCanvasDuplication } from './useCanvasDuplication'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(), fork: vi.fn(), feedback: vi.fn(),
  project: { currentProjectId: 'project' as string | null },
}))
vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: { getState: mocks.getState },
  canvasStoreAttachment: { batchViewUpdates: <T,>(work: () => T) => work() } }))
vi.mock('@/stores/projectStore', () => ({ useProjectStore: { getState: () => mocks.project } }))
vi.mock('../application/canvasMutationService', () => ({ commitCanvasNodesDuplication: mocks.fork }))
vi.mock('../application/canvasOperationFeedback', () => ({ reportCanvasOperationFailure: mocks.feedback }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('../application/generationPromptDocument', () => ({ rebaseCanvasLocalPromptData: () => null }))
vi.mock('../application/assetGroupGraph', () => ({ reconcileAssetGroupGraph: vi.fn() }))
vi.mock('../application/canvasDuplicationExecutionState', () => ({ resetDuplicatedCanvasExecutionData: vi.fn() }))
vi.mock('../canvasUtils', () => ({
  cloneNodeData: (data: object) => ({ ...data }),
  getNodeSize: () => ({ width: 200, height: 100 }),
  hasRectCollision: () => false,
}))

type ForkInput = {
  nodes: { sourceNodeId: string; data: Record<string, unknown> }[]
  createNodes: (data: Record<string, unknown>[]) => unknown
}
const commit = (input: ForkInput) => input.createNodes(input.nodes.map(node => node.data))
const event = (altKey: boolean) => new MouseEvent('mousedown', { altKey })
const source = (id: string, x: number): CanvasNode => ({
  id, type: 'uploadNode', position: { x, y: 40 }, selected: true, data: {},
} as CanvasNode)

function setup(multiple = false, withThird = false) {
  let nodes = [source('a', 20), ...(multiple ? [source('b', 240)] : []), ...(withThird ? [source('c', 460)] : [])]
  const original = nodes.slice()
  const persist = vi.fn()
  mocks.getState.mockImplementation(() => ({ nodes, edges: [], history: { past: [], future: [] }, updateNodeData: vi.fn() }))
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
  mocks.fork.mockImplementation(commit)
})
afterEach(cleanup)

describe('Alt 拖拽复制', () => {
  it('整批来源等待结束后才按原顺序提交全部节点', async () => {
    const view = setup(true, true)
    let finish!: () => void
    mocks.fork.mockImplementation((input: ForkInput) => new Promise(resolve => { finish = () => resolve(commit(input)) }))
    let pending!: ReturnType<typeof view.result.current.duplicateNodes>
    act(() => { pending = view.result.current.duplicateNodes(['a', 'b', 'c']) })
    expect(view.nodes()).toHaveLength(3)
    await act(async () => { finish(); await pending })
    expect(view.nodes().slice(3).map(node => node.id)).toEqual(['copy-3', 'copy-4', 'copy-5'])
    expect(view.persist).toHaveBeenCalledTimes(1)
  })

  it('文档等待期间切换画布拒绝接管，不继续创建后续节点', async () => {
    const view = setup(true)
    let finish!: () => void
    mocks.fork.mockImplementation((input: ForkInput) => new Promise((resolve, reject) => {
      finish = () => { try { resolve(commit(input)) } catch (error) { reject(error) } }
    }))
    let pending!: ReturnType<typeof view.result.current.duplicateNodes>
    act(() => { pending = view.result.current.duplicateNodes(['a', 'b']) })
    mocks.project.currentProjectId = 'other'
    await act(async () => {
      finish()
      await expect(pending).rejects.toThrow('画布已切换')
    })
    expect(view.nodes()).toHaveLength(2)
    expect(mocks.fork).toHaveBeenCalledTimes(1)
    expect(view.persist).not.toHaveBeenCalled()
  })

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
    mocks.fork.mockImplementation((input: ForkInput) => new Promise((resolve) => {
      finish = () => resolve(commit(input))
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
