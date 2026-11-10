import type { ApplicationRef } from '@/core/application-control'
import { createLogger } from '@/core/logging'
import { openApplicationSurface } from '@/features/navigation'
import { useCanvasStore } from '@/stores/canvasStore'

import { isCameraStageNode, isEditableLayerStackResultNode } from '../domain/canvasNodeGuards'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { CanvasApplicationError, focusCanvasNode, openCanvasProject } from './canvasApplicationService'
import { useCameraStageRenderProgressStore } from './cameraStageRenderProgress'
import { openCameraStageNodeEditorDialog, useCameraStageNodeEditor } from './cameraStageNodeEditor'
import { openMultiLayerDocumentNodeEditor } from './multiLayerDocumentNodeEditorApplicationService'

const logger = createLogger('features.canvas.node_editor_application')

/** 3D 编辑器要先载入 three.js 与场景，首次打开偏慢 */
const CAMERA_STAGE_LOAD_TIMEOUT_MS = 15_000

type CanvasRef = ApplicationRef & { kind: 'canvas.document' }
type NodeRef = ApplicationRef & { kind: 'canvas.node' }

export interface OpenCanvasNodeEditorInput {
  canvasRef: CanvasRef
  nodeRef: NodeRef
  signal?: AbortSignal
  correlation?: { requestId?: string; taskId?: string }
}

export interface OpenCanvasNodeEditorResult {
  canvasRef: CanvasRef
  nodeRef: NodeRef
  surfaceId: 'workspace.canvas'
  editorKind: 'multi_layer_document' | 'camera_stage'
  status: 'opened' | 'already_open'
  cameraStageDocumentRef?: ApplicationRef & { kind: 'camera_stage.document' }
  resultRefs: ApplicationRef[]
  /** 运行时据此把结果记为已核实；缺了它，打开成功也会被当成结果未知 */
  verification: { verified: true; condition: string }
}

function nodeIdOf(input: OpenCanvasNodeEditorInput): string {
  const prefix = `${input.canvasRef.id}:`
  const nodeId = input.nodeRef.id.startsWith(prefix) ? input.nodeRef.id.slice(prefix.length) : ''
  if (!nodeId) {
    throw new CanvasApplicationError('INVALID_INPUT',
      `canvas.node 引用 ${input.nodeRef.id} 不是画布 ${input.canvasRef.id} 的完整稳定引用；请重新读取该画布的节点引用并传入 ${input.canvasRef.id}:<nodeId>`,
      true, { expectedNodeRefFormat: `${input.canvasRef.id}:<nodeId>` })
  }
  return nodeId
}

/** 画布里带自己编辑器的节点：可编辑的多图层图片文档节点、3D 镜头参考节点 */
function openableNodeRefs(projectId: string): string[] {
  return useCanvasStore.getState().nodes
    .filter(node => isEditableLayerStackResultNode(node) || isCameraStageNode(node))
    .map(node => `${projectId}:${node.id}`)
}

function waitForCameraStageEditor(nodeId: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CanvasApplicationError('ABORTED', '打开 3D 编辑器已取消'))
      return
    }
    let unsubscribe = (): void => {}
    const finish = (settle: () => void): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      unsubscribe()
      settle()
    }
    const check = (state: ReturnType<typeof useCameraStageNodeEditor.getState>): void => {
      if (state.nodeId !== nodeId) {
        finish(() => reject(new CanvasApplicationError('CONFLICT', '3D 编辑器在载入完成前被关闭或切到了别的节点', true)))
      } else if (state.failure) {
        // 失败后弹窗仍开着，同一节点再打开不会重新载入，所以重试要先关掉它
        finish(() => reject(new CanvasApplicationError('CAPABILITY_REJECTED', `3D 编辑器载入失败：${state.failure}。请用户关闭这个 3D 编辑器后再试`, false)))
      } else if (state.documentId) {
        const documentId = state.documentId
        finish(() => resolve(documentId))
      }
    }
    const onAbort = (): void => finish(() => reject(new CanvasApplicationError('ABORTED', '打开 3D 编辑器已取消')))
    const timer = setTimeout(() => finish(() => reject(new CanvasApplicationError('CAPABILITY_NOT_READY',
      '3D 编辑器没有在限定时间内载入；请保持画布可见后重试', true))), CAMERA_STAGE_LOAD_TIMEOUT_MS)
    signal.addEventListener('abort', onAbort)
    unsubscribe = useCameraStageNodeEditor.subscribe(check)
    check(useCameraStageNodeEditor.getState())
  })
}

async function openCameraStageNode(input: OpenCanvasNodeEditorInput, nodeId: string, signal: AbortSignal): Promise<OpenCanvasNodeEditorResult> {
  const projectId = input.canvasRef.id
  const surfaceRef = { kind: 'application.surface', id: 'workspace.canvas' }
  const result = (documentId: string, status: OpenCanvasNodeEditorResult['status']): OpenCanvasNodeEditorResult => {
    const cameraStageDocumentRef = { kind: 'camera_stage.document' as const, id: documentId }
    return { canvasRef: input.canvasRef, nodeRef: input.nodeRef, surfaceId: 'workspace.canvas', editorKind: 'camera_stage', status,
      cameraStageDocumentRef, resultRefs: [input.canvasRef, input.nodeRef, surfaceRef, cameraStageDocumentRef],
      verification: { verified: true, condition: '节点的 3D 编辑器已打开，并已把它的镜头参考载入场景' } }
  }
  const current = useCameraStageNodeEditor.getState()
  if (current.nodeId === nodeId && current.documentId) return result(current.documentId, 'already_open')
  if (useCameraStageRenderProgressStore.getState().tasks.has(`${projectId}:${nodeId}`)) {
    throw new CanvasApplicationError('CONFLICT', '这个 3D 节点正在渲染，渲染结束后再打开编辑器', true)
  }
  if (current.nodeId !== nodeId) openCameraStageNodeEditorDialog(nodeId)
  return result(await waitForCameraStageEditor(nodeId, signal), 'opened')
}

/** 打开画布节点自己的编辑器；按节点类型分派，界面上双击节点也是同一件事。 */
export async function openCanvasNodeEditor(input: OpenCanvasNodeEditorInput): Promise<OpenCanvasNodeEditorResult> {
  const signal = input.signal ?? new AbortController().signal
  const nodeId = nodeIdOf(input)
  const projectId = input.canvasRef.id
  logger.info('画布节点编辑器打开开始', { event: 'canvas.node_editor.open.start', projectId, nodeId, ...input.correlation })
  try {
    await openCanvasProject(projectId, signal)
    const { nodes, activeToolDialog } = useCanvasStore.getState()
    const node = nodes.find(candidate => candidate.id === nodeId)
    if (!node) {
      throw new CanvasApplicationError('NOT_FOUND',
        `画布里没有节点 ${input.nodeRef.id}。可打开的 canvas.node 引用：${openableNodeRefs(projectId).join('、') || '无'}`,
        true, { openableNodeRefs: openableNodeRefs(projectId) })
    }
    // 两种节点编辑器都是全屏的，同一时刻只开一个
    const activeNodeId = [useCameraStageNodeEditor.getState().nodeId, activeToolDialog?.nodeId]
      .find(id => id && id !== nodeId && nodes.some(candidate => candidate.id === id))
    if (activeNodeId) {
      throw new CanvasApplicationError('CONFLICT',
        `当前正在编辑画布节点 ${projectId}:${activeNodeId}；请先关闭它，再打开 ${input.nodeRef.id}`, true,
        { activeNodeRef: `${projectId}:${activeNodeId}`, requestedNodeRef: input.nodeRef.id })
    }
    let result: OpenCanvasNodeEditorResult
    if (isCameraStageNode(node)) {
      openApplicationSurface('workspace.canvas', input.correlation)
      await focusCanvasNode(projectId, nodeId, signal)
      result = await openCameraStageNode(input, nodeId, signal)
    } else if (!isEditableLayerStackResultNode(node) && node.type !== CANVAS_NODE_TYPES.layerStackResult) {
      throw new CanvasApplicationError('CAPABILITY_REJECTED',
        `节点 ${input.nodeRef.id} 的类型 ${node.type} 没有自己的编辑器。可打开的 canvas.node 引用：${openableNodeRefs(projectId).join('、') || '无'}`,
        true, { actualNodeType: node.type, openableNodeRefs: openableNodeRefs(projectId) })
    } else {
      // 多图层节点未完成等情况由它自己的打开流程给出带可选引用的拒绝
      result = { ...await openMultiLayerDocumentNodeEditor(input),
        verification: { verified: true, condition: '节点的多图层图片编辑器已在画布中打开' } }
    }
    logger.info('画布节点编辑器打开完成', { event: 'canvas.node_editor.open.completed', projectId, nodeId,
      editorKind: result.editorKind, status: result.status, ...input.correlation })
    return result
  } catch (error) {
    logger.error('画布节点编辑器打开失败', error, { event: 'canvas.node_editor.open.failed', projectId, nodeId, ...input.correlation })
    throw error
  }
}
