// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { addTrustedMediaCanvasNode } from './canvasApplicationService'
import { runCanvasMutationStage } from './canvasPersistenceService'

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
  runCanvasTransaction,
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
    coverPath: null,
    nodes: [node],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  }
}

describe('canvas batch service', () => {
  it('可信素材的前置字段错误明确未执行，修正后同一画布可继续追加', async () => {
    const before = useCanvasStore.getState().nodes
    await expect(runCanvasTransaction(projectId, 1, async options => [await addTrustedMediaCanvasNode({
      projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' },
      data: { imageUrl: 'C:/reference.png', aspectRatio: '1:1', sourceFileName: 'x'.repeat(513) },
    }, options)])).rejects.toMatchObject({ name: 'ApplicationPreflightFailure' })
    expect(useCanvasStore.getState().nodes).toEqual(before)
    const created = await runCanvasTransaction(projectId, 1, async options => [await addTrustedMediaCanvasNode({
      projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' },
      data: { imageUrl: 'C:/reference.png', aspectRatio: '1:1', sourceFileName: '正常名称' },
    }, options)])
    expect(useCanvasStore.getState().nodes.find(node => node.id === created.appliedOperations[0].nodeId)?.data.sourceFileName).toBe('正常名称')
  })

  it('已经发生写入后再遇到字段错误，不能伪装成前置拒绝', async () => {
    const before = useCanvasStore.getState().nodes
    const error = await runCanvasTransaction(projectId, 2, options => {
      runCanvasMutationStage(options, () => useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.textAnnotation, { x: 0, y: 0 }, {}))
      z.string().max(1).parse('too long')
      return []
    }).catch((failure: unknown) => failure)
    expect(error).toMatchObject({ name: 'CanvasTransactionRolledBackError', cause: expect.any(z.ZodError) })
    expect(useCanvasStore.getState().nodes).toEqual(before)
  })

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
    useCanvasStore.getState().setSelectedNode(nodeId)
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

    expect(await undoCanvasBatch(projectId, String(committed.undoRef))).toMatchObject({
      operation: 'batch',
      status: 'undone',
    })
    expect(useCanvasStore.getState().nodes[0].data).toMatchObject({
      displayName: '原节点',
      content: '原内容',
    })
    expect(useCanvasStore.getState().selectedNodeId).toBe(nodeId)
  })

  it('事务成功只压缩运行时历史，不重新加载并迁移整张画布', async () => {
    const snapshots = Array.from({ length: 50 }, (_, index) => ({
      nodes: [{ ...createNode(), data: { displayName: `历史 ${index}`, content: '原内容' } }],
      edges: [],
    }))
    useCanvasStore.getState().setCanvasData([createNode()], [], { past: snapshots, future: [] })
    const oldestRetainedSnapshot = useCanvasStore.getState().history.past[1]
    const setCanvasData = vi.spyOn(useCanvasStore.getState(), 'setCanvasData')
    const plan = planCanvasBatch(projectId, [
      {
        kind: 'add_node',
        nodeType: CANVAS_NODE_TYPES.textAnnotation,
        placement: { mode: 'absolute', x: 420, y: 180 },
        data: { displayName: '轻量提交', content: '新增节点' },
      },
    ], 2)

    await commitCanvasBatch(String(plan.planRef))

    expect(setCanvasData).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().history.past).toHaveLength(50)
    expect(useCanvasStore.getState().history.past[0]).toBe(oldestRetainedSnapshot)
    setCanvasData.mockRestore()
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

  it('计划创建后画布数组变化会触发 revision 冲突', async () => {
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

// 本文件验证领域变换；仅替换最终存储边界，保存完成/拒绝由专门结果测试覆盖。
vi.mock('@/commands/projectState', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/commands/projectState')>(),
  upsertProjectRecord: vi.fn(async () => undefined),
}))
