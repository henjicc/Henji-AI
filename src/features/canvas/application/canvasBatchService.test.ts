// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CANVAS_BATCH_APPLICATION_CAPABILITIES,
  type CanvasBatchOperation,
} from '@/core/assistant/capabilities/canvasBatchApplicationCapabilities'
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore, type CanvasNode } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'

import {
  commitCanvasBatch,
  planCanvasBatch,
  resetCanvasBatchStateForTests,
  undoCanvasBatch,
} from './canvasBatchService'

const projectId = 'canvas-batch-project'
const nodeId = 'text-node'

function createNode(): CanvasNode {
  return {
    id: nodeId,
    type: CANVAS_NODE_TYPES.textAnnotation,
    position: { x: 100, y: 100 },
    data: { displayName: '原节点', content: '原内容' },
  }
}

function createProject(node: CanvasNode): Project {
  return {
    id: projectId,
    name: '批量测试项目',
    createdAt: 1,
    updatedAt: 2,
    nodeCount: 1,
    nodes: [node],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  }
}

describe('canvas batch service', () => {
  beforeEach(() => {
    resetCanvasBatchStateForTests()
    const node = createNode()
    const project = createProject(node)
    useCanvasStore.getState().setCanvasData([node], [], { past: [], future: [] })
    useProjectStore.setState({
      projects: [project],
      currentProjectId: projectId,
      currentProject: project,
      isHydrated: true,
      isOpeningProject: false,
      saveCurrentProject: vi.fn(),
    })
  })

  it('把多个操作作为一组提交并通过单一引用撤销', async () => {
    const operations: CanvasBatchOperation[] = [
      { kind: 'update_node', nodeId, data: { displayName: '批量标题' } },
      { kind: 'update_node', nodeId, data: { content: '批量内容' } },
    ]
    const plan = planCanvasBatch(projectId, operations, 2)
    const committed = await commitCanvasBatch(String(plan.planRef))

    expect(useCanvasStore.getState().nodes[0].data).toMatchObject({
      displayName: '批量标题',
      content: '批量内容',
    })
    expect(committed).toMatchObject({ operationCount: 2, status: 'committed' })
    expect(committed.appliedOperations).toEqual([
      expect.objectContaining({ index: 0, kind: 'update_node', nodeId }),
      expect.objectContaining({ index: 1, kind: 'update_node', nodeId }),
    ])
    expect(useCanvasStore.getState().history.past).toHaveLength(1)

    expect(undoCanvasBatch(projectId, String(committed.undoRef))).toMatchObject({
      operation: 'batch',
      status: 'undone',
    })
    expect(useCanvasStore.getState().nodes[0].data).toMatchObject({
      displayName: '原节点',
      content: '原内容',
    })
  })

  it('批次 Effect 解析器按真实步骤数量结算，而不是把整批保守计为一次', () => {
    const capability = CANVAS_BATCH_APPLICATION_CAPABILITIES.find((item) => item.id === 'commit_canvas_batch')
    const effects = capability?.resolveObservedEffects?.({ planRef: 'canvas-plan:test' }, {
      planRef: 'canvas-plan:test',
      projectId,
      appliedOperations: [
        { index: 0, kind: 'add_node', nodeId: 'node-a' },
        { index: 1, kind: 'add_node', nodeId: 'node-b' },
      ],
      operationCount: 2,
      undoRef: 'canvas-batch-undo:test',
      status: 'committed',
    }) ?? []

    expect(effects).toHaveLength(2)
    expect(effects).toEqual([
      expect.objectContaining({ effect: 'create', entityTypes: ['canvas.node'], count: 1 }),
      expect.objectContaining({ effect: 'create', entityTypes: ['canvas.node'], count: 1 }),
    ])
    expect(effects.flatMap((effect) => effect.targetRefs)).toEqual([
      { kind: 'canvas.node', id: 'node-a' },
      { kind: 'canvas.node', id: 'node-b' },
    ])
  })

  it('计划创建后画布变化会触发 revision 指纹冲突', async () => {
    const plan = planCanvasBatch(projectId, [
      { kind: 'update_node', nodeId, data: { displayName: '不应提交' } },
    ], 2)
    useCanvasStore.getState().updateNodePosition(nodeId, { x: 320, y: 240 })

    await expect(commitCanvasBatch(String(plan.planRef))).rejects.toMatchObject({
      code: 'STALE_CONTEXT',
    })
    expect(useCanvasStore.getState().nodes[0].data.displayName).toBe('原节点')
  })

  it('规划阶段拒绝非法节点字段且不产生部分状态', () => {
    expect(() => planCanvasBatch(projectId, [
      { kind: 'update_node', nodeId, data: { internalData: 'forbidden' } },
    ], 2)).toThrow()
    expect(useCanvasStore.getState().nodes[0].data).toMatchObject({
      displayName: '原节点',
      content: '原内容',
    })
  })
})
