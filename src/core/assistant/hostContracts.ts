import { z } from 'zod'
import { applicationCapabilityInvocationSchema } from './applicationCapabilities'
export const AGENT_CONTRACT_VERSION = 'agent-contract/v2' as const
export const LEGACY_AGENT_CONTRACT_VERSION = 'agent-contract/v1' as const

export const hostScopeSchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/)
export type HostScope = z.infer<typeof hostScopeSchema>

export const hostScopeRevisionsSchema = z.object({
  navigation: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
  canvas: z.number().int().nonnegative(),
  toolbox: z.number().int().nonnegative(),
  assets: z.number().int().nonnegative(),
}).catchall(z.number().int().nonnegative())
export type HostScopeRevisions = z.infer<typeof hostScopeRevisionsSchema>

export const hostContextSnapshotSchema = z.object({
  schemaVersion: z.union([z.literal(AGENT_CONTRACT_VERSION), z.literal(LEGACY_AGENT_CONTRACT_VERSION)]),
  rendererSessionId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  scopeRevisions: hostScopeRevisionsSchema,
  catalogRevision: z.number().int().nonnegative().optional(),
  surface: z.object({
    id: z.string().min(1).max(120), kind: z.enum(['workspace', 'tool', 'settings', 'overlay']),
    focusedRef: z.string().min(1).max(500).nullable(),
    selectedRefs: z.array(z.string().min(1).max(500)).max(32),
  }).strict().optional(),
  workspace: z.object({
    id: z.enum(['generation', 'nodes', 'tools', 'assets']),
    activeToolId: z.enum(['cameraStage', 'imageMark']).nullable(),
  }),
  project: z.object({
    id: z.string().min(1).nullable(),
    selectedNodeId: z.string().min(1).nullable(),
  }),
  generation: z.object({
    commandReady: z.boolean(),
    modelCatalog: z.object({
      catalogVersion: z.literal('model-registry/v1'),
      modelGroups: z.array(z.object({
        canonicalModelId: z.string().min(1),
        mediaType: z.enum(['image', 'video', 'audio']),
        name: z.string().min(1),
        description: z.string(),
        tags: z.array(z.string()),
        recommendedByDescription: z.boolean(),
        providers: z.array(z.object({
          providerId: z.string().min(1),
          modelId: z.string().min(1),
          priceEstimate: z.record(z.string(), z.unknown()),
        }).strict()).min(1).max(100),
      }).strict()).max(300),
    }).strict().optional(),
  }),
  assets: z.object({
    view: z.enum(['closed', 'floating', 'workspace']),
    selectedAssetId: z.string().min(1).nullable(),
  }),
  uiReady: z.boolean(),
  availableCapabilities: z.array(z.string().min(1)).optional(),
  availableCommands: z.array(z.string().min(1)),
  availableQueries: z.array(z.string().min(1)),
  capturedAt: z.string().datetime(),
})
export type HostContextSnapshot = z.infer<typeof hostContextSnapshotSchema>

const expectedRevisionsSchema = z.record(z.string(), z.number().int().nonnegative())
const commandBaseSchema = z.object({
  expectedRevisions: expectedRevisionsSchema.optional(),
})

export const switchWorkspaceCommandSchema = commandBaseSchema.extend({
  name: z.literal('switch_workspace'),
  input: z.object({
    workspace: z.enum(['generation', 'nodes', 'tools', 'assets']),
  }),
})

export const openCanvasProjectCommandSchema = commandBaseSchema.extend({
  name: z.literal('open_canvas_project'),
  input: z.object({ projectId: z.string().min(1) }),
})

export const createCanvasProjectCommandSchema = commandBaseSchema.extend({
  name: z.literal('create_canvas_project'),
  input: z.object({ name: z.string().trim().min(1).max(120) }),
})

export const closeCanvasProjectCommandSchema = commandBaseSchema.extend({
  name: z.literal('close_canvas_project'),
  input: z.object({ projectId: z.string().min(1) }),
})

export const renameCanvasProjectCommandSchema = commandBaseSchema.extend({
  name: z.literal('rename_canvas_project'),
  input: z.object({ projectId: z.string().min(1), name: z.string().trim().min(1).max(120) }),
})

export const deleteCanvasProjectCommandSchema = commandBaseSchema.extend({
  name: z.literal('delete_canvas_project'),
  input: z.object({ projectId: z.string().min(1) }),
})

export const canvasNodePlacementSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('viewport_center') }),
  z.object({
    mode: z.literal('right_of_node'),
    anchorNodeId: z.string().min(1),
  }),
])
export type CanvasNodePlacement = z.infer<typeof canvasNodePlacementSchema>

export const addCanvasNodeCommandSchema = commandBaseSchema.extend({
  name: z.literal('add_canvas_node'),
  input: z.object({
    projectId: z.string().min(1),
    nodeType: z.string().min(1),
    placement: canvasNodePlacementSchema,
    data: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const addAssetToCanvasCommandSchema = commandBaseSchema.extend({
  name: z.literal('add_asset_to_canvas'),
  input: z.object({
    projectId: z.string().min(1),
    assetId: z.string().min(1),
    placement: canvasNodePlacementSchema,
  }).strict(),
})

export const duplicateCanvasNodeCommandSchema = commandBaseSchema.extend({
  name: z.literal('duplicate_canvas_node'),
  input: z.object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    placement: canvasNodePlacementSchema,
  }),
})

export const updateCanvasNodeCommandSchema = commandBaseSchema.extend({
  name: z.literal('update_canvas_node'),
  input: z.object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  }),
})

export const deleteCanvasNodesCommandSchema = commandBaseSchema.extend({
  name: z.literal('delete_canvas_nodes'),
  input: z.object({ projectId: z.string().min(1), nodeIds: z.array(z.string().min(1)).min(1).max(50) }),
})

export const selectCanvasNodeCommandSchema = commandBaseSchema.extend({
  name: z.literal('select_canvas_node'),
  input: z.object({ projectId: z.string().min(1), nodeId: z.string().min(1).nullable() }),
})

export const groupCanvasNodesCommandSchema = commandBaseSchema.extend({
  name: z.literal('group_canvas_nodes'),
  input: z.object({ projectId: z.string().min(1), nodeIds: z.array(z.string().min(1)).min(2).max(50) }),
})

export const connectCanvasNodesCommandSchema = commandBaseSchema.extend({
  name: z.literal('connect_canvas_nodes'),
  input: z.object({
    projectId: z.string().min(1),
    sourceNodeId: z.string().min(1),
    targetNodeId: z.string().min(1),
  }),
})

export const disconnectCanvasEdgeCommandSchema = commandBaseSchema.extend({
  name: z.literal('disconnect_canvas_edge'),
  input: z.object({ projectId: z.string().min(1), edgeId: z.string().min(1) }),
})

export const focusCanvasNodeCommandSchema = commandBaseSchema.extend({
  name: z.literal('focus_canvas_node'),
  input: z.object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
  }),
})

export const undoCanvasChangeCommandSchema = commandBaseSchema.extend({
  name: z.literal('undo_canvas_change'),
  input: z.object({
    projectId: z.string().min(1),
    undoRef: z.string().min(1),
  }),
})

export const canvasBatchOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('add_node'),
    nodeType: z.string().min(1),
    placement: canvasNodePlacementSchema,
    data: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({
    kind: z.literal('duplicate_node'),
    nodeId: z.string().min(1),
    placement: canvasNodePlacementSchema,
  }).strict(),
  z.object({
    kind: z.literal('update_node'),
    nodeId: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  }).strict(),
  z.object({ kind: z.literal('delete_nodes'), nodeIds: z.array(z.string().min(1)).min(1).max(50) }).strict(),
  z.object({
    kind: z.literal('connect_nodes'),
    sourceNodeId: z.string().min(1),
    targetNodeId: z.string().min(1),
  }).strict(),
  z.object({ kind: z.literal('disconnect_edge'), edgeId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('group_nodes'), nodeIds: z.array(z.string().min(1)).min(2).max(50) }).strict(),
  z.object({ kind: z.literal('select_node'), nodeId: z.string().min(1).nullable() }).strict(),
])
export type CanvasBatchOperation = z.infer<typeof canvasBatchOperationSchema>

export const planCanvasBatchQuerySchema = z.object({
  name: z.literal('plan_canvas_batch'),
  input: z.object({
    projectId: z.string().min(1),
    operations: z.array(canvasBatchOperationSchema).min(1).max(20),
  }).strict(),
})

export const previewCanvasBatchQuerySchema = z.object({
  name: z.literal('preview_canvas_batch'),
  input: z.object({ planRef: z.string().min(1) }).strict(),
})

export const commitCanvasBatchCommandSchema = commandBaseSchema.extend({
  name: z.literal('commit_canvas_batch'),
  input: z.object({ planRef: z.string().min(1) }).strict(),
})

export const createVisibleGenerationTaskCommandSchema = commandBaseSchema.extend({
  name: z.literal('create_visible_generation_task'),
  input: z.object({
    prompt: z.string(),
    modelId: z.string().min(1),
    mediaType: z.enum(['image', 'video', 'audio']),
    options: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const cancelGenerationTaskCommandSchema = commandBaseSchema.extend({
  name: z.literal('cancel_generation_task'),
  input: z.object({
    taskId: z.string().min(1),
    reason: z.string().min(1).max(500),
  }),
})

export const selectToolboxToolCommandSchema = commandBaseSchema.extend({
  name: z.literal('select_toolbox_tool'),
  input: z.object({ toolId: z.enum(['cameraStage', 'imageMark']).nullable() }).strict(),
})

export const createCameraStageProjectCommandSchema = commandBaseSchema.extend({
  name: z.literal('create_camera_stage_project'),
  input: z.object({ name: z.string().trim().min(1).max(120), mode: z.enum(['simple', 'pro']).default('simple') }).strict(),
})

export const openCameraStageProjectCommandSchema = commandBaseSchema.extend({
  name: z.literal('open_camera_stage_project'),
  input: z.object({ projectId: z.string().min(1) }).strict(),
})

export const renameCameraStageProjectCommandSchema = commandBaseSchema.extend({
  name: z.literal('rename_camera_stage_project'),
  input: z.object({ projectId: z.string().min(1), name: z.string().trim().min(1).max(120) }).strict(),
})

export const deleteCameraStageProjectCommandSchema = commandBaseSchema.extend({
  name: z.literal('delete_camera_stage_project'),
  input: z.object({ projectId: z.string().min(1) }).strict(),
})

export const updateCameraStageObjectCommandSchema = commandBaseSchema.extend({
  name: z.literal('update_camera_stage_object'),
  input: z.object({ projectId: z.string().min(1), objectId: z.string().min(1), patch: z.record(z.string(), z.unknown()) }).strict(),
})

export const addCameraStageObjectCommandSchema = commandBaseSchema.extend({
  name: z.literal('add_camera_stage_object'),
  input: z.object({ projectId: z.string().min(1), objectType: z.enum(['primitive', 'character', 'camera']), primitiveKind: z.enum(['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus']).optional() }).strict(),
})

export const duplicateCameraStageObjectCommandSchema = commandBaseSchema.extend({
  name: z.literal('duplicate_camera_stage_object'),
  input: z.object({ projectId: z.string().min(1), objectId: z.string().min(1) }).strict(),
})

export const deleteCameraStageObjectCommandSchema = commandBaseSchema.extend({
  name: z.literal('delete_camera_stage_object'),
  input: z.object({ projectId: z.string().min(1), objectId: z.string().min(1) }).strict(),
})

export const addCameraStageShotCommandSchema = commandBaseSchema.extend({
  name: z.literal('add_camera_stage_shot'),
  input: z.object({ projectId: z.string().min(1), name: z.string().trim().min(1).max(120), cameraId: z.string().min(1).nullable().default(null) }).strict(),
})

export const updateCameraStageShotCommandSchema = commandBaseSchema.extend({
  name: z.literal('update_camera_stage_shot'),
  input: z.object({ projectId: z.string().min(1), shotId: z.string().min(1), patch: z.object({ name: z.string().trim().min(1).max(120).optional(), hold: z.number().min(0).max(3_600).optional(), transitionDuration: z.number().min(0).max(3_600).optional(), continuity: z.enum(['stop', 'smooth']).optional(), cameraId: z.string().min(1).nullable().optional() }).strict() }).strict(),
})

export const createImageEditPreviewCommandSchema = commandBaseSchema.extend({
  name: z.literal('create_image_edit_preview'),
  input: z.object({ assetId: z.string().min(1), operations: z.array(z.record(z.string(), z.unknown())).min(1).max(32) }).strict(),
})

export const commitImageEditCommandSchema = commandBaseSchema.extend({
  name: z.literal('commit_image_edit'),
  input: z.object({ previewRef: z.string().min(1), displayName: z.string().trim().max(200).optional() }).strict(),
})

export const selectAssetCommandSchema = commandBaseSchema.extend({
  name: z.literal('select_asset'),
  input: z.object({ assetId: z.string().min(1).nullable() }).strict(),
})

export const setAssetTagsCommandSchema = commandBaseSchema.extend({
  name: z.literal('set_asset_tags'),
  input: z.object({ assetId: z.string().min(1), tags: z.array(z.string().trim().min(1).max(80)).max(32) }).strict(),
})

export const addAssetToLibraryCommandSchema = commandBaseSchema.extend({
  name: z.literal('add_asset_to_library'),
  input: z.object({ libraryId: z.string().min(1), assetId: z.string().min(1) }).strict(),
})

export const removeAssetFromLibraryCommandSchema = commandBaseSchema.extend({
  name: z.literal('remove_asset_from_library'),
  input: z.object({ libraryId: z.string().min(1), assetId: z.string().min(1) }).strict(),
})

export const deleteAssetCommandSchema = commandBaseSchema.extend({
  name: z.literal('delete_asset'),
  input: z.object({ assetId: z.string().min(1) }).strict(),
})

export const hostCommandSchema = z.discriminatedUnion('name', [
  switchWorkspaceCommandSchema,
  openCanvasProjectCommandSchema,
  createCanvasProjectCommandSchema,
  closeCanvasProjectCommandSchema,
  renameCanvasProjectCommandSchema,
  deleteCanvasProjectCommandSchema,
  addCanvasNodeCommandSchema,
  addAssetToCanvasCommandSchema,
  duplicateCanvasNodeCommandSchema,
  updateCanvasNodeCommandSchema,
  deleteCanvasNodesCommandSchema,
  selectCanvasNodeCommandSchema,
  groupCanvasNodesCommandSchema,
  connectCanvasNodesCommandSchema,
  disconnectCanvasEdgeCommandSchema,
  focusCanvasNodeCommandSchema,
  undoCanvasChangeCommandSchema,
  commitCanvasBatchCommandSchema,
  createVisibleGenerationTaskCommandSchema,
  cancelGenerationTaskCommandSchema,
  selectToolboxToolCommandSchema,
  createCameraStageProjectCommandSchema,
  openCameraStageProjectCommandSchema,
  renameCameraStageProjectCommandSchema,
  deleteCameraStageProjectCommandSchema,
  updateCameraStageObjectCommandSchema,
  addCameraStageObjectCommandSchema,
  duplicateCameraStageObjectCommandSchema,
  deleteCameraStageObjectCommandSchema,
  addCameraStageShotCommandSchema,
  updateCameraStageShotCommandSchema,
  createImageEditPreviewCommandSchema,
  commitImageEditCommandSchema,
  selectAssetCommandSchema,
  setAssetTagsCommandSchema,
  addAssetToLibraryCommandSchema,
  removeAssetFromLibraryCommandSchema,
  deleteAssetCommandSchema,
])
export type HostCommand = z.infer<typeof hostCommandSchema>
export type HostCommandName = HostCommand['name']

export const hostQuerySchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('get_host_context'), input: z.object({}) }),
  z.object({ name: z.literal('list_canvas_projects'), input: z.object({}) }),
  z.object({ name: z.literal('get_canvas_project'), input: z.object({ projectId: z.string().min(1) }) }),
  z.object({ name: z.literal('get_canvas_node'), input: z.object({ projectId: z.string().min(1), nodeId: z.string().min(1) }) }),
  planCanvasBatchQuerySchema,
  previewCanvasBatchQuerySchema,
  z.object({
    name: z.literal('search_canvas_node_types'),
    input: z.object({
      query: z.string().max(500).default(''),
      cursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(20).default(10),
    }),
  }),
  z.object({
    name: z.literal('get_canvas_node_schema'),
    input: z.object({ nodeType: z.string().min(1) }),
  }),
  z.object({
    name: z.literal('search_models'),
    input: z.object({
      query: z.string().max(500).default(''),
      mediaType: z.enum(['image', 'video', 'audio']).optional(),
      providerId: z.string().min(1).optional(),
      tags: z.array(z.string().min(1).max(100)).max(8).optional(),
      sortBy: z.enum(['registry', 'recommended', 'lowest_estimated_price']).optional(),
      cursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(50).default(32),
    }),
  }),
  z.object({ name: z.literal('get_model_schema'), input: z.object({ modelId: z.string().min(1) }) }),
  z.object({
    name: z.literal('prepare_generation_task'),
    input: z.object({
      modelId: z.string().min(1),
      prompt: z.string().max(32 * 1024),
      mediaType: z.enum(['image', 'video', 'audio']),
      options: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  z.object({ name: z.literal('get_generation_task'), input: z.object({ taskId: z.string().min(1) }) }),
  z.object({ name: z.literal('list_toolbox_tools'), input: z.object({}) }),
  z.object({ name: z.literal('get_toolbox_state'), input: z.object({}) }),
  z.object({ name: z.literal('list_camera_stage_projects'), input: z.object({}) }),
  z.object({ name: z.literal('get_camera_stage_project'), input: z.object({ projectId: z.string().min(1) }) }),
  z.object({ name: z.literal('list_storyboard_projects'), input: z.object({}) }),
  z.object({ name: z.literal('get_storyboard_project'), input: z.object({ projectId: z.string().min(1) }) }),
  z.object({ name: z.literal('query_assets'), input: z.object({ mediaType: z.enum(['image', 'video', 'audio']).optional(), libraryId: z.string().min(1).optional(), tag: z.string().min(1).optional(), keyword: z.string().max(200).optional(), page: z.number().int().min(1).max(1000).default(1), pageSize: z.number().int().min(1).max(50).default(20), sort: z.enum(['created', 'recent']).default('created') }).strict() }),
  z.object({ name: z.literal('get_asset'), input: z.object({ assetId: z.string().min(1) }) }),
  z.object({ name: z.literal('list_asset_libraries'), input: z.object({}) }),
  z.object({ name: z.literal('list_asset_tags'), input: z.object({}) }),
])
export type HostQuery = z.infer<typeof hostQuerySchema>
export type HostQueryName = HostQuery['name']

export const hostErrorCodeSchema = z.enum([
  'ABORTED',
  'COMMAND_NOT_READY',
  'COMMAND_REJECTED',
  'CONFLICT',
  'DEADLINE_EXCEEDED',
  'DUPLICATE_CALL',
  'INVALID_INPUT',
  'NOT_FOUND',
  'PROJECT_NOT_FOUND',
  'RENDERER_RELOADED',
  'STALE_CONTEXT',
  'UNKNOWN_CALL',
  'UNKNOWN_COMMAND',
])
export type HostErrorCode = z.infer<typeof hostErrorCodeSchema>

export const hostCommandResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    data: z.record(z.string(), z.unknown()),
    resultingRevision: z.number().int().nonnegative(),
    resultingScopeRevisions: hostScopeRevisionsSchema,
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: hostErrorCodeSchema,
      message: z.string().min(1),
      recoverable: z.boolean(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
])
export type HostCommandResult = z.infer<typeof hostCommandResultSchema>

export const frontendToolOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('command'), command: hostCommandSchema }),
  z.object({ kind: z.literal('query'), query: hostQuerySchema }),
  z.object({ kind: z.literal('capability'), capability: applicationCapabilityInvocationSchema }),
])
export type FrontendToolOperation = z.infer<typeof frontendToolOperationSchema>

export const frontendToolRequestSchema = z.object({
  schemaVersion: z.literal(AGENT_CONTRACT_VERSION),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  callId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  deadline: z.number().int().positive(),
  operation: frontendToolOperationSchema,
})
export type FrontendToolRequest = z.infer<typeof frontendToolRequestSchema>

export const frontendToolAcknowledgementSchema = z.object({
  schemaVersion: z.literal(AGENT_CONTRACT_VERSION), callId: z.string().min(1),
  rendererSessionId: z.string().min(1),
  acknowledgedAt: z.string().datetime(),
})
export type FrontendToolAcknowledgement = z.infer<typeof frontendToolAcknowledgementSchema>

export const frontendToolResultSchema = z.object({
  schemaVersion: z.literal(AGENT_CONTRACT_VERSION),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  callId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  rendererSessionId: z.string().min(1),
  completedAt: z.string().datetime(),
  result: hostCommandResultSchema,
})
export type FrontendToolResult = z.infer<typeof frontendToolResultSchema>

export const frontendToolCancelSchema = z.object({ callId: z.string().min(1), reason: z.string().min(1) })
export type FrontendToolCancel = z.infer<typeof frontendToolCancelSchema>

export function getFrontendToolOperationName(operation: FrontendToolOperation): string {
  if (operation.kind === 'command') return operation.command.name
  if (operation.kind === 'query') return operation.query.name
  return operation.capability.id
}
