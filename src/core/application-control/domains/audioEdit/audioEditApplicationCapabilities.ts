import { z } from 'zod'
import { applicationRefSchema, type ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { audioEditRangeSchema } from '../../../audioEdit/schema'
import { canvasDownloadDestinationSchema } from '../canvas/canvasExportApplicationCapabilities'

const projectRef = applicationRefSchema.extend({ kind: z.literal('audio_edit.project') }).strict()
export const audioEditOperationInput = z.object({ projectRef, range: audioEditRangeSchema.optional(), modelId: z.string().optional(), taskId: z.string().optional(), format: z.enum(['xml', 'wav']).optional(), includeProcessing: z.boolean().optional(), includeSrt: z.boolean().optional(), destination: canvasDownloadDestinationSchema.optional() }).strict()
const output = z.object({ resultRef: projectRef, message: z.string(), verified: z.boolean().optional(), count: z.number().nonnegative().optional(), shortenedMs: z.number().nonnegative().optional(), durationFrames: z.number().nonnegative().optional(), tasks: z.array(z.object({ requestId: z.string(), projectId: z.string(), kind: z.string(), state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']), progress: z.number().optional(), errorMessage: z.string().optional() })).optional() }).strict()
export const AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS = new Set(['reset_audio_edit', 'format_audio_edit_subtitles', 'quick_process_audio_edit', 'compress_audio_edit_silence', 'clean_audio_edit_fillers'])
export const AUDIO_EDIT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  ['reset_audio_edit', '撤销口播所有修改', '用户明确要求后恢复初始剪辑：恢复原文、全部声音、字幕分段、锁定和处理设置，保留工程名、参考稿、显示偏好。旧工程没有原始文本时保留已有文字，不能假称恢复识别原文。可用普通撤销恢复操作前状态。', 'R2'],
  ['format_audio_edit_subtitles', '整理口播字幕分段', '按现有标点、停顿、长度和时长合并词块为字幕段，上方文字、波形字幕与 SRT 共用分段；不改声音、词块 ID 或时间戳。之后可通过 caption_break_after 属性按全文语义细调边界，text 属性仅做有依据的校正。', 'R1'],
  ['quick_process_audio_edit', '快速处理口播', '一次压缩实际音频停顿并清理已选语气词，形成一个撤销步骤；不提交付费转写。', 'R1'],
  ['compress_audio_edit_silence', '压缩口播停顿', '本地检测实际音频，将合格停顿压缩为工程设置的保留长度，尊重锁定与选区。', 'R1'],
  ['clean_audio_edit_fillers', '清理口播语气词', '按工程中选择的词类清理有逐词时间戳的语气词，不删除锁定内容。', 'R1'],
  ['transcribe_audio_edit', '转写口播素材', '通过已配置语音模型识别原素材，可能计费；参考稿仅辅助内容对齐。', 'R2'],
  ['process_audio_edit_sound', '准备口播声音处理', '依照工程配方处理全长音轨，试听与可选 XML 声音交付共用处理结果。', 'R1'],
  ['export_audio_edit', '导出口播剪辑', '导出 FCP7 XML 或 WAV 到已配置下载目录，可附带 SRT；返回实际交付时长。', 'R2'],
  ['query_audio_edit_tasks', '查询口播处理任务', '读取该工程的分析、转写、处理和导出状态；不返回素材路径。', 'R0'],
  ['cancel_audio_edit_task', '取消口播处理任务', '取消明确工程下正在进行的指定任务。', 'R1'],
  ['retry_audio_edit_save', '重试保存口播工程', '只重新确认已修改工程的保存，不重放剪辑或付费任务。', 'R1'],
].map(([id, title, description, risk]) => defineApplicationCapability({
  id, title, description, version: 1, domain: 'audio_edit', aliases: [title], readOnly: risk === 'R0', risk: risk as 'R0' | 'R1' | 'R2', dataClasses: ['C1'], permission: risk === 'R0' ? 'audio_edit:read' : 'audio_edit:write', idempotent: !['export_audio_edit', 'transcribe_audio_edit'].includes(id), destructive: id === 'reset_audio_edit', timeoutMs: 600000, supportsPreview: false, supportsUndo: false, requiredScopes: ['audio_edit'], acceptsRefs: ['audio_edit.project'], producesRefs: ['audio_edit.project'], concurrencyKey: 'audio_edit', resolveConcurrencyKey: (input) => `audio_edit:${input.projectRef.id}`, resolveOperationTargets: (input) => [input.projectRef], resolveOperationWriteTargets: (input) => risk === 'R0' ? [] : [input.projectRef], control: capabilityControl(risk === 'R0' ? 'observe' : 'execute', ['audio_edit.project'], { cancelable: true, revisionScopes: ['audio_edit'] }), inputSchema: audioEditOperationInput, outputSchema: output, summarize: (result) => result.message,
  ...(AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS.has(id) ? {
    verificationContract: { kind: 'effect_receipt' as const, requireEffects: true, requireVerifiedEffects: true },
    resolveObservedEffects: (_input: z.infer<typeof audioEditOperationInput>, result: z.infer<typeof output>) => [{
      effect: 'execute' as const, entityTypes: ['audio_edit.project'], propertyIds: [], targetRefs: [result.resultRef], count: 1,
      verified: result.verified === true, evidence: result.verified ? ['已从工程持久存储回读并核对实际剪辑与字幕。'] : [],
    }],
  } : {}),
}))
