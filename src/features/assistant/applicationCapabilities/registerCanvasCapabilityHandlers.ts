import type {
  CanvasBatchOperation,
} from '@/core/assistant/capabilities/canvasBatchApplicationCapabilities'
import type {
  CanvasNodePlacement,
} from '@/core/assistant/capabilities/canvasMutationApplicationCapabilities'
import type { CanvasDownloadDestination } from '@/core/assistant/capabilities/canvasExportApplicationCapabilities'
import {
  AGENT_CANVAS_CATALOG_VERSION,
  getAgentCanvasNodeSchema,
  searchAgentCanvasNodeTypes,
} from '@/features/canvas/domain/agentCanvasCatalog'
import {
  addCanvasNodeFromAgent,
  connectCanvasNodesFromAgent,
  focusCanvasNodeFromAgent,
  undoCanvasChangeFromAgent,
} from '@/features/canvas/application/agentCanvasActions'
import {
  commitCanvasBatchFromAgent,
  planCanvasBatchFromAgent,
  previewCanvasBatchFromAgent,
} from '@/features/canvas/application/agentCanvasBatch'
import {
  closeCanvasProjectFromAgent,
  createCanvasProjectFromAgent,
  deleteCanvasProjectFromAgent,
  openCanvasProjectWithSummaryFromAgent,
  renameCanvasProjectFromAgent,
} from '@/features/canvas/application/agentCanvasProjects'
import {
  deleteCanvasNodesFromAgent,
  disconnectCanvasEdgeFromAgent,
  duplicateCanvasNodeFromAgent,
  groupCanvasNodesFromAgent,
  selectCanvasNodeFromAgent,
  updateCanvasNodeFromAgent,
} from '@/features/canvas/application/agentCanvasMutations'
import {
  getCanvasNodeFromAgent,
  getCanvasProjectFromAgent,
  listCanvasProjectSummariesFromAgent,
} from '@/features/canvas/application/agentCanvasQueries'
import { addAssetToCanvasFromAgent } from '@/features/assistant/hostActions'
import { downloadCanvasMediaFromAgent } from '@/features/canvas/application/agentCanvasDownloads'
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
    projects: await listCanvasProjectSummariesFromAgent(),
  }))

  registrar.registerHandler('open_canvas_project', async (input, context) => {
    const parsed = parseCapabilityInput<ProjectInput>('open_canvas_project', input)
    const result = await openCanvasProjectWithSummaryFromAgent(parsed.projectId, context.signal)
    return { ...result, ...openApplicationSurface('workspace.canvas', context) }
  })

  registrar.registerHandler('search_canvas_node_types', (input) => {
    const parsed = parseCapabilityInput<{
      query: string
      cursor: number
      limit: number
    }>('search_canvas_node_types', input)
    const all = searchAgentCanvasNodeTypes(parsed.query)
    const nodeTypes = all.slice(parsed.cursor, parsed.cursor + parsed.limit)
    return {
      catalogVersion: AGENT_CANVAS_CATALOG_VERSION,
      nodeTypes,
      nextCursor: parsed.cursor + nodeTypes.length < all.length
        ? parsed.cursor + nodeTypes.length
        : null,
    }
  })

  registrar.registerHandler('get_canvas_node_schema', (input) => {
    const parsed = parseCapabilityInput<{ nodeType: string }>('get_canvas_node_schema', input)
    const schema = getAgentCanvasNodeSchema(parsed.nodeType)
    if (!schema) throw new Error('CANVAS_NODE_TYPE_NOT_FOUND')
    return { schema }
  })

  registrar.registerHandler('create_canvas_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ name: string }>('create_canvas_project', input)
    return await createCanvasProjectFromAgent(parsed.name)
  })

  registrar.registerHandler('close_canvas_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput>('close_canvas_project', input)
    return await closeCanvasProjectFromAgent(parsed.projectId)
  })

  registrar.registerHandler('rename_canvas_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { name: string }>(
      'rename_canvas_project',
      input
    )
    return await renameCanvasProjectFromAgent(parsed.projectId, parsed.name)
  })

  registrar.registerHandler('delete_canvas_project', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput>('delete_canvas_project', input)
    return await deleteCanvasProjectFromAgent(parsed.projectId)
  })

  registrar.registerHandler('get_canvas_project', (input) => {
    const parsed = parseCapabilityInput<ProjectInput>('get_canvas_project', input)
    return getCanvasProjectFromAgent(parsed.projectId)
  })

  registrar.registerHandler('get_canvas_node', (input) => {
    const parsed = parseCapabilityInput<NodeInput>('get_canvas_node', input)
    return getCanvasNodeFromAgent(parsed.projectId, parsed.nodeId)
  })

  registrar.registerHandler('add_canvas_node', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    return addCanvasNodeFromAgent(parseCapabilityInput<AddNodeInput>('add_canvas_node', input))
  })

  registrar.registerHandler('add_asset_to_canvas', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      assetId: string
      placement: CanvasNodePlacement
    }>('add_asset_to_canvas', input)
    return await addAssetToCanvasFromAgent(parsed)
  })

  registrar.registerHandler('connect_canvas_nodes', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      sourceNodeId: string
      targetNodeId: string
    }>('connect_canvas_nodes', input)
    return connectCanvasNodesFromAgent(parsed)
  })

  registrar.registerHandler('focus_canvas_node', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<NodeInput>('focus_canvas_node', input)
    await openCanvasProjectWithSummaryFromAgent(parsed.projectId, context.signal)
    const surface = openApplicationSurface('workspace.canvas', context)
    const focused = await focusCanvasNodeFromAgent(parsed.projectId, parsed.nodeId, context.signal)
    return { ...focused, ...surface }
  })

  registrar.registerHandler('undo_canvas_change', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { undoRef: string }>(
      'undo_canvas_change',
      input
    )
    return undoCanvasChangeFromAgent(parsed.projectId, parsed.undoRef)
  })

  registrar.registerHandler('duplicate_canvas_node', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<NodeInput & { placement: CanvasNodePlacement }>(
      'duplicate_canvas_node',
      input
    )
    return duplicateCanvasNodeFromAgent(parsed)
  })

  registrar.registerHandler('update_canvas_node', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<NodeInput & { data: Record<string, unknown> }>(
      'update_canvas_node',
      input
    )
    return updateCanvasNodeFromAgent(parsed)
  })

  registrar.registerHandler('delete_canvas_nodes', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { nodeIds: string[] }>(
      'delete_canvas_nodes',
      input
    )
    return deleteCanvasNodesFromAgent(parsed.projectId, parsed.nodeIds)
  })

  registrar.registerHandler('select_canvas_node', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { nodeId: string | null }>(
      'select_canvas_node',
      input
    )
    return selectCanvasNodeFromAgent(parsed.projectId, parsed.nodeId)
  })

  registrar.registerHandler('group_canvas_nodes', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { nodeIds: string[] }>(
      'group_canvas_nodes',
      input
    )
    return groupCanvasNodesFromAgent(parsed.projectId, parsed.nodeIds)
  })

  registrar.registerHandler('disconnect_canvas_edge', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & { edgeId: string }>(
      'disconnect_canvas_edge',
      input
    )
    return disconnectCanvasEdgeFromAgent(parsed.projectId, parsed.edgeId)
  })

  registrar.registerHandler('download_canvas_media', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<ProjectInput & {
      nodeIds: string[]
      destination: CanvasDownloadDestination
    }>('download_canvas_media', input)
    return await downloadCanvasMediaFromAgent(parsed)
  })

  registrar.registerHandler('plan_canvas_batch', (input) => {
    const parsed = parseCapabilityInput<ProjectInput & {
      operations: CanvasBatchOperation[]
    }>('plan_canvas_batch', input)
    return planCanvasBatchFromAgent(
      parsed.projectId,
      parsed.operations,
      createHostContextSnapshot().scopeRevisions.canvas
    )
  })

  registrar.registerHandler('preview_canvas_batch', (input) => {
    const parsed = parseCapabilityInput<{ planRef: string }>('preview_canvas_batch', input)
    return previewCanvasBatchFromAgent(parsed.planRef)
  })

  registrar.registerHandler('commit_canvas_batch', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{ planRef: string }>('commit_canvas_batch', input)
    return await commitCanvasBatchFromAgent(parsed.planRef)
  })
}
