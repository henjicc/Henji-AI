import type { ApplicationRef } from '@/core/application-control'
import { createLogger } from '@/core/logging'
import { openApplicationSurface } from '@/features/navigation/application'
import { useCanvasStore } from '@/stores/canvasStore'

import { isEditableLayerStackResultNode } from '../domain/canvasNodeGuards'
import type { LayerStackResultNodeData } from '../domain/canvasNodeData'
import { CANVAS_NODE_TYPES, NODE_TOOL_TYPES } from '../domain/canvasNodes'
import { parseMultiLayerDocumentNodeState } from '../domain/multiLayerDocumentNode'
import { CanvasApplicationError, focusCanvasNode } from './canvasApplicationService'
import { openMultiLayerDocumentForEditing } from './multiLayerDocumentNodeGenerationAdapter'
import { openCanvasProjectWithSummary } from './canvasProjectService'

const logger = createLogger('features.canvas.multi_layer_document_editor_application')

export interface OpenMultiLayerDocumentNodeEditorInput {
  projectRef: ApplicationRef & { kind: 'canvas.project' }
  nodeRef: ApplicationRef & { kind: 'canvas.node' }
  signal?: AbortSignal
  correlation?: { requestId?: string; taskId?: string }
}

export interface OpenMultiLayerDocumentNodeEditorResult {
  projectRef: ApplicationRef & { kind: 'canvas.project' }
  nodeRef: ApplicationRef & { kind: 'canvas.node' }
  surfaceId: 'workspace.canvas'
  editorKind: 'multi_layer_document'
  status: 'opened' | 'already_open'
  resultRefs: [
    ApplicationRef & { kind: 'canvas.project' },
    ApplicationRef & { kind: 'canvas.node' },
    ApplicationRef & { kind: 'application.surface'; id: 'workspace.canvas' },
  ]
}

interface OpenMultiLayerDocumentNodeEditorDependencies {
  openProject?: typeof openCanvasProjectWithSummary
  openSurface?: typeof openApplicationSurface
  focusNode?: typeof focusCanvasNode
  validateDocument?: typeof openMultiLayerDocumentForEditing
}

function resolveTarget(input: OpenMultiLayerDocumentNodeEditorInput): {
  projectId: string
  nodeId: string
  nodeRef: ApplicationRef & { kind: 'canvas.node' }
} {
  const projectId = input.projectRef.id
  const requiredPrefix = `${projectId}:`
  const nodeId = input.nodeRef.id.startsWith(requiredPrefix)
    ? input.nodeRef.id.slice(requiredPrefix.length)
    : ''
  if (!nodeId) {
    throw new CanvasApplicationError(
      'INVALID_INPUT',
      `canvas.node 引用 ${input.nodeRef.id} 不是项目 ${projectId} 的完整稳定引用；请重新读取该项目的节点引用并传入 ${projectId}:<nodeId>`,
      true,
      {
        projectRef: input.projectRef,
        nodeRef: input.nodeRef,
        expectedNodeRefFormat: `${projectId}:<nodeId>`,
      },
    )
  }
  return {
    projectId,
    nodeId,
    nodeRef: { ...input.nodeRef, id: `${projectId}:${nodeId}` },
  }
}

function editableNodeRefs(projectId: string): string[] {
  return useCanvasStore.getState().nodes
    .filter(isEditableLayerStackResultNode)
    .map((node) => `${projectId}:${node.id}`)
}

function rejectionDetails(projectId: string, actualNodeType?: string, actualState?: string): {
  projectId: string
  actualNodeType?: string
  actualState?: string
  editableNodeRefs: string[]
} {
  return {
    projectId,
    ...(actualNodeType ? { actualNodeType } : {}),
    ...(actualState ? { actualState } : {}),
    editableNodeRefs: editableNodeRefs(projectId),
  }
}

function rejectionMessage(input: {
  nodeId: string
  actualNodeType?: string
  actualState?: string
  editableRefs: string[]
}): string {
  const actual = input.actualState
    ? `实际文档状态为 ${input.actualState}`
    : input.actualNodeType
      ? `实际节点类型为 ${input.actualNodeType}`
      : '该节点不存在'
  const available = input.editableRefs.length > 0
    ? input.editableRefs.join('、')
    : '当前项目没有可打开的多图层图片文档节点'
  return `不能打开节点 ${input.nodeId} 的多图层文档编辑器：${actual}。可打开的 canvas.node 引用：${available}`
}

export async function openMultiLayerDocumentNodeEditor(
  input: OpenMultiLayerDocumentNodeEditorInput,
  dependencies: OpenMultiLayerDocumentNodeEditorDependencies = {},
): Promise<OpenMultiLayerDocumentNodeEditorResult> {
  const openProject = dependencies.openProject ?? openCanvasProjectWithSummary
  const openSurface = dependencies.openSurface ?? openApplicationSurface
  const focusNode = dependencies.focusNode ?? focusCanvasNode
  const validateDocument = dependencies.validateDocument ?? openMultiLayerDocumentForEditing
  const signal = input.signal ?? new AbortController().signal
  const target = resolveTarget(input)
  logger.info('多图层文档节点编辑器打开开始', {
    event: 'canvas.multi_layer_document_editor.open.start',
    projectId: target.projectId,
    nodeId: target.nodeId,
    ...input.correlation,
  })
  try {
    if (input.signal?.aborted) {
      throw new CanvasApplicationError('ABORTED', '打开多图层文档节点编辑器已取消')
    }
    await openProject(target.projectId, signal)
    openSurface('workspace.canvas', input.correlation)
    await focusNode(target.projectId, target.nodeId, signal)
    const canvas = useCanvasStore.getState()
    const node = canvas.nodes.find((candidate) => candidate.id === target.nodeId)
    if (!node) {
      const details = rejectionDetails(target.projectId)
      throw new CanvasApplicationError(
        'NOT_FOUND',
        rejectionMessage({ nodeId: target.nodeId, editableRefs: details.editableNodeRefs }),
        true,
        details,
      )
    }
    if (!isEditableLayerStackResultNode(node)) {
      let actualState: string | undefined
      if (node.type === CANVAS_NODE_TYPES.layerStackResult) {
        try {
          actualState = parseMultiLayerDocumentNodeState(node.data as LayerStackResultNodeData).kind
        } catch {
          actualState = 'invalid'
        }
      }
      const details = rejectionDetails(target.projectId, node.type, actualState)
      throw new CanvasApplicationError(
        'CAPABILITY_REJECTED',
        rejectionMessage({
          nodeId: target.nodeId,
          actualNodeType: node.type,
          actualState,
          editableRefs: details.editableNodeRefs,
        }),
        true,
        details,
      )
    }
    const active = useCanvasStore.getState().activeToolDialog
    if (active?.nodeId === node.id && active.toolType === NODE_TOOL_TYPES.edit) {
      logger.info('多图层文档节点编辑器已经打开', {
        event: 'canvas.multi_layer_document_editor.open.completed',
        projectId: target.projectId,
        nodeId: target.nodeId,
        status: 'already_open',
        ...input.correlation,
      })
      return createResult(input.projectRef, target.nodeRef, 'already_open')
    }
    await validateDocument({ nodeId: node.id, data: node.data, signal })
    if (active) {
      throw new CanvasApplicationError(
        'CONFLICT',
        `当前正在编辑画布节点 ${active.nodeId}；请先关闭它，再打开 ${target.projectId}:${target.nodeId}`,
        true,
        {
          activeNodeRef: `${target.projectId}:${active.nodeId}`,
          requestedNodeRef: `${target.projectId}:${target.nodeId}`,
        },
      )
    }
    useCanvasStore.getState().openToolDialog({ nodeId: node.id, toolType: NODE_TOOL_TYPES.edit })
    const opened = useCanvasStore.getState().activeToolDialog
    if (opened?.nodeId !== node.id || opened.toolType !== NODE_TOOL_TYPES.edit) {
      throw new CanvasApplicationError(
        'CAPABILITY_NOT_READY',
        '画布界面尚未准备好打开节点编辑器；请保持 workspace.canvas 可见后重试',
        true,
        { requestedNodeRef: `${target.projectId}:${target.nodeId}` },
      )
    }
    logger.info('多图层文档节点编辑器打开完成', {
      event: 'canvas.multi_layer_document_editor.open.completed',
      projectId: target.projectId,
      nodeId: target.nodeId,
      status: 'opened',
      ...input.correlation,
    })
    return createResult(input.projectRef, target.nodeRef, 'opened')
  } catch (error) {
    logger.error('多图层文档节点编辑器打开失败', error, {
      event: 'canvas.multi_layer_document_editor.open.failed',
      projectId: target.projectId,
      nodeId: target.nodeId,
      ...input.correlation,
    })
    throw error
  }
}

function createResult(
  projectRef: ApplicationRef & { kind: 'canvas.project' },
  nodeRef: ApplicationRef & { kind: 'canvas.node' },
  status: OpenMultiLayerDocumentNodeEditorResult['status'],
): OpenMultiLayerDocumentNodeEditorResult {
  const surfaceRef = {
    kind: 'application.surface' as const,
    id: 'workspace.canvas' as const,
  }
  return {
    projectRef,
    nodeRef,
    surfaceId: 'workspace.canvas',
    editorKind: 'multi_layer_document',
    status,
    resultRefs: [projectRef, nodeRef, surfaceRef],
  }
}
