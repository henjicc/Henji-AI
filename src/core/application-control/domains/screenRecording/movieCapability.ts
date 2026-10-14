import { z } from 'zod'
import { recordingMovieRecipeSchema } from '../../../screenRecording/movie'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
const documentRef = z.object({ kind: z.literal('video_edit.document'), id: z.string().min(1) }).strict()
const sequenceRef = z.object({ kind: z.literal('video_edit.sequence'), id: z.string().min(1) }).strict()
export const generateRecordingMovieCapability = defineApplicationCapability({
  id: 'generate_screen_recording_movie', version: 1, domain: 'screen_recording', title: '生成录制成片',
  description: '将已停止或恢复的会话生成到指定剪辑：默认新横版，可同时选竖版/方版。sequenceRef 须为目标文档内未锁定的空序列，仅接首个版本。recipe 控制剪停顿/语气词、等待加速、推近、光标、字幕、标题、章节、摄像头、画框与响度。保留原片及暂停空档；失误仅剪 accepted 候选，隐私仅生成 accepted 打码。复用理解结果，缺失时免费本地分析、不转写；字幕须已有文字稿，可先 understand_screen_recording 开启转写。camera person 可能须下载本地人物模型，circle 无需模型。返回可读改/导出的序列引用，整批一步撤销，不切页。需要录制读取与剪辑写入权限。',
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
