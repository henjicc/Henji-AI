// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import { canvasTidyGeometryKey } from '../application/canvasTidyLayout'
import { useCanvasTidy } from './useCanvasTidy'

vi.mock('../application/canvasTidyService', () => ({
  createCanvasTidyDraft: async (projectId: string, nodes: CanvasNode[], nodeIds: string[], pin: string | null) => ({
    projectId, baseline: canvasTidyGeometryKey(nodes), nodeIds, pin,
    candidates: [{ mode: 'align', placements: nodeIds.map(nodeId => ({ nodeId, position: { x: 500, y: 200 } })) }],
  }),
  applyCanvasTidyDraft: vi.fn(async () => {}),
}))
vi.mock('../application/canvasOperationFeedback', () => ({ reportCanvasOperationFailure: vi.fn() }))
afterEach(() => { vi.clearAllMocks() })

describe('canvas tidy view projection', () => {
  const fixture = (): CanvasNode[] => [0, 1].map(i => ({ id: String(i), type: CANVAS_NODE_TYPES.textAnnotation,
    position: { x: i * 200, y: i * 90 }, width: 100, height: 80, selected: true, data: { content: '参考' } }))
  it('projects cards without changing persisted nodes, and cancellation restores the exact render input', async () => {
    const nodes = fixture(); const before = structuredClone(nodes)
    const hook = renderHook(() => useCanvasTidy('p', nodes, nodes))
    await act(() => hook.result.current.start())
    expect(hook.result.current.previewNodes.map(n => n.position)).toEqual([{ x: 500, y: 200 }, { x: 500, y: 200 }])
    expect(nodes).toEqual(before)
    expect(hook.result.current.previewNodes.every(n => n.draggable === false)).toBe(true)
    act(() => hook.result.current.cancel())
    expect(hook.result.current.previewNodes).toBe(nodes)
    hook.unmount()
  })
  it('discards projection on geometry/selection changes or another project, without applying it', async () => {
    const nodes = fixture()
    const hook = renderHook(({ projectId, values }) => useCanvasTidy(projectId, values, values), { initialProps: { projectId: 'p', values: nodes } })
    await act(() => hook.result.current.start())
    const next = nodes.map(n => ({ ...n, selected: false }))
    hook.rerender({ projectId: 'p', values: next })
    expect(hook.result.current.draft).toBeNull()
    expect(hook.result.current.previewNodes).toBe(next)
    hook.rerender({ projectId: 'other', values: nodes })
    expect(hook.result.current.previewNodes).toBe(nodes)
    hook.unmount()
  })
})
