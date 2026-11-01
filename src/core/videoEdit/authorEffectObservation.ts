import { codeEditsSchema } from './codeEdits'
import { z } from 'zod'
import type { CodeAuthorFrameObservation } from './codeAuthorProgram'

export const authorResolvedEffectSchema = z.object({ key: z.string().optional(), id: z.string(), params: z.record(z.string(), z.union([z.number().finite(), z.string(), z.boolean()])), amount: z.number(), source: z.enum(['descriptor', 'look', 'pose.blur']), look: z.string().optional() }).strict()
export const authorElementEffectStateSchema = z.object({ key: z.string(), id: z.string(), name: z.string().optional(), codeValues: authorResolvedEffectSchema.shape.params, values: authorResolvedEffectSchema.shape.params, overridden: z.array(z.string()), added: z.boolean(), enabled: z.boolean(), missing: z.boolean() }).strict()
export const authorFrameEffectsSchema = z.object({ frame: z.number(), sequenceId: z.string(), clips: z.array(z.object({ clipId: z.string(), edits: codeEditsSchema.optional(), elements: z.array(z.object({ id: z.string(), kind: z.literal('adjust').optional(), clip: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).optional(), time: z.number(), effectStates: z.array(authorElementEffectStateSchema).optional(), edits: codeEditsSchema.optional(), effects: z.array(authorResolvedEffectSchema) }).strict()) }).strict()) }).strict()
export type AuthorFrameEffects = z.infer<typeof authorFrameEffectsSchema>
export function authorFrameEffects(value: CodeAuthorFrameObservation): AuthorFrameEffects {
  return { frame: value.frame, sequenceId: value.sequenceId, clips: value.clips.map(clip => ({ clipId: clip.clipId, ...(clip.edits ? { edits: clip.edits } : {}), elements: clip.elements.map(element => ({ id: element.id, ...(element.kind ? { kind: element.kind } : {}), ...(element.clip ? { clip: element.clip } : {}), time: element.effectsTime ?? 0, ...(element.effectStates ? { effectStates: element.effectStates } : {}), ...(element.edits ? { edits: element.edits } : {}), effects: element.effects ?? [] })) })) }
}
