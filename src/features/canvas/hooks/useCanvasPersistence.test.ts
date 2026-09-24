// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactFlowInstance, Viewport } from '@xyflow/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCanvasStore, type CanvasEdge, type CanvasNode } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'
import { useCanvasPersistence } from './useCanvasPersistence'

vi.mock('@/platform/runtime', () => ({ isUiInspectionReadOnly: () => false }))
const liveViewport = vi.hoisted(() => ({ current: undefined as Viewport | undefined }))
const flowStore = { getState: () => ({ panZoom: liveViewport.current ? { getViewport: () => liveViewport.current } : undefined }) }
vi.mock('@xyflow/react', async importOriginal => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  useStoreApi: () => flowStore,
}))

function project(id: string): Project {
  return { id, name: id, createdAt: 1, updatedAt: 1, coverPath: null, nodeCount: 1,
    nodes: [{ id: `${id}-node`, type: 'uploadNode', position: { x: 0, y: 0 }, data: { imageUrl: `/${id}.png` } }],
    edges: [], history: { past: [], future: [] }, viewport: { x: id === 'a' ? 10 : 20, y: 0, zoom: 1 } }
}

beforeEach(() => {
  liveViewport.current = undefined
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(16), 16))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('挂载保留已装载的后台结果，切项目取消旧保存和视口回调，新项目仍正常自动保存', async () => {
  const a = project('a'); const b = project('b')
  useProjectStore.setState({ currentProjectId: a.id, currentProject: a })
  useCanvasStore.getState().setCanvasData(a.nodes, a.edges, a.history)
  useCanvasStore.getState().setViewportState(a.viewport)
  useCanvasStore.getState().updateNodeData(a.nodes[0].id, { displayName: '后台已更新' })
  const currentNodes = useCanvasStore.getState().nodes
  const save = vi.spyOn(useProjectStore.getState(), 'saveCurrentProject').mockImplementation(() => undefined)
  let renderedViewport = a.viewport
  const setViewport = vi.fn(async (viewport: typeof a.viewport) => { renderedViewport = viewport; return true })
  const flow = { getViewport: () => renderedViewport, setViewport } as unknown as ReactFlowInstance<CanvasNode, CanvasEdge>
  const { result, unmount } = renderHook(() => useCanvasPersistence({ current: null }, flow))
  expect(useCanvasStore.getState().nodes).toBe(currentNodes)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  act(() => { result.current.schedulePersist() })
  act(() => {
    useCanvasStore.getState().setCanvasData(b.nodes, b.edges, b.history)
    useCanvasStore.getState().setViewportState(b.viewport)
    useProjectStore.setState({ currentProjectId: b.id, currentProject: b })
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  expect(save).not.toHaveBeenCalled()
  expect(setViewport).toHaveBeenCalledTimes(1)
  expect(setViewport).toHaveBeenCalledWith(b.viewport, { duration: 0 })
  act(() => { useCanvasStore.getState().updateNodeData(b.nodes[0].id, { displayName: '用户新编辑' }) })
  await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  expect(save).toHaveBeenCalledWith(useCanvasStore.getState().nodes, b.edges, b.viewport, useCanvasStore.getState().history)
  expect(useCanvasStore.getState().nodes[0].data.displayName).toBe('用户新编辑')
  unmount()
})

it('自动保存和切页卸载读取最后输入的位置，不等待视口绘制帧', async () => {
  const a = project('a')
  useProjectStore.setState({ currentProjectId: a.id, currentProject: a })
  useCanvasStore.getState().setCanvasData(a.nodes, a.edges, a.history)
  const save = vi.spyOn(useProjectStore.getState(), 'saveCurrentProject').mockImplementation(() => undefined)
  const flow = { getViewport: () => a.viewport, setViewport: vi.fn(async () => true) } as unknown as ReactFlowInstance<CanvasNode, CanvasEdge>
  const { result, unmount } = renderHook(() => useCanvasPersistence({ current: null }, flow))
  await act(async () => { await vi.advanceTimersByTimeAsync(20) })
  liveViewport.current = { x: -290, y: 80, zoom: 0.5 }
  act(() => result.current.schedulePersist(0))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(save).toHaveBeenLastCalledWith(useCanvasStore.getState().nodes, a.edges, liveViewport.current, useCanvasStore.getState().history)
  liveViewport.current = { x: -310, y: 90, zoom: 0.6 }
  unmount()
  expect(save).toHaveBeenLastCalledWith(useCanvasStore.getState().nodes, a.edges, liveViewport.current, useCanvasStore.getState().history)
})
