import { z } from 'zod'

export const APPLICATION_HOST_CONTRACT_VERSION = 'application-host/v1' as const

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
  schemaVersion: z.literal(APPLICATION_HOST_CONTRACT_VERSION),
  rendererEpoch: z.string().min(1),
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
    activeToolId: z.enum(['audioEdit', 'cameraStage', 'imageMark']).nullable(),
  }),
  project: z.object({
    id: z.string().min(1).nullable(),
    selectedNodeId: z.string().min(1).nullable(),
    selectedNodeIsReference: z.boolean().optional(),
    selectedNodeSummary: z.object({
      type: z.string().max(120), name: z.string().max(120), isGenerating: z.boolean(),
    }).strict().optional(),
    viewportNodePosition: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(),
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
/** 失败分支：分类器与各域的失败钩子只允许产出这一支，不允许把成功结果混进错误路径。 */
export type ApplicationCapabilityFailure = Extract<ApplicationCapabilityResult, { ok: false }>
