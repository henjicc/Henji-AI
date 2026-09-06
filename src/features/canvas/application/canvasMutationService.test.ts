// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { upsertProjectRecord } from '@/commands/projectState'
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'

import {
  addCanvasNode,
  addControlledCanvasNode,
  resetCanvasApplicationStateForTests,
  undoCanvasChange,
} from './canvasApplicationService'
import {
  clearCanvasProject,
  connectAssetGroupToTarget,
  disconnectAssetGroupFromTarget,
  duplicateCanvasNode,
  deleteCanvasNodes,
  groupCanvasNodes,
  ungroupCanvasNode,
  updateCanvasNode,
} from './canvasMutationService'
import { runCanvasTransaction } from './canvasBatchService'

const cancelCameraStageNodeTasks = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('./cameraStageRenderApplicationService', () => ({ cancelCameraStageNodeTasks }))

const projectId = 'project-3-1'

beforeAll(async () => {
  await loadRealModelsIntoRegistry()
})

// 本文件验证领域变换；仅替换最终存储边界，保存完成/拒绝由专门结果测试覆盖。
vi.mock('@/commands/projectState', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/commands/projectState')>(),
  upsertProjectRecord: vi.fn(async () => undefined),
}))

function emptyProject(): Project {
  return {
    id: projectId,
    name: '3.1 测试项目',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 0,
    coverPath: null,
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
    cancelCameraStageNodeTasks.mockClear()
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
    it('清空全部节点与连线，返回可撤销引用', async () => {
      await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      expect(useCanvasStore.getState().nodes).toHaveLength(2)

      const result = await clearCanvasProject(projectId)

      expect(result).toMatchObject({ projectId, clearedNodeCount: 2, clearedEdgeCount: 0 })
      expect(useCanvasStore.getState().nodes).toHaveLength(0)
    })

    it('清空后可以撤销，节点恢复', async () => {
      const created = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      const result = await clearCanvasProject(projectId)

      await undoCanvasChange(projectId, String(result.undoRef))

      expect(useCanvasStore.getState().nodes).toHaveLength(1)
      expect(useCanvasStore.getState().nodes[0].id).toBe(created.nodeId)
    })

    it('画布已经是空的时拒绝，不产生空的撤销记录', async () => {
      await expect(clearCanvasProject(projectId)).rejects.toThrow('画布已经是空的')
    })

    it('持久化清空后按稳定身份取消 3D 后台任务', async () => {
      const created = await addCanvasNode({
        projectId, nodeType: CANVAS_NODE_TYPES.cameraStage, placement: { mode: 'viewport_center' },
      })
      const nodeId = String(created.nodeId)
      const renderTask = {
        version: 1 as const,
        requestId: 'request-1', canvasProjectId: projectId, nodeId,
        cameraStageProjectId: 'stage-1', resolutionPreset: '720p' as const, outputKind: 'image' as const,
      }
      useCanvasStore.getState().updateNodeData(nodeId, { renderTask })

      await clearCanvasProject(projectId)

      await vi.waitFor(() => expect(cancelCameraStageNodeTasks).toHaveBeenCalledWith(projectId, [renderTask]))
    })

    it('批事务只在最终持久化成功后取消已删除节点的后台任务', async () => {
      const created = await addCanvasNode({
        projectId, nodeType: CANVAS_NODE_TYPES.cameraStage, placement: { mode: 'viewport_center' },
      })
      const nodeId = String(created.nodeId)
      const renderTask = {
        version: 1 as const,
        requestId: 'request-batch-success', canvasProjectId: projectId, nodeId,
        cameraStageProjectId: 'stage-1', resolutionPreset: '720p' as const, outputKind: 'image' as const,
      }
      useCanvasStore.getState().updateNodeData(nodeId, { renderTask })

      let releasePersistence!: () => void
      vi.mocked(upsertProjectRecord).mockImplementationOnce(async () => await new Promise<void>((resolve) => {
        releasePersistence = resolve
      }))

      const transaction = runCanvasTransaction(projectId, 1, async (options) => {
        const result = await deleteCanvasNodes(projectId, [nodeId], options)
        expect(cancelCameraStageNodeTasks).not.toHaveBeenCalled()
        return [result]
      })

      await vi.waitFor(() => expect(releasePersistence).toBeTypeOf('function'))
      expect(cancelCameraStageNodeTasks).not.toHaveBeenCalled()
      releasePersistence()
      await transaction
      await vi.waitFor(() => expect(cancelCameraStageNodeTasks).toHaveBeenCalledWith(projectId, [renderTask]))
    })

    it('批事务回滚会丢弃删除任务的取消副作用', async () => {
      const created = await addCanvasNode({
        projectId, nodeType: CANVAS_NODE_TYPES.cameraStage, placement: { mode: 'viewport_center' },
      })
      const nodeId = String(created.nodeId)
      const renderTask = {
        version: 1 as const,
        requestId: 'request-batch-rollback', canvasProjectId: projectId, nodeId,
        cameraStageProjectId: 'stage-1', resolutionPreset: '720p' as const, outputKind: 'image' as const,
      }
      useCanvasStore.getState().updateNodeData(nodeId, { renderTask })

      await expect(runCanvasTransaction(projectId, 2, async (options) => {
        await deleteCanvasNodes(projectId, [nodeId], options)
        throw new Error('后续步骤失败')
      })).rejects.toThrow('后续步骤失败')

      expect(useCanvasStore.getState().nodes.some((node) => node.id === nodeId)).toBe(true)
      await Promise.resolve()
      expect(cancelCameraStageNodeTasks).not.toHaveBeenCalled()
    })

    it('最终持久化拒绝时保留删除现场但不提前取消后台任务', async () => {
      const created = await addCanvasNode({
        projectId, nodeType: CANVAS_NODE_TYPES.cameraStage, placement: { mode: 'viewport_center' },
      })
      const nodeId = String(created.nodeId)
      useCanvasStore.getState().updateNodeData(nodeId, { renderTask: {
        version: 1, requestId: 'request-save-failed', canvasProjectId: projectId, nodeId,
        cameraStageProjectId: 'stage-1', resolutionPreset: '720p', outputKind: 'image',
      } })
      vi.mocked(upsertProjectRecord).mockRejectedValueOnce(new Error('disk full'))

      await expect(runCanvasTransaction(projectId, 1, async (options) => [
        await deleteCanvasNodes(projectId, [nodeId], options),
      ])).rejects.toThrow('保存未确认')

      expect(useCanvasStore.getState().nodes.some((node) => node.id === nodeId)).toBe(false)
      await Promise.resolve()
      expect(cancelCameraStageNodeTasks).not.toHaveBeenCalled()
    })

    it('持久化后的取消协调失败不把已经成功的删除事务改判为失败', async () => {
      const created = await addCanvasNode({
        projectId, nodeType: CANVAS_NODE_TYPES.cameraStage, placement: { mode: 'viewport_center' },
      })
      const nodeId = String(created.nodeId)
      useCanvasStore.getState().updateNodeData(nodeId, { renderTask: {
        version: 1, requestId: 'request-cancel-failed', canvasProjectId: projectId, nodeId,
        cameraStageProjectId: 'stage-1', resolutionPreset: '720p', outputKind: 'image',
      } })
      cancelCameraStageNodeTasks.mockRejectedValueOnce(new Error('ipc unavailable'))

      await expect(runCanvasTransaction(projectId, 1, async (options) => [
        await deleteCanvasNodes(projectId, [nodeId], options),
      ])).resolves.toMatchObject({ appliedOperations: [expect.objectContaining({ deletedNodeIds: [nodeId] })] })

      await vi.waitFor(() => expect(cancelCameraStageNodeTasks).toHaveBeenCalledTimes(1))
      expect(useCanvasStore.getState().nodes.some((node) => node.id === nodeId)).toBe(false)
    })
  })

  /*
   * 拒绝必须能被自我修正：只说"没有变化"，调用方无从知道是值本来就一样，还是键被悄悄丢掉了。
   *
   * 实测助手为了"把节点移动到指定坐标"传了 data: { x, y }——位置根本不是节点 data 字段
   * （它是属性 canvas.node.position）。过滤后是空对象、补丁是空操作，它只收到一句"节点数据
   * 未发生可保存的变化"，于是原样又试了一次。
   */
  describe('updateCanvasNode 的拒绝信息', () => {
    it('把丢掉的键、可写字段和位置的正确通道一起说出来', async () => {
      const created = await addCanvasNode({
        projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' },
      })
      const nodeId = String(created.nodeId)
      let message = ''
      try {
        await updateCanvasNode({ projectId, nodeId, data: { x: 420, y: 280 } })
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toContain('x、y')
      // 位置有正式通道，必须点名，否则模型只能继续在 data 里试
      expect(message).toContain('canvas.node.position')
    })

    it('固定图片工具复制后保留模型锁定，通用更新不能换成别的模型', async () => {
      const created = await addControlledCanvasNode({
        projectId,
        nodeType: CANVAS_NODE_TYPES.imageEdit,
        placement: { mode: 'viewport_center' },
        data: {
          displayName: '背景移除',
          modelId: 'fal-pixelcut-background-removal',
          params: {},
          generationUi: {
            promptMode: 'hidden',
            modelMode: 'locked',
            excludeParamIds: ['image'],
          },
        },
      })
      const duplicated = await duplicateCanvasNode({
        projectId,
        nodeId: String(created.nodeId),
        placement: { mode: 'right_of_node', anchorNodeId: String(created.nodeId) },
      })
      const copy = useCanvasStore.getState().nodes.find((node) => node.id === duplicated.nodeId)

      expect(copy?.data).toMatchObject({
        modelId: 'fal-pixelcut-background-removal',
        generationUi: { promptMode: 'hidden', modelMode: 'locked' },
      })
      await expect(updateCanvasNode({
        projectId,
        nodeId: String(duplicated.nodeId),
        data: { modelId: 'fal-image-apps-v2-outpaint' },
      })).rejects.toThrow('模型由能力契约锁定')
    })
  })

  describe('ungroupCanvasNode', () => {
    it('助手可创建素材组、建立与解除目标绑定，并对账真实成员关系', async () => {
      const nodeA = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      const nodeB = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      const target = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.imageEdit, placement: { mode: 'viewport_center' } })
      const grouped = await groupCanvasNodes(projectId, [String(nodeA.nodeId), String(nodeB.nodeId)], 'asset')
      const groupNodeId = String(grouped.groupNodeId)
      const group = useCanvasStore.getState().nodes.find((node) => node.id === groupNodeId)

      expect(grouped).toMatchObject({ groupKind: 'asset', accepted: 2 })
      expect(group?.type).toBe(CANVAS_NODE_TYPES.assetGroup)
      expect(useCanvasStore.getState().nodes.filter((node) => node.parentId === groupNodeId)).toHaveLength(2)

      const connected = await connectAssetGroupToTarget(projectId, groupNodeId, String(target.nodeId))
      expect(Number(connected.connected) + Number(connected.pending)).toBeGreaterThan(0)
      expect(useCanvasStore.getState().edges.some((edge) => edge.data?.managedByAssetGroup?.groupId === groupNodeId)).toBe(true)

      await disconnectAssetGroupFromTarget(projectId, groupNodeId, String(target.nodeId))
      expect(useCanvasStore.getState().edges.some((edge) => edge.data?.managedByAssetGroup?.groupId === groupNodeId)).toBe(false)
    })

    it('解散分组后子节点保留、group 节点消失', async () => {
      const nodeA = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      const nodeB = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      const group = await groupCanvasNodes(projectId, [String(nodeA.nodeId), String(nodeB.nodeId)])
      const groupNodeId = String(group.groupNodeId)
      expect(useCanvasStore.getState().nodes.some((node) => node.id === groupNodeId)).toBe(true)

      const result = await ungroupCanvasNode(projectId, groupNodeId)

      expect(result).toMatchObject({ projectId, groupNodeId })
      const nodes = useCanvasStore.getState().nodes
      expect(nodes.some((node) => node.id === groupNodeId)).toBe(false)
      expect(nodes.some((node) => node.id === nodeA.nodeId)).toBe(true)
      expect(nodes.some((node) => node.id === nodeB.nodeId)).toBe(true)
      expect(nodes.find((node) => node.id === nodeA.nodeId)?.parentId).toBeUndefined()
    })

    it('解散后可以撤销，分组恢复', async () => {
      const nodeA = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      const nodeB = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
      const group = await groupCanvasNodes(projectId, [String(nodeA.nodeId), String(nodeB.nodeId)])
      const groupNodeId = String(group.groupNodeId)
      const result = await ungroupCanvasNode(projectId, groupNodeId)

      await undoCanvasChange(projectId, String(result.undoRef))

      expect(useCanvasStore.getState().nodes.some((node) => node.id === groupNodeId)).toBe(true)
    })

    it('目标不是分组节点时拒绝', async () => {
      const nodeA = await addCanvasNode({ projectId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })

      await expect(ungroupCanvasNode(projectId, String(nodeA.nodeId))).rejects.toThrow('不是可解散的分组节点')
    })
  })
})
