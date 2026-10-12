import { z } from 'zod'

const mediaType = z.enum(['image', 'video', 'audio'])
export const persistedPromptDocumentSchema = z.looseObject({ version: z.literal(1), type: z.literal('doc'),
  content: z.array(z.looseObject({ type: z.literal('paragraph'), content: z.array(z.discriminatedUnion('type', [
    z.looseObject({ type: z.literal('text'), text: z.string() }),
    z.looseObject({ type: z.literal('hardBreak') }),
    z.looseObject({ type: z.literal('mediaReference'), attrs: z.looseObject({ resourceId: z.string(), mediaType, fallbackLabel: z.string(), sourceNodeId: z.string().optional() }) }),
    z.looseObject({ type: z.literal('templateVariable'), attrs: z.looseObject({ key: z.string(), fallbackLabel: z.string() }) }),
  ])).optional() })),
})

/** Stable common fields participate in fingerprints; model/tool extension fields stay open. */
export const persistedCanvasNodeDataSchema = z.looseObject({
  displayName: z.string().optional(), prompt: z.string().optional(), systemPrompt: z.string().optional(),
  promptDocument: persistedPromptDocumentSchema.optional(), systemPromptDocument: persistedPromptDocumentSchema.optional(),
  promptMediaBindings: z.array(z.looseObject({ resourceId: z.string(), mediaType, dataUrl: z.string().optional(), filePath: z.string().optional() })).optional(),
  providerId: z.string().optional(), modelId: z.string().optional(), params: z.record(z.string(), z.unknown()).optional(),
  mediaInputs: z.record(z.string(), z.array(z.string())).optional(), content: z.string().optional(),
  imageUrl: z.string().nullable().optional(), videoUrl: z.string().nullable().optional(), audioUrl: z.string().nullable().optional(),
  previewImageUrl: z.string().nullable().optional(), sourceFileName: z.string().nullable().optional(),
  aspectRatio: z.string().optional(), durationSec: z.number().nullable().optional(), hasAudio: z.boolean().optional(),
  isSizeManuallyAdjusted: z.boolean().optional(), projectId: z.string().nullable().optional(), selectedTimeSec: z.number().optional(),
  serverTaskId: z.string().nullable().optional(), serverTaskModelId: z.string().nullable().optional(),
  generationOutputCommitId: z.string().optional(), fixedResult: z.boolean().optional(), lastOutput: z.string().optional(),
  lastOutputFingerprint: z.string().optional(), lastOutputRevision: z.number().optional(), lastExecutionStatus: z.enum(['success', 'failed']).optional(),
  label: z.string().optional(), memberOrder: z.array(z.string()).optional(), coverMemberId: z.string().nullable().optional(),
  bindings: z.array(z.looseObject({ id: z.string(), targetNodeId: z.string(), targetPortByKind: z.record(z.string(), z.string()), excludedMemberIds: z.array(z.string()) })).optional(),
  imageEditSession: z.looseObject({ kind: z.literal('image-edit-v3'), sourceUrl: z.string(), documentRef: z.string(),
    revision: z.number().int().nonnegative(), previewRef: z.string().nullable() }).optional(),
})

const vector = z.looseObject({ x: z.number(), y: z.number(), z: z.number() })
export const persistedStageSettingsSchema = z.looseObject({
  ground: z.looseObject({ color: z.string(), pattern: z.enum(['none', 'grid', 'checker']), density: z.number(),
    gridLineColor: z.string(), gridLineThickness: z.number(), checkerLightColor: z.string(), checkerDarkColor: z.string() }).partial().optional(),
  sky: z.looseObject({ color: z.string(), environmentImageUrl: z.string().nullable() }).partial().optional(),
  sunlight: z.looseObject({ enabled: z.boolean(), intensity: z.number(), timeOfDay: z.number() }).partial().optional(),
  fog: z.looseObject({ enabled: z.boolean(), distance: z.number() }).partial().optional(),
  render: z.looseObject({ style: z.enum(['beauty', 'depth', 'lineart', 'normal', 'silhouette']) }).partial().optional(),
  display: z.looseObject({ showNameLabels: z.boolean(), nameLabel: z.looseObject({
    textColor: z.string(), backgroundColor: z.string(), backgroundOpacity: z.number(), followObjectColor: z.boolean(),
    scale: z.number(), offset: vector, shadowColor: z.string(), shadowOpacity: z.number(), shadowBlur: z.number(),
    shadowDistance: z.number(), shadowAngle: z.number(),
  }).partial() }).partial().optional(),
})
