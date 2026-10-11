// @vitest-environment jsdom
import { setCanvasTestProjectState, readCanvasTestProject } from '@/tests/canvasProjectFixture'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'
import { createCanvasTidyDraft, applyCanvasTidyDraft } from './canvasTidyService'
import { CanvasNodeMutationExecutor } from './canvasMutationExecutor'
import type { ApplicationExecutionContext, ApplicationPlannedStep } from '@/core/application-control'

const nodes = (): CanvasNode[] => [0, 1, 2].map(i => ({ id: `n${i}`, type: CANVAS_NODE_TYPES.textAnnotation,
  position: { x: i * 240, y: 100 + i * 50 }, width: 100, height: 80, selected: true, data: { content: `卡片 ${i}` } }))
const projectId = 'tidy-test'
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  setCanvasTestProjectState({ currentProjectId: projectId, currentProject: {
    id: projectId, name: '整理', createdAt: 1, updatedAt: 2, nodeCount: 3, coverPath: null,
    nodes: nodes(), edges: [{ id: 'edge', source: 'n0', target: 'n1' }], viewport: { x: 120, y: -70, zoom: .5 }, history: { past: [], future: [] },
  } })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('canvas tidy commit', () => {
  it('preview is read-only; apply saves all positions in one undo while preserving links and dimensions', async () => {
    const before = useCanvasStore.getState()
    const draft = await createCanvasTidyDraft(projectId, before.nodes, ['n0', 'n1', 'n2'], 'n0')
    expect(useCanvasStore.getState().nodes).toBe(before.nodes)
    expect(useCanvasStore.getState().history).toBe(before.history)
    await applyCanvasTidyDraft(draft, draft.candidates[1])
    const after = useCanvasStore.getState()
    expect(after.history.past).toHaveLength(1)
    expect(after.edges).toBe(before.edges)
    expect(after.nodes.map(n => [n.width, n.height, n.parentId])).toEqual(before.nodes.map(n => [n.width, n.height, n.parentId]))
    expect(after.nodes.map(n => n.position)).toEqual(draft.candidates[1].placements.map(p => p.position))
    expect(readCanvasTestProject(projectId)?.nodes.map(n => n.position)).toEqual(after.nodes.map(n => n.position))
    after.undo()
    expect(useCanvasStore.getState().nodes.map(n => n.position)).toEqual(before.nodes.map(n => n.position))
  })
  it('rejects stale preview after movement or lock changes with no partial write', async () => {
    const draft = await createCanvasTidyDraft(projectId, useCanvasStore.getState().nodes, ['n0', 'n1', 'n2'], null)
    useCanvasStore.getState().updateNodePosition('n1', { x: 99, y: 88 })
    const before = useCanvasStore.getState()
    await expect(applyCanvasTidyDraft(draft, draft.candidates[0])).rejects.toThrow('画布已变化')
    expect(useCanvasStore.getState().nodes).toBe(before.nodes)
    expect(useCanvasStore.getState().history).toBe(before.history)
  })
  it('generic assistant position writes use the same batch and can undo once', async () => {
    const before = useCanvasStore.getState().nodes
    const draft = await createCanvasTidyDraft(projectId, before, ['n0', 'n1', 'n2'], null)
    const context: ApplicationExecutionContext = { requestId: 'tidy', exposure: 'assistant', permissions: new Set(['canvas:read', 'canvas:write']), acceptedDataClasses: new Set(['C0', 'C1']) }
    const steps: Extract<ApplicationPlannedStep, { kind: 'mutation' }>[] = draft.candidates[0].placements.map(p => ({
      kind: 'mutation', entityType: 'canvas.node', target: { kind: 'canvas.node', id: `${projectId}:${p.nodeId}` }, expectedRevisions: { canvas: 2 },
      mutations: [{ propertyId: 'canvas.node.position', operation: 'set', value: p.position }],
    }))
    await new CanvasNodeMutationExecutor().applyAtomic(steps, context)
    expect(useCanvasStore.getState().history.past).toHaveLength(1)
    expect(readCanvasTestProject(projectId)?.nodes.map(n => n.position.y)).toEqual([100, 100, 100])
    useCanvasStore.getState().undo()
    expect(useCanvasStore.getState().nodes.map(n => n.position)).toEqual(before.map(n => n.position))
  })
})
