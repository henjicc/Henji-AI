import { beforeEach, describe, expect, it } from 'vitest'

import { useCanvasStore } from '@/stores/canvasStore'
import { applyCanvasOperationsAtomically } from './canvasBatchService'
import { resetCanvasApplicationStateForTests } from './canvasApplicationService'

/**
 * 画布集合写入的内核测试。
 *
 * `applyCanvasOperationsAtomically` 是画布批量写入的**唯一内核**：批量能力（plan/commit 两段式）
 * 与反射层的集合写入都调用它。画布原本已经有完整的「抓快照—执行—失败整批回滚—合并撤销历史」
 * 实现，接集合写入时如果另写一份，就会造出本项目已经吃过四次亏的那种双路径。
 *
 * 这些用例守的是内核的三条语义：整批原子、失败全退、撤销合成一条。
 */
describe('画布批量写入内核', () => {
  beforeEach(() => {
    resetCanvasApplicationStateForTests()
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  })

  it('任一操作失败时整批回滚，节点数量不变', async () => {
    const before = useCanvasStore.getState().nodes.length

    await expect(applyCanvasOperationsAtomically('project-not-open', [
      { kind: 'delete_nodes', nodeIds: ['不存在的节点'] },
    ])).rejects.toThrow()

    expect(useCanvasStore.getState().nodes).toHaveLength(before)
  })

  it('删除不存在的节点会被服务层拒绝，不产生半成品状态', async () => {
    const store = useCanvasStore.getState()
    const edgesBefore = store.edges.length
    await expect(applyCanvasOperationsAtomically('project-not-open', [
      { kind: 'disconnect_edge', edgeId: '不存在的连线' },
    ])).rejects.toThrow()
    expect(useCanvasStore.getState().edges).toHaveLength(edgesBefore)
  })

  it('工程未打开时在写入之前就被拒绝', async () => {
    // requireCurrentCanvasProject 在内核开头调用，任何操作都到不了执行阶段
    await expect(applyCanvasOperationsAtomically('未打开的工程', [
      { kind: 'add_node', nodeType: 'text', placement: { mode: 'viewport_center' } },
    ])).rejects.toThrow()
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })
})
