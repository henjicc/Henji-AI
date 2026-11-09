// @vitest-environment jsdom
import { setCanvasTestProjectState, readCanvasTestProject } from '@/tests/canvasProjectFixture'
import { harnessDocumentStore } from '@/tests/harnessNativeStorage'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'
import { createCanvasTidyDraft, applyCanvasTidyDraft, tidyCanvasNodes } from './canvasTidyService'
import { undoCanvasChange } from './canvasApplicationService'
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
    const draft = await createCanvasTidyDraft(projectId, before.nodes, ['n0', 'n1', 'n2'], 'n0', before.edges)
    expect(useCanvasStore.getState().nodes).toBe(before.nodes)
    expect(useCanvasStore.getState().history).toBe(before.history)
    const align = draft.candidates.find(c => c.mode === 'align')!
    await applyCanvasTidyDraft(draft, align)
    const after = useCanvasStore.getState()
    expect(after.history.past).toHaveLength(1)
    expect(after.edges).toBe(before.edges)
    expect(after.nodes.map(n => [n.width, n.height, n.parentId])).toEqual(before.nodes.map(n => [n.width, n.height, n.parentId]))
    expect(after.nodes.map(n => n.position)).toEqual(align.placements.map(p => p.position))
    expect(readCanvasTestProject(projectId)?.nodes.map(n => n.position)).toEqual(after.nodes.map(n => n.position))
    after.undo()
    expect(useCanvasStore.getState().nodes.map(n => n.position)).toEqual(before.nodes.map(n => n.position))
  })
  it('rejects stale preview after movement or lock changes with no partial write', async () => {
    const draft = await createCanvasTidyDraft(projectId, useCanvasStore.getState().nodes, ['n0', 'n1', 'n2'], null, useCanvasStore.getState().edges)
    useCanvasStore.getState().updateNodePosition('n1', { x: 99, y: 88 })
    const before = useCanvasStore.getState()
    await expect(applyCanvasTidyDraft(draft, draft.candidates[0])).rejects.toThrow('画布已变化')
    expect(useCanvasStore.getState().nodes).toBe(before.nodes)
    expect(useCanvasStore.getState().history).toBe(before.history)
  })
  it('generic assistant position writes use the same batch and can undo once', async () => {
    const before = useCanvasStore.getState().nodes
    const draft = await createCanvasTidyDraft(projectId, before, ['n0', 'n1', 'n2'], null, useCanvasStore.getState().edges)
    const context: ApplicationExecutionContext = { requestId: 'tidy', exposure: 'assistant', acceptedDataClasses: new Set(['C0', 'C1']) }
    const steps: Extract<ApplicationPlannedStep, { kind: 'mutation' }>[] = draft.candidates.find(c => c.mode === 'align')!.placements.map(p => ({
      kind: 'mutation', entityType: 'canvas.node', target: { kind: 'canvas.node', id: `${projectId}:${p.nodeId}` }, expectedRevisions: { canvas: 2 },
      mutations: [{ propertyId: 'canvas.node.position', operation: 'set', value: p.position }],
    }))
    await new CanvasNodeMutationExecutor().applyAtomic(steps, context)
    expect(useCanvasStore.getState().history.past).toHaveLength(1)
    expect(readCanvasTestProject(projectId)?.nodes.map(n => n.position.y)).toEqual([100, 100, 100])
    useCanvasStore.getState().undo()
    expect(useCanvasStore.getState().nodes.map(n => n.position)).toEqual(before.map(n => n.position))
  })
  it('assistant tidy of a connected chain moves only that chain left-to-right, reads back positions and undoes once', async () => {
    const before = useCanvasStore.getState().nodes
    const result = await tidyCanvasNodes(projectId, { connectedTo: 'n1', mode: 'flow' }) as {
      positions: { nodeId: string; x: number; y: number }[]; movedCount: number; undoRef?: string; verification: { verified: boolean }
    }
    expect(result.positions.map(p => p.nodeId).sort()).toEqual(['n0', 'n1'])
    expect(result.verification.verified).toBe(true)
    const after = new Map(useCanvasStore.getState().nodes.map(n => [n.id, n.position]))
    expect(after.get('n2')).toEqual(before[2].position)
    expect(after.get('n1')!.x).toBeGreaterThan(after.get('n0')!.x + 100)
    expect(result.positions.map(p => ({ x: p.x, y: p.y }))).toEqual(result.positions.map(p => after.get(p.nodeId)))
    expect(result.undoRef).toBeTruthy()
    await undoCanvasChange(projectId, result.undoRef!)
    expect(useCanvasStore.getState().nodes.map(n => n.position)).toEqual(before.map(n => n.position))
  })
  it('assistant tidy verifies the saved positions of the tidied nodes, not unrelated differences elsewhere in the document', async () => {
    const documents = harnessDocumentStore()
    const read = documents.readDocument.bind(documents)
    // 主进程回读时会换算其他节点里的媒体位置写法，与内存里的写法不必逐字相同。
    const readWith = (change: (node: CanvasNode) => CanvasNode) => vi.spyOn(documents, 'readDocument').mockImplementation(async target => {
      const result = await read(target)
      const content = result.content as { nodes: CanvasNode[] }
      return { ...result, content: { ...content, nodes: content.nodes.map(change) } }
    })
    readWith(node => node.id === 'n2' ? { ...node, data: { ...node.data, content: '同一内容的另一种写法' } } : node)
    const tidied = await tidyCanvasNodes(projectId, { connectedTo: 'n1', mode: 'flow' }) as { verification: { verified: boolean } }
    expect(tidied.verification.verified).toBe(true)
    vi.restoreAllMocks()
    useCanvasStore.getState().updateNodePosition('n1', { x: 999, y: 999 })
    readWith(node => node.id === 'n1' ? { ...node, position: { x: 0, y: 0 } } : node)
    const unsaved = await tidyCanvasNodes(projectId, { connectedTo: 'n1', mode: 'flow' }) as { verification: { verified: boolean } }
    expect(unsaved.verification.verified).toBe(false)
  })
  it('assistant tidy rejects unknown nodes before writing', async () => {
    const before = useCanvasStore.getState()
    await expect(tidyCanvasNodes(projectId, { connectedTo: 'ghost', mode: 'flow' })).rejects.toMatchObject({
      details: { execution: { notExecuted: true } },
    })
    expect(useCanvasStore.getState().history).toBe(before.history)
  })
})
