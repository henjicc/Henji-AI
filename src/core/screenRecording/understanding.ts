import { z } from 'zod'

const time = z.number().int().nonnegative().safe()
export const recordingRangeSchema = z.object({ startUs: time, endUs: time }).strict().refine(v => v.endUs > v.startUs, '结束时间必须晚于开始时间')
const range = { startUs: time, endUs: time }
export const recordingTranscriptSchema = z.object({
  id: z.string().min(1), ...range, text: z.string().max(20000), granularity: z.enum(['word', 'segment']),
  audioDocumentId: z.string().min(1), mediaId: z.string().min(1),
  protected: z.boolean().optional(),
}).strict().refine(v => v.endUs > v.startUs)
export const recordingStepSchema = z.object({
  id: z.string().min(1), ...range, title: z.string().min(1).max(120), description: z.string().max(4000),
  signal: z.enum(['capability', 'window', 'click', 'scene', 'speech', 'marker', 'start']),
  eventIds: z.array(z.string()).max(100),
}).strict().refine(v => v.endUs > v.startUs)
export const recordingCandidateSchema = z.object({
  id: z.string().min(1), ...range, kind: z.enum(['wait', 'pause', 'filler', 'mistake']),
  reason: z.string().min(1).max(1000), status: z.enum(['pending', 'accepted', 'rejected']),
  eventIds: z.array(z.string()).max(100),
}).strict().refine(v => v.endUs > v.startUs)
export const recordingUnderstandingSchema = z.object({
  transcript: z.array(recordingTranscriptSchema).max(100000),
  steps: z.array(recordingStepSchema).max(20000),
  candidates: z.array(recordingCandidateSchema).max(100000),
  chapters: z.array(z.object({ id: z.string().min(1), title: z.string().min(1).max(120), stepIds: z.array(z.string()).min(1) }).strict()).max(20000),
  warnings: z.array(z.string().max(1000)).max(100),
}).strict().superRefine((value, ctx) => {
  for (const key of ['transcript', 'steps', 'candidates', 'chapters'] as const) {
    if (new Set(value[key].map(v => v.id)).size !== value[key].length) ctx.addIssue({ code: 'custom', path: [key], message: '标识不可重复' })
  }
  value.steps.forEach((step, i) => { if (i && step.startUs < value.steps[i - 1].endUs) ctx.addIssue({ code: 'custom', path: ['steps', i], message: '步骤必须按时间排序且不重叠' }) })
  const ids = new Set(value.steps.map(v => v.id))
  const assigned = new Set<string>()
  for (const chapter of value.chapters) for (const id of chapter.stepIds) {
    if (!ids.has(id) || assigned.has(id)) ctx.addIssue({ code: 'custom', path: ['chapters'], message: '章节必须引用存在且不重复的步骤' })
    assigned.add(id)
  }
})
export type RecordingUnderstanding = z.infer<typeof recordingUnderstandingSchema>
export type RecordingRange = z.infer<typeof recordingRangeSchema>
export type RecordingTranscript = z.infer<typeof recordingTranscriptSchema>
export function emptyRecordingUnderstanding(): RecordingUnderstanding { return { transcript: [], steps: [], candidates: [], chapters: [], warnings: [] } }
