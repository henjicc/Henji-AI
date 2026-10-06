// @vitest-environment jsdom
import { canvasTestRegistry, setCanvasTestProjectState } from '@/tests/canvasProjectFixture'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactFlowInstance, Viewport } from '@xyflow/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCanvasStore, type CanvasEdge, type CanvasNode } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'
import { findCanvasProjectInstance } from '@/features/canvas/application/canvasProjectInstances'
import { useCanvasPersistence } from './useCanvasPersistence'

vi.mock('@/platform/runtime', () => ({ isUiInspectionReadOnly: () => false, isDesktopRuntime: () => false }))
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
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(16), 16))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('切换画布时把新画布恢复出的视口应用到画布，不改动已装载的内容', async () => {
  const a = project('a'); const b = project('b')
  setCanvasTestProjectState({ currentProjectId: a.id, currentProject: a })
  useCanvasStore.getState().updateNodeData(a.nodes[0].id, { displayName: '后台已更新' })
  const currentNodes = useCanvasStore.getState().nodes
  const setViewport = vi.fn(async () => true)
  const flow = { getViewport: () => a.viewport, setViewport } as unknown as ReactFlowInstance<CanvasNode, CanvasEdge>
  const { unmount, rerender } = renderHook(() => useCanvasPersistence({ current: null }, flow))
  expect(useCanvasStore.getState().nodes).toBe(currentNodes)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
  expect(setViewport).toHaveBeenLastCalledWith(a.viewport, { duration: 0 })
  act(() => { setCanvasTestProjectState({ currentProjectId: b.id, currentProject: b }) })
  rerender()
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
  expect(setViewport).toHaveBeenLastCalledWith(b.viewport, { duration: 0 })
  unmount()
})

it('切页卸载时把手势最后的视口同步回画布，由实例写进会话状态；schedulePersist(0) 立即写完文档', async () => {
  const a = project('a')
  setCanvasTestProjectState({ currentProjectId: a.id, currentProject: a })
  const flow = { getViewport: () => a.viewport, setViewport: vi.fn(async () => true) } as unknown as ReactFlowInstance<CanvasNode, CanvasEdge>
  const { result, unmount } = renderHook(() => useCanvasPersistence({ current: null }, flow))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
  useCanvasStore.getState().updateNodeData(a.nodes[0].id, { displayName: '立即保存' })
  const flush = vi.spyOn(findCanvasProjectInstance(a.id)!.session, 'flush')
  act(() => result.current.schedulePersist(0))
  expect(flush).toHaveBeenCalledTimes(1)
  liveViewport.current = { x: -310, y: 90, zoom: 0.6 }
  unmount()
  expect(useCanvasStore.getState().currentViewport).toEqual(liveViewport.current)
  const { commands } = canvasTestRegistry()
  await vi.waitFor(async () => expect(await commands.readSessionState({ docId: a.id, key: 'canvas.viewport' })).toEqual({ x: -310, y: 90, zoom: 0.6 }), { timeout: 2_000 })
  expect(useProjectStore.getState().currentProjectId).toBe(a.id)
})

it('恢复的视口还没应用到画布时卸载（或效果重跑），不把画布的默认视口写回，恢复的视口保留', async () => {
  const a = project('a')
  setCanvasTestProjectState({ currentProjectId: a.id, currentProject: a })
  liveViewport.current = { x: 0, y: 0, zoom: 1 }
  const flow = { getViewport: () => liveViewport.current, setViewport: vi.fn(async () => true) } as unknown as ReactFlowInstance<CanvasNode, CanvasEdge>
  const { unmount } = renderHook(() => useCanvasPersistence({ current: null }, flow))
  unmount()
  expect(useCanvasStore.getState().currentViewport).toEqual(a.viewport)
})
