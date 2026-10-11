import { z } from 'zod'
import { applicationRefSchema, type ApplicationRef } from '../application-control/identifiers'
import { digestSchema, layoutConstraintSchema, refKey, type MotionDraft } from './contracts'
import { motionIntentSchema } from './recipe'
import type { DeixisResolution } from './deixis'

/** A model proposes intent, never pins, samples, commands or executable code. */
export const semanticIntentPlanSchema = z.object({
  draftDigest: digestSchema,
  actions: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('motion'), targetRef: applicationRefSchema, takeId: z.string().min(1), intent: motionIntentSchema }).strict(),
    z.object({ kind: z.literal('layout'), constraint: layoutConstraintSchema }).strict(),
    z.object({ kind: z.literal('slower'), targetRef: applicationRefSchema, takeId: z.string().min(1), factor: z.number().finite().gt(1) }).strict(),
  ])),
  protectedRefs: z.array(applicationRefSchema),
  questions: z.array(z.string().min(1)),
}).strict()
export type SemanticIntentPlan = z.infer<typeof semanticIntentPlanSchema>
export interface SemanticIntentReview {
  status: 'candidate' | 'confirmation_required' | 'local_fallback'
  plan?: SemanticIntentPlan
  questions: string[]
  protectedRefs: ApplicationRef[]
}

/** Local evidence is authoritative; a model cannot resolve ambiguity or remove a negation. */
export function reviewSemanticIntent(raw: unknown, draft: MotionDraft, resolutions: readonly DeixisResolution[]): SemanticIntentReview {
  const protectedRefs = [...new Map(resolutions.filter(r => r.negated).flatMap(r => r.mentions.flatMap(m => m.selected?.targetRefs ?? m.candidates.flatMap(c => c.targetRefs))).map(ref => [refKey(ref), ref])).values()]
  const questions = resolutions.flatMap(r => [...r.issues, ...r.mentions.flatMap(m => m.selected ? [] : m.issues.length ? m.issues : ['请确认讲解指向的对象和位置'])])
  if (resolutions.some(r => r.negated && !r.mentions.some(m => m.selected?.targetRefs.length))) questions.push('否定要求尚未明确保护对象，请先确认。')
  if (questions.length) return { status: 'confirmation_required', questions: [...new Set(questions)], protectedRefs }
  const parsed = semanticIntentPlanSchema.safeParse(raw)
  if (!parsed.success) return { status: 'local_fallback', questions: ['意图结果格式不正确，已拒绝；可使用本地整理。'], protectedRefs }
  const plan = parsed.data
  const targets = new Set(draft.targets.map(t => refKey(t.ref)))
  if (plan.draftDigest !== draft.sourceDigest || plan.protectedRefs.some(ref => !targets.has(refKey(ref)))) return { status: 'local_fallback', questions: ['原稿已变化或结果引用未知对象，请重新整理。'], protectedRefs }
  for (const ref of plan.protectedRefs) if (!protectedRefs.some(p => refKey(p) === refKey(ref))) protectedRefs.push(ref)
  const touched = new Set<string>()
  for (const action of plan.actions) {
    const refs = action.kind === 'layout' ? action.constraint.targets : [action.targetRef]
    if (refs.some(ref => !targets.has(refKey(ref)) || protectedRefs.some(p => refKey(p) === refKey(ref)))) return { status: 'confirmation_required', questions: ['计划触及未知或“别动它”保护的对象，请确认范围。'], protectedRefs }
    if (action.kind === 'layout') {
      if (draft.mode !== 'static' || action.constraint.kind === 'align' && !targets.has(refKey(action.constraint.reference))) return { status: 'local_fallback', questions: ['布局目标或参考对象无效。'], protectedRefs }
    } else {
      const target = draft.targets.find(t => refKey(t.ref) === refKey(action.targetRef))!
      const take = draft.takes.find(t => t.id === action.takeId)
      if (draft.mode !== 'animated' || !take || take.intent !== 'demonstrate' || !take.timelineRange) return { status: 'confirmation_required', questions: ['请确认要修改的动作示范和作品时间区间。'], protectedRefs }
      if (action.kind === 'slower') return { status: 'confirmation_required', questions: ['慢一点需要确认新的作品结束时间；不会把讲话时长当作动画时长。'], protectedRefs }
      const property = ['spin', 'swing'].includes(action.intent.kind) ? 'rotationTurns' : ['pulse', 'scale_focus'].includes(action.intent.kind) ? 'scaleXY' : 'position'
      if (!target.editable.includes(property)) return { status: 'local_fallback', questions: ['意图修改了原稿未允许的属性。'], protectedRefs }
      const key = `${refKey(action.targetRef)}:${action.takeId}`
      if (touched.has(key)) return { status: 'confirmation_required', questions: ['同一示范有多个动作意图，请确认采用哪一个。'], protectedRefs }
      touched.add(key)
    }
  }
  if (plan.questions.length) return { status: 'confirmation_required', questions: plan.questions, protectedRefs }
  return { status: 'candidate', plan, questions: [], protectedRefs }
}

/** The host must use the existing authorized Pi/LLM port. This core never performs network I/O. */
export async function requestSemanticIntent(input: {
  draft: MotionDraft; resolutions: readonly DeixisResolution[]; lines: AsyncIterable<string>; signal?: AbortSignal
  authorize: () => Promise<boolean>
  propose: (lines: AsyncIterable<string>, signal?: AbortSignal) => Promise<unknown>
  local: (protectedRefs: readonly ApplicationRef[]) => Promise<void>
}): Promise<SemanticIntentReview> {
  input.signal?.throwIfAborted()
  if (!await input.authorize()) throw new Error('PERMISSION_DENIED:讲解文字与必要图片尚未获准发送。')
  input.signal?.throwIfAborted()
  const preflight = reviewSemanticIntent({ draftDigest: input.draft.sourceDigest, actions: [], protectedRefs: [], questions: [] }, input.draft, input.resolutions)
  if (preflight.status === 'confirmation_required') return preflight
  let result: SemanticIntentReview
  try { result = reviewSemanticIntent(await input.propose(input.lines, input.signal), input.draft, input.resolutions) }
  catch (error) {
    input.signal?.throwIfAborted()
    // An unknown model outcome is never retried (it may already have incurred usage).
    result = { status: 'local_fallback', questions: ['语义整理未完成，已保留原稿并回到本地整理。'], protectedRefs: preflight.protectedRefs }
    if (error instanceof Error && error.name === 'AbortError') throw error
  }
  input.signal?.throwIfAborted()
  if (result.status === 'local_fallback') await input.local(result.protectedRefs)
  return result
}
