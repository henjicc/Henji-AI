// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'

import { addCanvasNode, resetCanvasApplicationStateForTests, undoCanvasChange } from './canvasApplicationService'
import { clearCanvasProject, groupCanvasNodes, ungroupCanvasNode } from './canvasMutationService'

const projectId = 'project-3-1'

function emptyProject(): Project {
  return {
    id: projectId,
    name: '3.1 测试项目',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 0,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  }
}

/**
 * 3.1：清空画布（`clearCanvasProject`）与解散分组（`ungroupCanvasNode`）。
 *
 * 都是委托 `store.clearCanvas()` / `store.ungroupNode()`——领域层的实现早就是完整的，
 * 只是助手侧一直没有正式入口。这几条用例守的是这条路真的通，而且没有重写 store 自己的逻辑
 * （解散后子节点必须保留，清空后必须可撤销）。
 */
describe('画布清空与解散分组', () => {
  beforeEach(() => {
    resetCanvasApplicationStateForTests()
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
    useCanvasStore.setState({
      currentViewport: { x: 0, y: 0, zoom: 1 },
      canvasViewportSize: { width: 1_200, height: 800 },
    })
    const project = emptyProject()
    useProjectStore.setState({
      projects: [project],
      currentProjectId: projectId,
      currentProject: project,
      isHydrated: true,
      isOpeningProject: false,
      saveCurrentProject: vi.fn(),
    })
  })

  describe('clearCanvasProject', () => {
    it('清空全部节点与连线，返回可撤销引用', () => {
      addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      expect(useCanvasStore.getState().nodes).toHaveLength(2)

      const result = clearCanvasProject(projectId)

      expect(result).toMatchObject({ projectId, clearedNodeCount: 2, clearedEdgeCount: 0 })
      expect(useCanvasStore.getState().nodes).toHaveLength(0)
    })

    it('清空后可以撤销，节点恢复', () => {
      const created = addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      const result = clearCanvasProject(projectId)

      undoCanvasChange(projectId, String(result.undoRef))

      expect(useCanvasStore.getState().nodes).toHaveLength(1)
      expect(useCanvasStore.getState().nodes[0].id).toBe(created.nodeId)
    })

    it('画布已经是空的时拒绝，不产生空的撤销记录', () => {
      expect(() => clearCanvasProject(projectId)).toThrow('画布已经是空的')
    })
  })

  describe('ungroupCanvasNode', () => {
    it('解散分组后子节点保留、group 节点消失', () => {
      const nodeA = addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      const nodeB = addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      const group = groupCanvasNodes(projectId, [String(nodeA.nodeId), String(nodeB.nodeId)])
      const groupNodeId = String(group.groupNodeId)
      expect(useCanvasStore.getState().nodes.some((node) => node.id === groupNodeId)).toBe(true)

      const result = ungroupCanvasNode(projectId, groupNodeId)

      expect(result).toMatchObject({ projectId, groupNodeId })
      const nodes = useCanvasStore.getState().nodes
      expect(nodes.some((node) => node.id === groupNodeId)).toBe(false)
      expect(nodes.some((node) => node.id === nodeA.nodeId)).toBe(true)
      expect(nodes.some((node) => node.id === nodeB.nodeId)).toBe(true)
      expect(nodes.find((node) => node.id === nodeA.nodeId)?.parentId).toBeUndefined()
    })

    it('解散后可以撤销，分组恢复', () => {
      const nodeA = addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      const nodeB = addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      const group = groupCanvasNodes(projectId, [String(nodeA.nodeId), String(nodeB.nodeId)])
      const groupNodeId = String(group.groupNodeId)
      const result = ungroupCanvasNode(projectId, groupNodeId)

      undoCanvasChange(projectId, String(result.undoRef))

      expect(useCanvasStore.getState().nodes.some((node) => node.id === groupNodeId)).toBe(true)
    })

    it('目标不是分组节点时拒绝', () => {
      const nodeA = addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })

      expect(() => ungroupCanvasNode(projectId, String(nodeA.nodeId))).toThrow('不是可解散的分组节点')
    })
  })
})
