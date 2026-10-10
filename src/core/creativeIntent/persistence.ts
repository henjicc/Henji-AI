import { z } from 'zod'
import { motionDraftSchema, resourceRefSchema, refKey, type MotionDraft } from './contracts'
import { explanationSessionSchema } from './schema'
import { creativeIntentPageSchema } from './pages'
import { candidateIdentitySchema } from './contracts'
import { videoEditClipCurvesSchema } from '../videoEdit/keyframes'
import { motionIntentSchema } from './recipe'

/** Resource IDs are opaque; only this directory carries relocatable file locations. */
export const creativeIntentResourceSchema = resourceRefSchema.extend({
  path: z.string().min(1), kind: z.enum(['page', 'candidate', 'recipe', 'audio', 'visual']),
  sourceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
}).strict()
export type StoredCreativeIntentResource = z.infer<typeof creativeIntentResourceSchema>
export const storedMotionCandidateSchema = z.object({
  version: z.literal(1), id: z.string().min(1), label: z.string(), identity: candidateIdentitySchema,
  motions: z.array(z.object({ takeId: z.string().min(1), curves: videoEditClipCurvesSchema,
    range: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]), keyCount: z.number().int().nonnegative(),
    maxErrors: z.partialRecord(z.enum(['x', 'y', 'scale', 'rotation', 'anchorX', 'anchorY']), z.number().finite().nonnegative()),
  }).strict()),
}).strict()
/** Shared head leaves static drafts/sessions available for the later image adapter. */
export const creativeIntentsSchema = z.object({
  drafts: z.array(motionDraftSchema), sessions: z.array(explanationSessionSchema), resources: z.array(creativeIntentResourceSchema),
  motionOptions: z.array(z.object({ draftId: z.string().min(1), intent: motionIntentSchema.optional(), selectedTakeIds: z.array(z.string()).optional(), originalRef: resourceRefSchema.optional(), appliedBaseDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional() }).strict()).optional(),
}).strict().superRefine((value, ctx) => {
  const resources = new Map(value.resources.map(r => [r.resourceId, r]))
  if (resources.size !== value.resources.length || new Set([...value.drafts, ...value.sessions].map(d => d.id)).size !== value.drafts.length + value.sessions.length) ctx.addIssue({ code: 'custom', message: '草稿或资源身份重复' })
  const check = (ref: z.infer<typeof resourceRefSchema>): void => {
    const resource = resources.get(ref.resourceId)
    if (!resource || resource.digest !== ref.digest || resource.bytes !== ref.bytes) ctx.addIssue({ code: 'custom', message: '草稿资源目录缺失或摘要不符' })
  }
  for (const draft of value.drafts) for (const ref of [...draft.takes.flatMap(t => t.samplePages), ...draft.recipeRefs, ...draft.candidateRefs]) check(ref)
  for (const draft of value.drafts) for (const application of draft.applications) if (resources.get(application.candidateRef)?.kind !== 'candidate') ctx.addIssue({ code: 'custom', message: '应用记录的候选资源缺失' })
  for (const options of value.motionOptions ?? []) {
    if (!value.drafts.some(d => d.id === options.draftId)) ctx.addIssue({ code: 'custom', message: '整理选项引用未知草稿' })
    if (options.originalRef) check(options.originalRef)
  }
  for (const session of value.sessions) for (const ref of [...session.pages, ...session.visualEvidenceRefs.map(v => v.resourceRef), ...(session.audio ? [session.audio] : []), ...(session.submittedPlanRef ? [session.submittedPlanRef] : [])]) check(ref)
})
export type CreativeIntents = z.infer<typeof creativeIntentsSchema>

/** Current document plus both history directions are authoritative live roots; no age/quantity cutoff. */
export function creativeIntentLiveResources(heads: Iterable<CreativeIntents | undefined>): StoredCreativeIntentResource[] {
  const live = new Map<string, StoredCreativeIntentResource>()
  for (const head of heads) {
    if (!head) continue
    const ids = new Set([...head.drafts.flatMap(d => [...d.takes.flatMap(t => t.samplePages), ...d.candidateRefs, ...d.recipeRefs]),
      ...head.sessions.flatMap(s => [...s.pages, ...s.visualEvidenceRefs.map(v => v.resourceRef), ...(s.audio ? [s.audio] : []), ...(s.submittedPlanRef ? [s.submittedPlanRef] : [])]), ...(head.motionOptions ?? []).flatMap(o => o.originalRef ? [o.originalRef] : [])].map(r => r.resourceId))
    for (const draft of head.drafts) for (const application of draft.applications) ids.add(application.candidateRef)
    for (const r of head.resources) if (ids.has(r.resourceId)) live.set(r.resourceId, r)
  }
  return [...live.values()]
}

export function assertDraftPage(page: z.infer<typeof creativeIntentPageSchema>, draft: MotionDraft): void {
  if (refKey(page.ownerRef) !== refKey(draft.ownerRef) || page.kind !== 'samples') throw new Error('原稿页归属或类型不符，请恢复原文件。')
}
