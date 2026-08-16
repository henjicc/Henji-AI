import { useCanvasStore } from '@/stores/canvasStore'

import type { CanvasNodePlacement } from '@/core/assistant/capabilities/canvasMutationApplicationCapabilities'
import { isStoryboardSplitNode, type CanvasNodeData, type StoryboardFrameItem } from '../domain/canvasNodes'
import { extractCanvasNodeData, listCanvasNodeDataKeys } from '../domain/nodeControlRegistry'
import {
  addCanvasNode,
  CanvasApplicationError,
  persistCanvasState,
  rememberCanvasUndo,
  requireCurrentCanvasProject,
} from './canvasApplicationService'

interface CanvasNodePatch {
  nodeId: string
  data?: Partial<CanvasNodeData>
  position?: { x: number; y: number }
}

export interface CanvasStoryboardFramePatch {
  id: string
  note?: string
  order?: number
}

export interface CanvasNodePropertyPatch {
  nodeId: string
  displayName?: string
  position?: { x: number; y: number }
  storyboardFrames?: CanvasStoryboardFramePatch[]
}

function requireNode(projectId: string, nodeId: string): { id: string; type: string; data: CanvasNodeData } {
  requireCurrentCanvasProject(projectId)
  const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId)
  if (!node) throw new CanvasApplicationError('NOT_FOUND', '画布节点不存在', true, { nodeId })
  return { id: node.id, type: node.type, data: node.data }
}

/** 画布节点数据/位置写入的共享内核；专用能力与通用属性动词都必须委托这里。 */
function applyCanvasNodePatches(projectId: string, patches: CanvasNodePatch[]): void {
  requireCurrentCanvasProject(projectId)
  for (const patch of patches) requireNode(projectId, patch.nodeId)
  const canvas = useCanvasStore.getState()
  for (const patch of patches) {
    if (patch.data && Object.keys(patch.data).length > 0) canvas.updateNodeData(patch.nodeId, patch.data)
    if (patch.position) canvas.updateNodePosition(patch.nodeId, patch.position)
  }
  persistCanvasState()
}

export function applyCanvasNodePropertyPatches(
  projectId: string,
  patches: CanvasNodePropertyPatch[],
): void {
  const normalized = patches.map((patch) => {
    if (patch.displayName !== undefined && !patch.displayName.trim()) {
      throw new CanvasApplicationError('INVALID_INPUT', '画布节点标题不能为空')
    }
    if (patch.position && ![patch.position.x, patch.position.y].every(Number.isFinite)) {
      throw new CanvasApplicationError('INVALID_INPUT', '画布节点位置必须是有限数值')
    }
    return {
      nodeId: patch.nodeId,
      ...(patch.displayName !== undefined
        ? { data: { displayName: patch.displayName.trim() } }
        : {}),
      ...(patch.position ? { position: patch.position } : {}),
    }
  })
  applyCanvasNodePatches(projectId, normalized)
}

/**
 * 分镜格子内容与顺序（3.2）：格子（`StoryboardFrameItem[]`）整段存在 `storyboardSplit` 节点的
 * `data.frames` 里，没有独立于画布节点的身份——不是 `canvas.node.data` 的通用合并能覆盖的
 * （合并会用传入的 `frames` 整体替换掉其余格子），需要按 id 定点更新，所以走专门的路径而不是
 * `applyCanvasNodePatches` 的 `data` 合并。
 *
 * 排序不单独调 `store.reorderStoryboardFrame`（那是一次拖拽换两个位置的手势 API，输入形状与
 * 这里的"整批格子各自要什么 order"对不上）：`reorderStoryboardFrame` 内部本质也是把移动后每张
 * 格子的 `order` 重新赋值为数组下标，直接对每张格子写 `order` 字段是同一件事，还更直接。
 */
export function applyStoryboardFramePatches(
  projectId: string,
  nodeId: string,
  frames: CanvasStoryboardFramePatch[],
): void {
  requireCurrentCanvasProject(projectId)
  const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId)
  if (!node) throw new CanvasApplicationError('NOT_FOUND', '画布节点不存在', true, { nodeId })
  if (!isStoryboardSplitNode(node)) {
    throw new CanvasApplicationError('INVALID_INPUT', '目标节点不是分镜格子节点，没有 frames 数据', true, { nodeId })
  }
  const existingIds = new Set(node.data.frames.map((frame) => frame.id))
  const missing = frames.filter((frame) => !existingIds.has(frame.id)).map((frame) => frame.id)
  if (missing.length > 0) {
    throw new CanvasApplicationError('NOT_FOUND', `以下分镜格子 id 不存在：${missing.join('、')}`, true, { nodeId, missing })
  }
  const canvas = useCanvasStore.getState()
  for (const frame of frames) {
    const patch: Partial<StoryboardFrameItem> = {}
    if (frame.note !== undefined) patch.note = frame.note
    if (frame.order !== undefined) patch.order = frame.order
    if (Object.keys(patch).length > 0) canvas.updateStoryboardFrame(nodeId, frame.id, patch)
  }
  persistCanvasState()
}

export function duplicateCanvasNode(input: {
  projectId: string
  nodeId: string
  placement: CanvasNodePlacement
}): Record<string, unknown> {
  const node = requireNode(input.projectId, input.nodeId)
  const data = extractCanvasNodeData(node.type, node.data as Record<string, unknown>)
  const result = addCanvasNode({
    projectId: input.projectId,
    nodeType: node.type,
    placement: input.placement,
    data,
  })
  return { ...result, duplicatedFromNodeId: node.id }
}

export function updateCanvasNode(input: {
  projectId: string
  nodeId: string
  data: Record<string, unknown>
}): Record<string, unknown> {
  const node = requireNode(input.projectId, input.nodeId)
  const safeData = extractCanvasNodeData(node.type, input.data)
  const canvas = useCanvasStore.getState()
  const beforeDepth = canvas.history.past.length
  applyCanvasNodePatches(input.projectId, [{ nodeId: node.id, data: safeData }])
  if (useCanvasStore.getState().history.past.length === beforeDepth) {
    /*
     * 不能只说"没有变化"——调用方无从知道是**值本来就一样**还是**键被悄悄丢掉了**。
     *
     * extractCanvasNodeData 会静默滤掉这个节点类型不认的键。实测助手为了"把节点移动到指定
     * 坐标"传了 data: { x, y }：x/y 根本不是节点 data 字段（位置是属性 canvas.node.position），
     * 于是过滤后是空对象、补丁是空操作，它只收到"节点数据未发生可保存的变化"，又试了一次
     * 一模一样的调用。把丢掉的键和真正可用的键说出来，它才有得改。
     */
    const dropped = Object.keys(input.data).filter((key) => !(key in safeData))
    const accepted = listCanvasNodeDataKeys(node.type)
    throw new CanvasApplicationError(
      'INVALID_INPUT',
      '节点数据未发生可保存的变化'
      + (dropped.length > 0 ? `：${dropped.join('、')} 不是 ${node.type} 的 data 字段` : '（提交的值与当前值相同）')
      + `。${node.type} 的 data 可写字段：${accepted.length > 0 ? accepted.join('、') : '无'}`
      + '；节点位置不在 data 里，用属性 canvas.node.position 修改。',
      true,
      { nodeId: node.id }
    )
  }
  const undoRef = rememberCanvasUndo(input.projectId, 'update_node')
  return { projectId: input.projectId, nodeId: node.id, updatedKeys: Object.keys(safeData), undoRef }
}

export function deleteCanvasNodes(projectId: string, nodeIds: string[]): Record<string, unknown> {
  requireCurrentCanvasProject(projectId)
  const existing = new Set(useCanvasStore.getState().nodes.map((node) => node.id))
  const unique = [...new Set(nodeIds)].filter((nodeId) => existing.has(nodeId))
  if (unique.length === 0) throw new CanvasApplicationError('NOT_FOUND', '没有可删除的画布节点', true)
  useCanvasStore.getState().deleteNodes(unique)
  const undoRef = rememberCanvasUndo(projectId, 'delete_nodes')
  persistCanvasState()
  return { projectId, deletedNodeIds: unique, undoRef }
}

/**
 * 清空画布（3.1）：整个工程一次性重置，不是"逐个删除很多节点"。走 `remove_items` 意味着助手
 * 要先枚举全部节点/连线引用、再分批提交（`canvas.node`/`canvas.edge` 的 collectionWrite
 * 限了 `maxItemsPerChange: 50`，节点稍多就要拆好几批）——为一个界面上单按钮触发的原子动作
 * 多绕两步，不如照 `undo_canvas_change`/`group_canvas_nodes` 的先例：工程级整体状态操作
 * 走专用能力，不勉强表达成集合写入。
 */
export function clearCanvasProject(projectId: string): Record<string, unknown> {
  requireCurrentCanvasProject(projectId)
  const before = useCanvasStore.getState()
  const clearedNodeCount = before.nodes.length
  const clearedEdgeCount = before.edges.length
  if (clearedNodeCount === 0 && clearedEdgeCount === 0) {
    throw new CanvasApplicationError('INVALID_INPUT', '画布已经是空的，没有可清空的内容', true)
  }
  useCanvasStore.getState().clearCanvas()
  const undoRef = rememberCanvasUndo(projectId, 'clear_canvas')
  persistCanvasState()
  return { projectId, clearedNodeCount, clearedEdgeCount, undoRef }
}

export function selectCanvasNode(projectId: string, nodeId: string | null): Record<string, unknown> {
  requireCurrentCanvasProject(projectId)
  if (nodeId) requireNode(projectId, nodeId)
  useCanvasStore.getState().setSelectedNode(nodeId)
  return { projectId, selectedNodeId: nodeId }
}

export function groupCanvasNodes(projectId: string, nodeIds: string[]): Record<string, unknown> {
  requireCurrentCanvasProject(projectId)
  const groupNodeId = useCanvasStore.getState().groupNodes(nodeIds)
  if (!groupNodeId) throw new CanvasApplicationError('INVALID_INPUT', '至少需要两个存在且不相互嵌套的节点才能分组', true)
  const undoRef = rememberCanvasUndo(projectId, 'group_nodes')
  persistCanvasState()
  return { projectId, groupNodeId, undoRef }
}

/**
 * 解散分组（3.1）：不能表达成 `remove_items` 删 group 节点——集合删除对节点的语义早就是
 * "级联删除子节点"（`store.deleteNodes` 用 `collectNodeIdsWithDescendants` 收集要删的整棵
 * 子树），而解散分组要求子节点**保留**、只把 group 包装节点去掉。两种语义用同一个入口表达
 * 会产生歧义，所以解散走独立的 `store.ungroupNode`，未重写它的释放/绝对坐标换算逻辑。
 */
export function ungroupCanvasNode(projectId: string, groupNodeId: string): Record<string, unknown> {
  requireCurrentCanvasProject(projectId)
  if (!useCanvasStore.getState().ungroupNode(groupNodeId)) {
    throw new CanvasApplicationError('NOT_FOUND', '目标不是可解散的分组节点，或分组内没有子节点', true, { groupNodeId })
  }
  const undoRef = rememberCanvasUndo(projectId, 'ungroup_node')
  persistCanvasState()
  return { projectId, groupNodeId, undoRef }
}

export function disconnectCanvasEdge(projectId: string, edgeId: string): Record<string, unknown> {
  requireCurrentCanvasProject(projectId)
  const edge = useCanvasStore.getState().edges.find((item) => item.id === edgeId)
  if (!edge) throw new CanvasApplicationError('NOT_FOUND', '画布连接不存在', true, { edgeId })
  useCanvasStore.getState().deleteEdge(edge.id)
  const undoRef = rememberCanvasUndo(projectId, 'disconnect_edge')
  persistCanvasState()
  return { projectId, edgeId: edge.id, undoRef }
}
