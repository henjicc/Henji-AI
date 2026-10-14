import { z } from 'zod'
import { recordingMovieRecipeSchema } from '../../../screenRecording/movie'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
const documentRef = z.object({ kind: z.literal('video_edit.document'), id: z.string().min(1) }).strict()
const sequenceRef = z.object({ kind: z.literal('video_edit.sequence'), id: z.string().min(1) }).strict()
export const generateRecordingMovieCapability = defineApplicationCapability({
  id: 'generate_screen_recording_movie', version: 1, domain: 'screen_recording', title: '生成录制成片',
  description: '把已停止或恢复的录制会话生成到指定剪辑文档。默认生成新横版序列，可同时选择竖版和方版；sequenceRef 只接受该文档内未锁定的空序列作为首个输出，其余版本新建。配方控制剪停顿、语气词、等待加速、注意力推近、光标、字幕、步骤标题、章节、摄像头、画框及响度。保留原片与暂停空档，失误只剪人工 accepted 候选；隐私打码仅对 privacy.candidates 中 accepted 的候选默认启用，pending/rejected 不生成；使用已有理解结果，没有时本地免费分析、不转写不付费。所有时间线元素可编辑，整批生成可在目标剪辑一步撤销。字幕需要已有文字稿，可先 understand_screen_recording 开启转写。camera person 使用本地人物模型，可能需要先下载；circle 无需模型。返回序列稳定引用供读取、修改和导出。不切页。需要 screen_recording:read 与 video_edit:write。',
  aliases: ['生成成片', '录屏自动剪辑', '录屏教程', 'recording movie'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write',
  idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: true, requiredScopes: [], concurrencyKey: 'video_edit',
  inputSchema: z.object({ sessionRef: z.object({ kind: z.literal('screen_recording.session'), id: z.string().uuid() }).strict(), documentRef, sequenceRef: sequenceRef.optional(), recipe: recordingMovieRecipeSchema.default(recordingMovieRecipeSchema.parse({})) }).strict(),
  outputSchema: z.object({ documentRef, resultRef: sequenceRef, sequenceRefs: z.array(sequenceRef).min(1), warnings: z.array(z.string()), verified: z.boolean() }).strict(),
  acceptsRefs: ['screen_recording.session', 'video_edit.document', 'video_edit.sequence'], producesRefs: ['video_edit.sequence'],
  resolveOperationTargets: input => [input.sessionRef, input.documentRef, ...(input.sequenceRef ? [input.sequenceRef] : [])],
  resolveOperationWriteTargets: input => [input.documentRef], resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  control: capabilityControl('execute', ['video_edit.document', 'video_edit.sequence'], { cancelable: true }),
  resolveObservedEffects: (_input, output) => [{ effect: 'execute', entityTypes: ['video_edit.document', 'video_edit.sequence'], propertyIds: [], targetRefs: [output.documentRef, ...output.sequenceRefs], count: output.sequenceRefs.length, verified: output.verified, evidence: output.verified ? ['已保存并回读全部成片序列。'] : [] }],
  summarize: output => `已生成 ${output.sequenceRefs.length} 个可编辑成片序列。${output.warnings.join(' ')}`,
})
