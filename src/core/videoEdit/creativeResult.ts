import { z } from 'zod'

const id = z.string().min(1).max(500)
/** Optional completion pins are fixed by the first authoritative read and rechecked before commit. */
export const videoEditCreativeSourceRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('generation.result'), id, outputIndex: z.number().int().nonnegative().max(199) }).strict(),
  z.object({ kind: z.literal('canvas.node'), projectId: id, nodeId: id, completionId: id.optional(), outputId: id.optional() }).strict(),
  z.object({ kind: z.literal('image_edit.document'), documentRef: id, revision: z.number().int().nonnegative(), sourceFingerprint: z.string().min(1).max(500).optional() }).strict(),
  z.object({ kind: z.literal('audio_edit.project'), projectId: id, includeProcessing: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('camera_stage.render_task'), taskRef: id }).strict(),
])
export type VideoEditCreativeSourceRequest = z.infer<typeof videoEditCreativeSourceRequestSchema>
export const videoEditResultPlacementSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('add'), frame: z.number().int().nonnegative().max(108000), trackId: id, duration: z.number().int().positive().max(108000).optional() }).strict(),
  z.object({ mode: z.literal('replace'), clipId: id }).strict(),
])
export type VideoEditResultPlacement = z.infer<typeof videoEditResultPlacementSchema>
