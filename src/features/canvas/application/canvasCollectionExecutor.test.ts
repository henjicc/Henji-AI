// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApplicationPlannedStep } from '@/core/application-control'
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'

import { resetCanvasBatchStateForTests } from './canvasBatchService'
import { CanvasCollectionExecutor } from './canvasCollectionExecutor'
import { CANVAS_ENTITY_TYPES } from './canvasReflection'

const projectId = 'canvas-collection-project'

function project(): Project {
  return {
    id: projectId,
    name: '集合写入测试',
    createdAt: 1,
    updatedAt: 2,
    nodeCount: 0,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  }
}

describe('画布集合写入执行器', () => {
  let revision = 2

  beforeEach(() => {
    revision = 2
    resetCanvasBatchStateForTests()
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
    const currentProject = project()
    useProjectStore.setState({
      projects: [currentProject],
      currentProjectId: projectId,
      currentProject,
      isHydrated: true,
      isOpeningProject: false,
      saveCurrentProject: vi.fn(),
    })
  })

  it('通过公共集合执行器创建节点并使用同一 token 完整撤销', async () => {
    const executor = new CanvasCollectionExecutor(CANVAS_ENTITY_TYPES.node, {
      readRevision: () => revision,
      bumpRevision: () => { revision += 1 },
    })
    const step: Extract<ApplicationPlannedStep, { kind: 'collection' }> = {
      kind: 'collection',
      parent: { kind: CANVAS_ENTITY_TYPES.project, id: projectId },
      entityType: CANVAS_ENTITY_TYPES.node,
      expectedRevisions: { canvas: 2 },
      operation: {
        kind: 'create',
        items: [{ properties: {
          'canvas.node.node_type': CANVAS_NODE_TYPES.textAnnotation,
        } }],
      },
    }

    const result = await executor.apply(step)
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
    expect(result.undoToken).toMatch(/^canvas-collection-undo:/)

    await executor.undo(String(result.undoToken))
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })

  it('删除容器节点时用强类型 cascade receipt 记下后代与关联连线', async () => {
    const nodes = [
      { id: 'parent', type: CANVAS_NODE_TYPES.textAnnotation, position: { x: 0, y: 0 }, data: {} },
      { id: 'child', type: CANVAS_NODE_TYPES.textAnnotation, parentId: 'parent', position: { x: 10, y: 10 }, data: {} },
      { id: 'peer', type: CANVAS_NODE_TYPES.textAnnotation, position: { x: 100, y: 0 }, data: {} },
    ]
    const edges = [{ id: 'edge-1', source: 'child', target: 'peer' }]
    useCanvasStore.setState({ nodes: nodes as never, edges: edges as never })
    expect(useCanvasStore.getState().edges).toHaveLength(1)
    const executor = new CanvasCollectionExecutor(CANVAS_ENTITY_TYPES.node, {
      readRevision: () => revision,
      bumpRevision: () => { revision += 1 },
    })
    const result = await executor.apply({
      kind: 'collection', parent: { kind: CANVAS_ENTITY_TYPES.project, id: projectId },
      entityType: CANVAS_ENTITY_TYPES.node, expectedRevisions: { canvas: revision },
      operation: { kind: 'remove', targets: [{ kind: CANVAS_ENTITY_TYPES.node, id: `${projectId}:parent` }] },
    })

    expect(useCanvasStore.getState().nodes.map((node) => node.id)).toEqual(['peer'])
    expect(useCanvasStore.getState().edges).toEqual([])
    expect(result.cascadeEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        effect: 'delete', entityType: CANVAS_ENTITY_TYPES.node,
        refs: [expect.objectContaining({ id: `${projectId}:child` })],
        origin: { kind: 'cascade', declarationId: 'canvas.delete_descendant_nodes' },
      }),
      expect.objectContaining({
        effect: 'delete', entityType: CANVAS_ENTITY_TYPES.edge,
        refs: [expect.objectContaining({ id: `${projectId}:edge-1` })],
        origin: { kind: 'cascade', declarationId: 'canvas.delete_connected_edges' },
      }),
    ]))
  })
})
