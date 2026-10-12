import { z } from 'zod'

export const speechTimingsSchema = z.object({
  granularity: z.enum(['char', 'word', 'sentence']),
  items: z.array(z.object({ text: z.string(), startMs: z.number().finite().nonnegative(), endMs: z.number().finite().nonnegative(), confidence: z.number().min(0).max(1).optional() }).strict()
    .refine(item => item.endMs >= item.startMs, '时间戳结束时间早于开始时间。')),
}).strict()
export const generationOutputTimingsSchema = z.array(z.object({ outputIndex: z.number().int().nonnegative(), timings: speechTimingsSchema }).strict())
export type SpeechTimings = z.infer<typeof speechTimingsSchema>
export function readGenerationOutputTimings(metadata: unknown): z.infer<typeof generationOutputTimingsSchema> {
  if (!metadata || typeof metadata !== 'object' || !('outputTimings' in metadata)) return []
  return generationOutputTimingsSchema.parse(metadata.outputTimings)
}
