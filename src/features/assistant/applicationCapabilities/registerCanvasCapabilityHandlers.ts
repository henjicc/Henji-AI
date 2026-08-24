import type {
  CanvasBatchOperation,
} from '@/core/assistant/capabilities/canvasBatchApplicationCapabilities'
import type {
  CanvasNodePlacement,
} from '@/core/assistant/capabilities/canvasMutationApplicationCapabilities'
import type { CanvasDownloadDestination } from '@/core/assistant/capabilities/canvasExportApplicationCapabilities'
import {
  CANVAS_NODE_CONTROL_CATALOG_VERSION,
  getCanvasNodeSchema,
  searchCanvasNodeTypes,
} from '@/features/canvas/domain/nodeControlRegistry'
import {
  addCanvasNode,
  connectCanvasNodes,
  focusCanvasNode,
  redoCanvasChange,
  undoCanvasChange,
} from '@/features/canvas/application/canvasApplicationService'
import {
  commitCanvasBatch,
  planCanvasBatch,
  previewCanvasBatch,
} from '@/features/canvas/application/canvasBatchService'
import { getHostScopeRevisions, notifyHostScopeChanged } from '../hostContext/hostContext'
import { configureCanvasCollectionDependencies } from './applicationControlRegistry'

// 画布集合写入的 revision 依赖由适配器注入，与三维的 configureCameraStageControlDependencies 同理：
// 注册表本身不 import hostContext，避免把 taskQueue 等浏览器依赖拉进模块图。
configureCanvasCollectionDependencies({
  readRevision: () => getHostScopeRevisions().canvas,
  bumpRevision: () => notifyHostScopeChanged('canvas'),
})
import {
  closeCanvasProject,
  createCanvasProject,
  deleteCanvasProject,
  openCanvasProjectWithSummary,
  renameCanvasProject,
} from '@/features/canvas/application/canvasProjectService'
import {
  clearCanvasProject,
  connectAssetGroupToTarget,
  deleteCanvasNodes,
  disconnectAssetGroupFromTarget,
  disconnectCanvasEdge,
  duplicateCanvasNode,
  groupCanvasNodes,
  selectCanvasNode,
  ungroupCanvasNode,
  updateCanvasNode,
} from '@/features/canvas/application/canvasMutationService'
import {
  getCanvasNode,
  getCanvasProject,
  listCanvasProjectSummaries,
} from '@/features/canvas/application/canvasQueryService'
import { addAssetToCanvas } from '@/features/assets/application/assetCanvasApplicationService'
import { addGenerationResultToCanvas } from './generationResultCanvasApplicationService'
import { downloadCanvasMedia } from '@/features/canvas/application/canvasDownloadService'
import { createHostContextSnapshot } from '../hostContext/hostContext'
import type { ApplicationCapabilityHandlerRegistrar } from './handlerTypes'
import { parseCapabilityInput, throwIfCapabilityAborted } from './handlerUtils'
import { openApplicationSurface } from './surfaceRegistry'

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
  registrar: ApplicationCapabilityHandlerRegistrar
): void {
  registrar.registerHandler('list_canvas_projects', async () => ({
    projects: await listCanvasProjectSummaries(),
  }))

  registrar.registerHandler('open_canvas_project', async (input, context) => {
    const parsed = parseCapabilityInput<ProjectInput>('open_canvas_project', input)
    const result = await openCanvasProjectWithSummary(parsed.projectId, context.signal)
    return { ...result, ...openApplicationSurface('workspace.canvas', context) }
  })

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

  registrar.registerHandler('create_canvas_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ name: string }>('create_canvas_project', input)
    return await createCanvasProject(parsed.name)
  })

  registrar.registerHandler('close_canvas_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput>('close_canvas_project', input)
    return await closeCanvasProject(parsed.projectId)
  })

  registrar.registerHandler('rename_canvas_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { name: string }>(
      'rename_canvas_project',
      input
    )
    return await renameCanvasProject(parsed.projectId, parsed.name)
  })

  registrar.registerHandler('delete_canvas_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput>('delete_canvas_project', input)
    return await deleteCanvasProject(parsed.projectId)
  })

  registrar.registerHandler('get_canvas_project', (input) => {
    const parsed = parseCapabilityInput<ProjectInput>('get_canvas_project', input)
    return getCanvasProject(parsed.projectId)
  })

  registrar.registerHandler('get_canvas_node', (input) => {
    const parsed = parseCapabilityInput<NodeInput>('get_canvas_node', input)
    return getCanvasNode(parsed.projectId, parsed.nodeId)
  })

  registrar.registerHandler('add_canvas_node', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    return addCanvasNode(parseCapabilityInput<AddNodeInput>('add_canvas_node', input))
  })

  registrar.registerHandler('add_asset_to_canvas', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      assetId: string
      placement: CanvasNodePlacement
    }>('add_asset_to_canvas', input)
    return await addAssetToCanvas(parsed)
  })

  registrar.registerHandler('add_generation_result_to_canvas', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      resultRef: { kind: 'generation.result'; id: string }
      placement: CanvasNodePlacement
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
    await openCanvasProjectWithSummary(parsed.projectId, context.signal)
    const surface = openApplicationSurface('workspace.canvas', context)
    const focused = await focusCanvasNode(parsed.projectId, parsed.nodeId, context.signal)
    return { ...focused, ...surface }
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
