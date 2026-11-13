import { setCanvasTestProjectState } from '@/tests/canvasProjectFixture';
// @vitest-environment jsdom

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { addTrustedMediaCanvasNode } from './canvasApplicationService';
import { runCanvasMutationStage } from './canvasPersistenceService';
import { releaseCanvasProjectInstance } from './canvasProjectInstances';

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore, type CanvasNode } from '@/stores/canvasStore';
import { type Project } from '@/stores/projectStore';

import { applyCanvasOperationsAtomically, resetCanvasBatchStateForTests, undoCanvasBatch, runCanvasTransaction, type CanvasBatchOperation } from './canvasBatchService';

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
  it.each(['select', 'noop', 'position'] as const)('已有历史的 %s 事务保留真实历史与重做', async (kind) => {
    for (let i = 0; i < 4; i++) useCanvasStore.getState().updateNodeData(nodeId, { content: String(i) });
    useCanvasStore.getState().undo();
    const before = useCanvasStore.getState();
    await runCanvasTransaction(projectId, 1, options => runCanvasMutationStage(options, () => {
      if (kind === 'select') useCanvasStore.getState().setSelectedNode(nodeId);
      if (kind === 'noop') useCanvasStore.getState().updateNodeData(nodeId, { content: before.nodes[0].data.content });
      if (kind === 'position') useCanvasStore.getState().updateNodePosition(nodeId, { x: 500, y: 600 });
      return [];
    }));
    const after = useCanvasStore.getState();
    expect(after.history.past[0]).toBe(before.history.past[0]);
    if (kind === 'position') {
      expect(after.history.past).toHaveLength(before.history.past.length + 1);
      after.undo();
      expect(useCanvasStore.getState().nodes[0].position).toEqual(before.nodes[0].position);
    } else expect(after.history).toBe(before.history);
  });

  it.each(['rollback', 'undo'] as const)('%s 恢复内存快照时保留在途生成', async (kind) => {
    useCanvasStore.getState().updateNodeData(nodeId, { isGenerating: true, generationTaskId: 'active-task' }, { skipHistory: true });
    const before = useCanvasStore.getState();
    const execute = (options: Parameters<typeof runCanvasMutationStage>[0]) => runCanvasMutationStage(options, () => {
      useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.textAnnotation, { x: 500, y: 0 });
      if (kind === 'rollback') throw new Error('写入后失败');
      return [];
    });
    if (kind === 'rollback') await expect(runCanvasTransaction(projectId, 1, execute)).rejects.toThrow('写入后失败');
    else {
      const result = await runCanvasTransaction(projectId, 1, execute);
      await undoCanvasBatch(projectId, result.undoRef);
    }
    expect(useCanvasStore.getState().nodes).toBe(before.nodes);
    expect(useCanvasStore.getState().history).toBe(before.history);
    expect(useCanvasStore.getState().nodes[0].data.isGenerating).toBe(true);
    expect(useCanvasStore.getState().nodes[0].data.generationError).toBe(before.nodes[0].data.generationError);
  });

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
    setCanvasTestProjectState({
      currentProjectId: projectId,
      currentProject: project,
      isOpeningProject: false,
    })
  })

  it('把多个操作作为一组提交并通过单一引用撤销', async () => {
    useCanvasStore.getState().setSelectedNode(nodeId)
    const operations: CanvasBatchOperation[] = [
      { kind: 'add_node', nodeType: CANVAS_NODE_TYPES.textAnnotation, placement: { mode: 'viewport_center' } },
      { kind: 'add_node', nodeType: CANVAS_NODE_TYPES.textAnnotation, placement: { mode: 'right_of_node', anchorNodeId: nodeId } },
    ]
    const committed = await applyCanvasOperationsAtomically(projectId, operations)

    expect(useCanvasStore.getState().nodes).toHaveLength(3)
    expect(committed.appliedOperations).toEqual([
      expect.objectContaining({ index: 0, kind: 'add_node', nodeId: expect.any(String) }),
      expect.objectContaining({ index: 1, kind: 'add_node', nodeId: expect.any(String) }),
    ])
    expect(useCanvasStore.getState().history.past).toHaveLength(1)

    expect(await undoCanvasBatch(projectId, committed.undoRef)).toMatchObject({
      operation: 'batch',
      status: 'undone',
    })
    expect(useCanvasStore.getState().nodes.map(node => node.id)).toEqual([nodeId])
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
    await applyCanvasOperationsAtomically(projectId, [
      { kind: 'add_node', nodeType: CANVAS_NODE_TYPES.textAnnotation, placement: { mode: 'viewport_center' } },
    ])

    expect(setCanvasData).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().history.past).toHaveLength(50)
    expect(useCanvasStore.getState().history.past[0]).toBe(oldestRetainedSnapshot)
    setCanvasData.mockRestore()
  })

  // 界面批次不带 runtime：等异步步骤时用户可能切走页面，释放不能在批次中途关掉会话
  it('界面批次进行中占着租约，释放被拒；批次出错后租约归零，可以释放', async () => {
    let resume: (() => void) | undefined
    const running = runCanvasTransaction(projectId, 1, async options => {
      await new Promise<void>(resolve => { resume = resolve })
      return runCanvasMutationStage(options, () => { throw new Error('中途失败') })
    })
    await vi.waitFor(() => expect(resume).toBeDefined())
    expect(await releaseCanvasProjectInstance(projectId)).toBe(false)
    resume!()
    await expect(running).rejects.toThrow('中途失败')
    expect(await releaseCanvasProjectInstance(projectId)).toBe(true)
  })
})

// 本文件验证领域变换；仅替换最终存储边界，保存完成/拒绝由专门结果测试覆盖。
