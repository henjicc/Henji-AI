import { z } from 'zod'

const frame = z.number().int().nonnegative()
export const audioEditFrameRateSchema = z.object({ numerator: z.number().int().positive(), denominator: z.number().int().positive() }).strict()
export const audioEditRangeSchema = z.object({ startFrame: frame, endFrame: frame }).strict().refine((range) => range.endFrame > range.startFrame, '结束位置必须晚于开始位置')
export const audioEditSettingsSchema = z.object({ silenceThresholdMs: z.number().min(100).max(10000), retainedSilenceMs: z.number().min(0).max(10000), noiseDb: z.number().min(-80).max(-10), trimEdges: z.boolean(), fillers: z.array(z.string().min(1).max(30)).max(100) }).strict().refine((value) => value.retainedSilenceMs < value.silenceThresholdMs, '保留时长必须小于检测时长')
export const audioEditProcessorChainSchema = z.array(z.object({ id: z.string().min(1), enabled: z.boolean(), parameters: z.record(z.string(), z.number().min(0).max(1)) }).strict()).max(20)
export const audioEditCutsSchema = z.array(z.object({ id: z.string().min(1), startFrame: frame, endFrame: frame, reason: z.enum(['silence', 'manual']), enabled: z.boolean(), mode: z.enum(['delete', 'mute']).optional() }).strict()).max(100000)
export const audioEditViewSettingsSchema = z.object({ textSize: z.number().int().min(14).max(36), sidePadding: z.number().int().min(16).max(240), timelineCaptions: z.boolean() }).strict()
const transcriptSchema = z.array(z.object({ id: z.string().min(1), text: z.string().max(20000), startFrame: frame, endFrame: frame, confidence: z.number().finite().optional(), included: z.boolean(), locked: z.boolean(), granularity: z.enum(['word', 'segment']), captionBreakAfter: z.boolean().optional() }).strict())
const suggestionsSchema = z.array(z.object({ id: z.string().min(1), kind: z.enum(['long_silence', 'filler', 'retake']), evidence: z.literal('audio').optional(), title: z.string(), detail: z.string(), startFrame: frame, endFrame: frame, blockIds: z.array(z.string()), confidence: z.enum(['high', 'medium', 'low']), status: z.enum(['pending', 'applied', 'dismissed']) }).strict())
export const audioEditProjectSchema = z.object({
  id: z.string().regex(/^[\w-]+$/), name: z.string().trim().min(1).max(200),
  source: z.object({ mediaType: z.enum(['audio', 'video']), sourcePath: z.string().min(1), audioPath: z.string().min(1), durationFrames: frame, sampleRate: z.number().int().positive().max(768000), channels: z.number().int().min(1).max(32),
    ownership: z.enum(['external', 'managed']).optional(), identity: z.object({ size: frame, mtimeMs: z.number().finite(), digest: z.string().regex(/^[a-f\d]{64}$/) }).strict().optional(),
    audioStreamIndex: frame.optional(), audioStartSeconds: z.number().finite().optional(),
    video: z.object({ frameRate: audioEditFrameRateSchema, width: frame, height: frame, startSeconds: z.number().finite(), durationSeconds: z.number().positive(), variableFrameRate: z.boolean() }).strict().optional(),
  }).strict(),
  referenceScript: z.string().max(200000), transcript: transcriptSchema,
  suggestions: suggestionsSchema,
  editBaseline: z.object({ kind: z.enum(['original', 'legacy']), transcript: transcriptSchema, suggestions: suggestionsSchema }).strict().optional(),
  cuts: audioEditCutsSchema.optional(),
  viewSettings: audioEditViewSettingsSchema.optional(),
  batchSettings: audioEditSettingsSchema.optional(), processorChain: audioEditProcessorChainSchema.optional(), xmlFrameRate: audioEditFrameRateSchema.optional(),
  vstEnabled: z.boolean(), selectedAsrModelId: z.string().optional(), createdAt: frame, updatedAt: frame, revision: frame,
}).strict().superRefine((project, context) => {
  for (const range of [...project.transcript, ...(project.editBaseline?.transcript ?? []), ...(project.cuts ?? [])]) {
    if (range.endFrame <= range.startFrame || range.endFrame > project.source.durationFrames) context.addIssue({ code: 'custom', message: '剪辑范围超出音频或时长为零' })
  }
  if (new Set((project.cuts ?? []).map((cut) => cut.id)).size !== (project.cuts ?? []).length) context.addIssue({ code: 'custom', message: '裁切引用重复' })
  if (new Set(project.transcript.map((block) => block.id)).size !== project.transcript.length) context.addIssue({ code: 'custom', message: '词块引用重复' })
})
