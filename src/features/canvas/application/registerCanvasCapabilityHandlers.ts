import type { CanvasBatchOperation } from '@/core/application-control/domains/canvas/canvasBatchApplicationCapabilities'
import type { CanvasNodePlacement } from '@/core/application-control/domains/canvas/canvasMutationApplicationCapabilities'
import { OPEN_MULTI_LAYER_DOCUMENT_NODE_EDITOR_CAPABILITY_ID, RETRY_LAYER_STACK_RESULT_CAPABILITY_ID } from '@/core/application-control/domains/canvas/canvasEditorApplicationCapabilities'
import type { ApplicationRef } from '@/core/application-control/index'
import { retryLayerStackResult } from '@/features/canvas/application/layerStackResultRecoveryService'
import type { AssistantCanvasImageCapabilityId } from '@/core/canvas/imageCapabilityIds'
import type { CanvasDownloadDestination } from '@/core/application-control/domains/canvas/canvasExportApplicationCapabilities'
import { CANVAS_NODE_CONTROL_CATALOG_VERSION, getCanvasNodeSchema, searchCanvasNodeTypes } from '@/features/canvas/domain/nodeControlRegistry'
import { addCanvasNode, connectCanvasNodes, focusCanvasNode, openCanvasProject, redoCanvasChange, undoCanvasChange } from '@/features/canvas/application/canvasApplicationService'
import { commitCanvasBatch, planCanvasBatch, previewCanvasBatch } from '@/features/canvas/application/canvasBatchService'
import { createCanvasDocumentIn, openCanvasDocument, releaseCanvasDocument } from '@/features/canvas/application/canvasProjectService'
import { registerDocumentCreator, registerDocumentOpener, registerDocumentReleaser } from '@/features/documents/documentOperations'
import { clearCanvasProject, connectAssetGroupToTarget, deleteCanvasNodes, disconnectAssetGroupFromTarget, disconnectCanvasEdge, duplicateCanvasNode, groupCanvasNodes, selectCanvasNode, ungroupCanvasNode, updateCanvasNode } from '@/features/canvas/application/canvasMutationService'
import { getCanvasNode, getCanvasProject } from '@/features/canvas/application/canvasQueryService'
import { addAssetToCanvas } from '@/features/assets/application/assetCanvasApplicationService'
import { addGenerationResultToCanvas } from '@/features/canvas/application/generationResultCanvasApplicationService'
import { downloadCanvasMedia } from '@/features/canvas/application/canvasDownloadService'
import { executeCanvasImageCapabilityForProject } from '@/features/canvas/application/canvasImageCapabilityApplicationService'
import { type OpenMultiLayerDocumentNodeEditorInput, openMultiLayerDocumentNodeEditor } from '@/features/canvas/application/multiLayerDocumentNodeEditorApplicationService'
import { exportMultiLayerDocumentTargetToCanvas, type MultiLayerDocumentTargetExportInput } from '@/features/canvas/application/multiLayerDocumentNodeGenerationAdapter'
import { createHostContextSnapshot } from '@/features/application-control/hostContext/hostContext'
import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'
import { parseDocumentCapabilityInput, throwIfCapabilityAborted, withDocumentIdOutput } from '@/features/application-control/capabilities/handlerUtils'
import { normalizeCanvasNodeIds } from './canvasNodeIdNormalization'

/**
 * 画布能力统一从这里取参：公共契约里的 `documentId`（画布文档 ID）在这里换成领域服务使用的 `projectId`；
 * 调用方拿到的 `canvas.node` 稳定引用是 `<画布>:<节点>`，原样回传时在这里把本画布的前缀剥掉，各处理器不必各写一遍，也不会漏掉新增的能力。
 */
function parseCapabilityInput<TInput>(id: string, input: unknown): TInput {
  return normalizeCanvasNodeIds(parseDocumentCapabilityInput<TInput>(id, input))
}

import { openApplicationSurface } from '@/features/navigation/application/surfaceCapabilityService'
import { confirmCanvasPersistence } from '@/features/canvas/application/canvasPersistenceService'

interface ProjectInput {
  projectId: string
}

interface NodeInput extends ProjectInput {
  nodeId: string
}

interface AddNodeInput extends ProjectInput {
  nodeType: string
  placement: CanvasNodePlacement
  data?: Record<string, unknown>
}

export function registerCanvasCapabilityHandlers(
  publicRegistrar: ApplicationCapabilityHandlerRegistrar
): void {
  const registrar = withDocumentIdOutput(publicRegistrar)
  registrar.registerHandler('retry_canvas_document_save', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const { documentRef } = parseCapabilityInput<{ documentRef: { kind: 'canvas.document'; id: string } }>(
      'retry_canvas_document_save', input,
    )
    await confirmCanvasPersistence(documentRef.id)
    return { ref: documentRef, status: 'persisted' }
  })
  // 画布文档的通用打开与后台释放（3.4）：列出、新建、改名、移动、副本、回收站走通用文档能力，
  // 这里只登记“打开到哪里”（画布工作区）和“后台持有的实例怎么释放”。
  registerDocumentOpener('canvas', async (document, { part } = {}) => {
    if (!await openCanvasDocument(document)) return
    openApplicationSurface('workspace.canvas')
    // 回到来源（4.1）：定位到放进剪辑的那个结果节点；节点已被删掉时只打开画布
    if (part) await focusCanvasNode(document.id, part, AbortSignal.timeout(10_000)).catch(() => undefined)
  })
  registerDocumentCreator('canvas', async (container) => {
    const created = await createCanvasDocumentIn(container)
    if (created) openApplicationSurface('workspace.canvas')
    return created
  })
  registerDocumentReleaser('canvas', releaseCanvasDocument)

  registrar.registerHandler('search_canvas_node_types', (input) => {
    const parsed = parseCapabilityInput<{
      query: string
      cursor: number
      limit: number
    }>('search_canvas_node_types', input)
    const all = searchCanvasNodeTypes(parsed.query)
    const nodeTypes = all.slice(parsed.cursor, parsed.cursor + parsed.limit)
    return {
      catalogVersion: CANVAS_NODE_CONTROL_CATALOG_VERSION,
      nodeTypes,
      nextCursor: parsed.cursor + nodeTypes.length < all.length
        ? parsed.cursor + nodeTypes.length
        : null,
    }
  })

  registrar.registerHandler('get_canvas_node_schema', (input) => {
    const parsed = parseCapabilityInput<{ nodeType: string }>('get_canvas_node_schema', input)
    const schema = getCanvasNodeSchema(parsed.nodeType)
    if (!schema) throw new Error('CANVAS_NODE_TYPE_NOT_FOUND')
    return { schema }
  })

  registrar.registerHandler('get_canvas_document', async (input) => {
    const parsed = parseCapabilityInput<ProjectInput>('get_canvas_document', input)
    const { project, ...rest } = await getCanvasProject(parsed.projectId)
    return { document: project, ...rest }
  })

  registrar.registerHandler('get_canvas_node', (input) => {
    const parsed = parseCapabilityInput<NodeInput>('get_canvas_node', input)
    return getCanvasNode(parsed.projectId, parsed.nodeId)
  })

  registrar.registerHandler('add_canvas_node', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    return addCanvasNode(parseCapabilityInput<AddNodeInput>('add_canvas_node', input))
  })

  registrar.registerHandler('apply_canvas_image_capability', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      sourceNodeId: string
      capabilityId: AssistantCanvasImageCapabilityId
    }>('apply_canvas_image_capability', input)
    return await executeCanvasImageCapabilityForProject(parsed)
  })

  registrar.registerHandler('export_image_edit_target_to_canvas', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<Omit<MultiLayerDocumentTargetExportInput, 'signal'>>(
      'export_image_edit_target_to_canvas',
      input,
    )
    return { ...await exportMultiLayerDocumentTargetToCanvas({ ...parsed, signal: context.signal }) }
  })

  registrar.registerHandler('add_asset_to_canvas', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      assetId: string
      placement: CanvasNodePlacement
    }>('add_asset_to_canvas', input)
    return await addAssetToCanvas(parsed, context.signal)
  })

  registrar.registerHandler('add_generation_result_to_canvas', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      resultRef: { kind: 'generation.result' | 'image_edit.preview'; id: string }
      placement?: CanvasNodePlacement
    }>('add_generation_result_to_canvas', input)
    return addGenerationResultToCanvas(parsed)
  })

  registrar.registerHandler('connect_canvas_nodes', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      sourceNodeId: string
      targetNodeId: string
    }>('connect_canvas_nodes', input)
    return connectCanvasNodes(parsed)
  })

  registrar.registerHandler('focus_canvas_node', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<NodeInput>('focus_canvas_node', input)
    await openCanvasProject(parsed.projectId, context.signal)
    const surface = openApplicationSurface('workspace.canvas', context)
    const focused = await focusCanvasNode(parsed.projectId, parsed.nodeId, context.signal)
    return { ...focused, ...surface }
  })

  registrar.registerHandler(OPEN_MULTI_LAYER_DOCUMENT_NODE_EDITOR_CAPABILITY_ID, async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<Omit<OpenMultiLayerDocumentNodeEditorInput, 'signal' | 'correlation'>>(
      OPEN_MULTI_LAYER_DOCUMENT_NODE_EDITOR_CAPABILITY_ID,
      input,
    )
    return { ...await openMultiLayerDocumentNodeEditor({
      ...parsed,
      signal: context.signal,
      correlation: context,
    }) }
  })

  registrar.registerHandler(RETRY_LAYER_STACK_RESULT_CAPABILITY_ID, (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ canvasRef: ApplicationRef; nodeRef: ApplicationRef }>(
      RETRY_LAYER_STACK_RESULT_CAPABILITY_ID, input,
    )
    const prefix = `${parsed.canvasRef.id}:`
    if (!parsed.nodeRef.id.startsWith(prefix) || parsed.nodeRef.id.length === prefix.length) {
      throw new Error(`请读取目标画布的完整节点引用，格式为 ${prefix}<nodeId>。`)
    }
    return { ...retryLayerStackResult({
      projectId: parsed.canvasRef.id,
      nodeId: parsed.nodeRef.id.slice(prefix.length),
      signal: context.signal,
      correlation: context,
    }) }
  })

  registrar.registerHandler('undo_canvas_change', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { undoRef: string }>(
      'undo_canvas_change',
      input
    )
    return undoCanvasChange(parsed.projectId, parsed.undoRef)
  })

  registrar.registerHandler('redo_canvas_change', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput>('redo_canvas_change', input)
    return redoCanvasChange(parsed.projectId)
  })

  registrar.registerHandler('duplicate_canvas_node', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<NodeInput & { placement: CanvasNodePlacement }>(
      'duplicate_canvas_node',
      input
    )
    return duplicateCanvasNode(parsed)
  })

  registrar.registerHandler('update_canvas_node', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<NodeInput & { data: Record<string, unknown> }>(
      'update_canvas_node',
      input
    )
    return updateCanvasNode(parsed)
  })

  registrar.registerHandler('delete_canvas_nodes', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { nodeIds: string[] }>(
      'delete_canvas_nodes',
      input
    )
    return deleteCanvasNodes(parsed.projectId, parsed.nodeIds)
  })

  registrar.registerHandler('select_canvas_node', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { nodeId: string | null }>(
      'select_canvas_node',
      input
    )
    return selectCanvasNode(parsed.projectId, parsed.nodeId)
  })

  registrar.registerHandler('group_canvas_nodes', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      nodeIds: string[]
      groupKind: 'spatial' | 'asset'
    }>(
      'group_canvas_nodes',
      input
    )
    return groupCanvasNodes(parsed.projectId, parsed.nodeIds, parsed.groupKind)
  })

  registrar.registerHandler('connect_asset_group_to_target', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { groupNodeId: string; targetNodeId: string }>(
      'connect_asset_group_to_target', input,
    )
    return connectAssetGroupToTarget(parsed.projectId, parsed.groupNodeId, parsed.targetNodeId)
  })

  registrar.registerHandler('disconnect_asset_group_from_target', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { groupNodeId: string; targetNodeId: string }>(
      'disconnect_asset_group_from_target', input,
    )
    return disconnectAssetGroupFromTarget(parsed.projectId, parsed.groupNodeId, parsed.targetNodeId)
  })

  registrar.registerHandler('ungroup_canvas_node', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { groupNodeId: string }>(
      'ungroup_canvas_node',
      input
    )
    return ungroupCanvasNode(parsed.projectId, parsed.groupNodeId)
  })

  registrar.registerHandler('clear_canvas', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput>('clear_canvas', input)
    return clearCanvasProject(parsed.projectId)
  })

  registrar.registerHandler('disconnect_canvas_edge', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { edgeId: string }>(
      'disconnect_canvas_edge',
      input
    )
    return disconnectCanvasEdge(parsed.projectId, parsed.edgeId)
  })

  registrar.registerHandler('download_canvas_media', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      nodeIds: string[]
      destination: CanvasDownloadDestination
    }>('download_canvas_media', input)
    return await downloadCanvasMedia(parsed)
  })

  registrar.registerHandler('plan_canvas_batch', (input) => {
    const parsed = parseCapabilityInput<ProjectInput & {
      operations: CanvasBatchOperation[]
    }>('plan_canvas_batch', input)
    return planCanvasBatch(
      parsed.projectId,
      parsed.operations,
      createHostContextSnapshot().scopeRevisions.canvas
    )
  })

  registrar.registerHandler('preview_canvas_batch', (input) => {
    const parsed = parseCapabilityInput<{ planRef: string }>('preview_canvas_batch', input)
    return previewCanvasBatch(parsed.planRef)
  })

  registrar.registerHandler('commit_canvas_batch', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ planRef: string }>('commit_canvas_batch', input)
    return await commitCanvasBatch(parsed.planRef)
  })
}
