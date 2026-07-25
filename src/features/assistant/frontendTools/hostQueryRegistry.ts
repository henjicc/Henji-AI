import {
  hostQuerySchema,
  type HostCommandResult,
  type HostQuery,
} from '@/core/assistant/hostContracts'
import {
  GenerationPreparationError,
  getGenerationModelSchema,
  prepareGenerationTask,
  searchGenerationModels,
} from '@/core/assistant/generationPreparation'
import { createGenerationTaskRecoveryAdvice } from '@/core/assistant/generationTaskRecovery'
import {
  AGENT_CANVAS_CATALOG_VERSION,
  getAgentCanvasNodeSchema,
  searchAgentCanvasNodeTypes,
} from '@/features/canvas/domain/agentCanvasCatalog'
import {
  getCanvasNodeFromAgent,
  getCanvasProjectFromAgent,
  listCanvasProjectSummariesFromAgent,
} from '@/features/canvas/application/agentCanvasQueries'
import {
  planCanvasBatchFromAgent,
  previewCanvasBatchFromAgent,
} from '@/features/canvas/application/agentCanvasBatch'
import {
  getAssetFromAgent,
  getCameraStageProjectFromAgent,
  getStoryboardProjectFromAgent,
  getToolboxStateFromAgent,
  listAssetLibrariesFromAgent,
  listAssetTagsFromAgent,
  listCameraStageProjectsFromAgent,
  listStoryboardProjectsFromAgent,
  listToolboxToolsFromAgent,
  queryAssetsFromAgent,
} from '@/features/assistant/hostActions'
import { createHostContextSnapshot } from '../hostContext/hostContext'
import { getVisibleGenerationTask } from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'

type HostQueryHandler = (query: HostQuery) => Promise<Record<string, unknown>>

const handlers = new Map<HostQuery['name'], HostQueryHandler>([
  ['get_host_context', async () => ({ snapshot: createHostContextSnapshot() })],
  ['list_canvas_projects', async () => ({ projects: await listCanvasProjectSummariesFromAgent() })],
  ['get_canvas_project', async (query) => {
    if (query.name !== 'get_canvas_project') return {}
    return getCanvasProjectFromAgent(query.input.projectId)
  }],
  ['get_canvas_node', async (query) => {
    if (query.name !== 'get_canvas_node') return {}
    return getCanvasNodeFromAgent(query.input.projectId, query.input.nodeId)
  }],
  ['plan_canvas_batch', async (query) => {
    if (query.name !== 'plan_canvas_batch') return {}
    return planCanvasBatchFromAgent(
      query.input.projectId,
      query.input.operations,
      createHostContextSnapshot().scopeRevisions.canvas,
    )
  }],
  ['preview_canvas_batch', async (query) => {
    if (query.name !== 'preview_canvas_batch') return {}
    return previewCanvasBatchFromAgent(query.input.planRef)
  }],
  ['search_canvas_node_types', async (query) => {
    if (query.name !== 'search_canvas_node_types') return {}
    const all = searchAgentCanvasNodeTypes(query.input.query)
    const start = query.input.cursor
    const nodeTypes = all.slice(start, start + query.input.limit)
    return {
      catalogVersion: AGENT_CANVAS_CATALOG_VERSION,
      nodeTypes,
      nextCursor: start + nodeTypes.length < all.length ? start + nodeTypes.length : null,
    }
  }],
  ['get_canvas_node_schema', async (query) => {
    if (query.name !== 'get_canvas_node_schema') return {}
    const schema = getAgentCanvasNodeSchema(query.input.nodeType)
    if (!schema) throw new Error('CANVAS_NODE_TYPE_NOT_FOUND')
    return { schema }
  }],
  ['search_models', async (query) => {
    if (query.name !== 'search_models') return {}
    const filtered = searchGenerationModels(query.input)
    const start = query.input.cursor
    const models = filtered.slice(start, start + query.input.limit)
    return {
      catalogVersion: 'model-registry/v1',
      models,
      nextCursor: start + models.length < filtered.length ? start + models.length : null,
      selectionContext: {
        requestedMediaType: query.input.mediaType ?? null,
        requestedProviderId: query.input.providerId ?? null,
        requestedTags: query.input.tags ?? [],
        requestedSortBy: query.input.sortBy ?? 'registry',
        requestedQuery: query.input.query,
        compatibleCandidateCount: filtered.length,
        exclusionRules: [
          '媒体类型不匹配',
          '用户明确供应商不匹配',
          '必需能力标签缺失',
          '明确模型关键词不匹配',
        ],
      },
    }
  }],
  ['get_model_schema', async (query) => {
    if (query.name !== 'get_model_schema') return {}
    return getGenerationModelSchema(query.input.modelId)
  }],
  ['prepare_generation_task', async (query) => {
    if (query.name !== 'prepare_generation_task') return {}
    return { preparation: prepareGenerationTask(query.input) }
  }],
  ['get_generation_task', async (query) => {
    if (query.name !== 'get_generation_task') return {}
    const task = getVisibleGenerationTask(query.input.taskId)
    if (!task) throw new Error('TASK_NOT_FOUND')
    return {
      task: {
        ...task,
        recovery: createGenerationTaskRecoveryAdvice(task),
      },
    }
  }],
  ['list_toolbox_tools', async () => ({ tools: listToolboxToolsFromAgent() })],
  ['get_toolbox_state', async () => ({ state: getToolboxStateFromAgent() })],
  ['list_camera_stage_projects', async () => ({ projects: await listCameraStageProjectsFromAgent() })],
  ['get_camera_stage_project', async (query) => {
    if (query.name !== 'get_camera_stage_project') return {}
    return { project: await getCameraStageProjectFromAgent(query.input.projectId) }
  }],
  ['list_storyboard_projects', async () => ({ projects: await listStoryboardProjectsFromAgent() })],
  ['get_storyboard_project', async (query) => {
    if (query.name !== 'get_storyboard_project') return {}
    return { project: await getStoryboardProjectFromAgent(query.input.projectId) }
  }],
  ['query_assets', async (query) => {
    if (query.name !== 'query_assets') return {}
    return await queryAssetsFromAgent(query.input)
  }],
  ['get_asset', async (query) => {
    if (query.name !== 'get_asset') return {}
    return { asset: await getAssetFromAgent(query.input.assetId) }
  }],
  ['list_asset_libraries', async () => ({ libraries: await listAssetLibrariesFromAgent() })],
  ['list_asset_tags', async () => ({ tags: await listAssetTagsFromAgent() })],
])

export async function executeHostQuery(queryInput: unknown): Promise<Record<string, unknown>> {
  const query = hostQuerySchema.parse(queryInput)
  const handler = handlers.get(query.name)
  if (!handler) throw new Error(`Unknown host query: ${query.name}`)
  return await handler(query)
}

export async function executeHostQueryResult(queryInput: unknown): Promise<HostCommandResult> {
  try {
    const data = await executeHostQuery(queryInput)
    const snapshot = createHostContextSnapshot()
    return {
      ok: true,
      data,
      resultingRevision: snapshot.revision,
      resultingScopeRevisions: snapshot.scopeRevisions,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      error instanceof GenerationPreparationError && error.code === 'MODEL_NOT_FOUND'
      || message === 'MODEL_NOT_FOUND'
      || message === 'TASK_NOT_FOUND'
      || message === 'CANVAS_NODE_TYPE_NOT_FOUND'
      || message === 'NOT_FOUND'
      || message === 'PROJECT_NOT_FOUND'
    ) {
      return {
        ok: false,
        error: { code: 'NOT_FOUND', message: '请求的宿主资源不存在', recoverable: false },
      }
    }
    if (error instanceof GenerationPreparationError) {
      return {
        ok: false,
        error: {
          code: 'INVALID_INPUT',
          message: error.message,
          recoverable: true,
          details: error.details,
        },
      }
    }
    return {
      ok: false,
      error: { code: 'COMMAND_REJECTED', message: message || '宿主查询执行失败', recoverable: false },
    }
  }
}
