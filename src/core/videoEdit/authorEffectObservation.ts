import { z } from 'zod'
import type { CodeAuthorFrameObservation } from './codeAuthorProgram'

export const authorResolvedEffectSchema = z.object({ id: z.string(), params: z.record(z.string(), z.union([z.number().finite(), z.string(), z.boolean()])), amount: z.number(), source: z.enum(['descriptor', 'look', 'pose.blur']), look: z.string().optional() }).strict()
export const authorFrameEffectsSchema = z.object({ frame: z.number(), sequenceId: z.string(), clips: z.array(z.object({ clipId: z.string(), elements: z.array(z.object({ id: z.string(), time: z.number(), effects: z.array(authorResolvedEffectSchema) }).strict()) }).strict()) }).strict()
export type AuthorFrameEffects = z.infer<typeof authorFrameEffectsSchema>
export function authorFrameEffects(value: CodeAuthorFrameObservation): AuthorFrameEffects {
  return { frame: value.frame, sequenceId: value.sequenceId, clips: value.clips.map(clip => ({ clipId: clip.clipId, elements: clip.elements.map(element => ({ id: element.id, time: element.effectsTime ?? 0, effects: element.effects ?? [] })) })) }
}
