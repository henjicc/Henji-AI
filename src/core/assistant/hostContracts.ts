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
  schemaVersion: z.literal(AGENT_CONTRACT_VERSION),
  rendererSessionId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  scopeRevisions: hostScopeRevisionsSchema,
  catalogRevision: z.number().int().nonnegative().optional(),
  surface: z.object({
    id: z.string().min(1).max(120),
    kind: z.enum(['workspace', 'tool', 'settings', 'overlay']),
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
  capturedAt: z.string().datetime(),
})
export type HostContextSnapshot = z.infer<typeof hostContextSnapshotSchema>

const legacyHostContextSnapshotSchema = hostContextSnapshotSchema
  .omit({ schemaVersion: true, availableCapabilities: true })
  .extend({
    schemaVersion: z.literal(LEGACY_AGENT_CONTRACT_VERSION),
    availableCommands: z.array(z.string().min(1)).optional(),
    availableQueries: z.array(z.string().min(1)).optional(),
  })

export function parseHostContextSnapshot(input: unknown): HostContextSnapshot {
  const current = hostContextSnapshotSchema.safeParse(input)
  if (current.success) return current.data
  const legacy = legacyHostContextSnapshotSchema.parse(input)
  const {
    availableCommands,
    availableQueries,
    ...snapshot
  } = legacy
  return hostContextSnapshotSchema.parse({
    ...snapshot,
    schemaVersion: AGENT_CONTRACT_VERSION,
    availableCapabilities: [...new Set([
      ...(availableCommands ?? []),
      ...(availableQueries ?? []),
    ])],
  })
}

export const hostErrorCodeSchema = z.enum([
  'ABORTED',
  'CAPABILITY_NOT_READY',
  'CAPABILITY_REJECTED',
  'CONFLICT',
  'DEADLINE_EXCEEDED',
  'DUPLICATE_CALL',
  'INVALID_INPUT',
  'NOT_FOUND',
  'PROJECT_NOT_FOUND',
  'RENDERER_RELOADED',
  'STALE_CONTEXT',
  'UNKNOWN_CALL',
  'UNKNOWN_CAPABILITY',
])
export type HostErrorCode = z.infer<typeof hostErrorCodeSchema>

export const applicationCapabilityResultSchema = z.discriminatedUnion('ok', [
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
export type ApplicationCapabilityResult = z.infer<typeof applicationCapabilityResultSchema>

export const frontendToolOperationSchema = z.object({
  kind: z.literal('capability'),
  capability: applicationCapabilityInvocationSchema,
}).strict()
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
  result: applicationCapabilityResultSchema,
})
export type FrontendToolResult = z.infer<typeof frontendToolResultSchema>

export const frontendToolCancelSchema = z.object({
  callId: z.string().min(1),
  reason: z.string().min(1),
})
export type FrontendToolCancel = z.infer<typeof frontendToolCancelSchema>

export function getFrontendToolOperationName(operation: FrontendToolOperation): string {
  return operation.capability.id
}
