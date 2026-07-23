import { z } from 'zod'

export const AGENT_CONTRACT_VERSION = 'agent-contract/v1' as const

export const hostScopeSchema = z.enum([
  'navigation',
  'generation',
  'canvas',
  'toolbox',
  'assets',
])
export type HostScope = z.infer<typeof hostScopeSchema>

export const hostScopeRevisionsSchema = z.object({
  navigation: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
  canvas: z.number().int().nonnegative(),
  toolbox: z.number().int().nonnegative(),
  assets: z.number().int().nonnegative(),
})
export type HostScopeRevisions = z.infer<typeof hostScopeRevisionsSchema>

export const hostContextSnapshotSchema = z.object({
  schemaVersion: z.literal(AGENT_CONTRACT_VERSION),
  rendererSessionId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  scopeRevisions: hostScopeRevisionsSchema,
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
  }),
  assets: z.object({
    view: z.enum(['closed', 'floating', 'workspace']),
    selectedAssetId: z.string().min(1).nullable(),
  }),
  uiReady: z.boolean(),
  availableCommands: z.array(z.string().min(1)),
  availableQueries: z.array(z.string().min(1)),
  capturedAt: z.string().datetime(),
})
export type HostContextSnapshot = z.infer<typeof hostContextSnapshotSchema>

const expectedRevisionsSchema = hostScopeRevisionsSchema.partial()
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

export const addCanvasNodeCommandSchema = commandBaseSchema.extend({
  name: z.literal('add_canvas_node'),
  input: z.object({
    projectId: z.string().min(1),
    nodeType: z.string().min(1),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
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

export const hostCommandSchema = z.discriminatedUnion('name', [
  switchWorkspaceCommandSchema,
  openCanvasProjectCommandSchema,
  addCanvasNodeCommandSchema,
  createVisibleGenerationTaskCommandSchema,
  cancelGenerationTaskCommandSchema,
])
export type HostCommand = z.infer<typeof hostCommandSchema>
export type HostCommandName = HostCommand['name']

export const hostQuerySchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('get_host_context'), input: z.object({}) }),
  z.object({ name: z.literal('list_canvas_projects'), input: z.object({}) }),
  z.object({
    name: z.literal('search_models'),
    input: z.object({
      query: z.string().max(500).default(''),
      mediaType: z.enum(['image', 'video', 'audio']).optional(),
      providerId: z.string().min(1).optional(),
      cursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(20).default(10),
    }),
  }),
  z.object({ name: z.literal('get_model_schema'), input: z.object({ modelId: z.string().min(1) }) }),
  z.object({ name: z.literal('get_generation_task'), input: z.object({ taskId: z.string().min(1) }) }),
])
export type HostQuery = z.infer<typeof hostQuerySchema>
export type HostQueryName = HostQuery['name']

export const hostErrorCodeSchema = z.enum([
  'ABORTED',
  'COMMAND_NOT_READY',
  'COMMAND_REJECTED',
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
  schemaVersion: z.literal(AGENT_CONTRACT_VERSION),
  callId: z.string().min(1),
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

export const frontendToolCancelSchema = z.object({
  callId: z.string().min(1),
  reason: z.string().min(1),
})
export type FrontendToolCancel = z.infer<typeof frontendToolCancelSchema>

export function getFrontendToolOperationName(operation: FrontendToolOperation): string {
  return operation.kind === 'command' ? operation.command.name : operation.query.name
}
