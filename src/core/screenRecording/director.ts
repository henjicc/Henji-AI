import { z } from 'zod'
import { recordingScriptSchema, type RecordingScriptCapture } from './script'

export const recordingVoiceSchema = z.object({
  modelId: z.string().min(1),
  options: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()])).default({}),
}).strict()
export const recordingDirectorSchema = z.object({
  goal: z.string().trim().min(1).max(2000),
  narration: z.array(z.object({ stepId: z.string().min(1), text: z.string().trim().min(1).max(2000), picture: z.string().trim().min(1).max(1000) }).strict()).min(1).max(40),
  voice: recordingVoiceSchema,
  confirmed: z.boolean(),
}).strict()
/** Owned receipts: paths are internal media references, not editable plan properties. */
export const recordingDirectorRunSchema = z.object({
  recordingId: z.string().uuid().optional(),
  movie: z.object({ documentId: z.string(), state: z.enum(['preparing', 'completed']), sequenceIds: z.array(z.string()) }).strict().optional(),
  takes: z.array(z.object({ stepId: z.string(), identity: z.string(), taskId: z.string().optional(), path: z.string().optional(), durationUs: z.number().int().positive().optional() }).strict()).max(40).default([]),
  redubs: z.array(z.object({ clipId: z.string(), documentId: z.string(), identity: z.string(), taskId: z.string().optional(), path: z.string().optional(), durationUs: z.number().int().positive().optional() }).strict()).max(1000).optional(),
}).strict()
export type RecordingDirector = z.infer<typeof recordingDirectorSchema>
export type RecordingVoice = z.infer<typeof recordingVoiceSchema>
export const recordingDirectorPlanSchema = z.object({ director: recordingDirectorSchema, operationScript: recordingScriptSchema }).strict().superRefine((value, ctx) => {
  const steps = value.operationScript.steps
  if (steps.length !== value.director.narration.length || steps.some((step, i) => step.id !== value.director.narration[i]?.stepId || step.blockedReason || !step.operations.length)) {
    ctx.addIssue({ code: 'custom', message: '每一步须有可执行操作、旁白和预计画面，旁白顺序必须与步骤一致。' })
  }
  if (value.director.narration.reduce((n, v) => n + v.text.length, 0) > 20000) ctx.addIssue({ code: 'custom', message: '一次教程旁白最多两万字，请拆成多次录制。' })
})

/** Confirmation describes this exact plan; an edit cannot silently reuse an older consent. */
export function directorPlanIdentity(plan: z.infer<typeof recordingDirectorPlanSchema>): string {
  return JSON.stringify({ operationScript: plan.operationScript, director: { ...plan.director, confirmed: false } })
}

export function assertDirectorTargets(plan: z.infer<typeof recordingDirectorPlanSchema>, capture: RecordingScriptCapture): void {
  for (const step of plan.operationScript.steps) for (const operation of step.operations) {
    if (operation.target.kind === 'settings.registry') continue
    const [documentId, localId, extra] = operation.target.id.split(':')
    const baseline = capture.baselines.find(v => v.documentId === documentId)
    if (extra || !localId || !baseline || !baseline.content.sequences.some(sequence => operation.target.kind === 'video_edit.sequence' ? sequence.id === localId : sequence.clips.some(clip => clip.id === localId))) throw new Error('导演脚本目标不在已保存的演示快照中，请重新规划。')
  }
}
