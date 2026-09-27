import { z } from 'zod'
import { applicationRefSchema, type ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { audioEditRangeSchema } from '../../../audioEdit/schema'
import { canvasDownloadDestinationSchema } from '../canvas/canvasExportApplicationCapabilities'

const projectRef = applicationRefSchema.extend({ kind: z.literal('audio_edit.project') }).strict()
export const audioEditOperationInput = z.object({ projectRef, range: audioEditRangeSchema.optional(), modelId: z.string().optional(), taskId: z.string().optional(), format: z.enum(['xml', 'wav']).optional(), includeProcessing: z.boolean().optional(), includeSrt: z.boolean().optional(), destination: canvasDownloadDestinationSchema.optional() }).strict()
const output = z.object({ resultRef: projectRef, message: z.string(), count: z.number().nonnegative().optional(), shortenedMs: z.number().nonnegative().optional(), durationFrames: z.number().nonnegative().optional(), tasks: z.array(z.object({ requestId: z.string(), projectId: z.string(), kind: z.string(), state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']), progress: z.number().optional(), errorMessage: z.string().optional() })).optional() }).strict()
export const AUDIO_EDIT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  ['compress_audio_edit_silence', '压缩口播停顿', '本地检测实际音频，将合格停顿压缩为工程设置的保留长度，尊重锁定与选区。', 'R1'],
  ['clean_audio_edit_fillers', '清理口播语气词', '按工程中选择的词类清理有逐词时间戳的语气词，不删除锁定内容。', 'R1'],
  ['transcribe_audio_edit', '转写口播素材', '通过已配置语音模型识别原素材，可能计费；参考稿仅辅助内容对齐。', 'R2'],
  ['process_audio_edit_sound', '准备口播声音处理', '依照工程配方处理全长音轨，试听与可选 XML 声音交付共用处理结果。', 'R1'],
  ['export_audio_edit', '导出口播剪辑', '导出 FCP7 XML 或 WAV 到已配置下载目录，可附带 SRT；返回实际交付时长。', 'R2'],
  ['query_audio_edit_tasks', '查询口播处理任务', '读取该工程的分析、转写、处理和导出状态；不返回素材路径。', 'R0'],
  ['cancel_audio_edit_task', '取消口播处理任务', '取消明确工程下正在进行的指定任务。', 'R1'],
  ['retry_audio_edit_save', '重试保存口播工程', '只重新确认已修改工程的保存，不重放剪辑或付费任务。', 'R1'],
].map(([id, title, description, risk]) => defineApplicationCapability({
  id, title, description, version: 1, domain: 'audio_edit', aliases: [title], readOnly: risk === 'R0', risk: risk as 'R0' | 'R1' | 'R2', dataClasses: ['C1'], permission: risk === 'R0' ? 'audio_edit:read' : 'audio_edit:write', idempotent: !['export_audio_edit', 'transcribe_audio_edit'].includes(id), destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false, requiredScopes: ['audio_edit'], acceptsRefs: ['audio_edit.project'], producesRefs: ['audio_edit.project'], concurrencyKey: 'audio_edit', resolveConcurrencyKey: (input) => `audio_edit:${input.projectRef.id}`, resolveOperationTargets: (input) => [input.projectRef], resolveOperationWriteTargets: (input) => risk === 'R0' ? [] : [input.projectRef], control: capabilityControl(risk === 'R0' ? 'observe' : 'execute', ['audio_edit.project'], { cancelable: true, revisionScopes: ['audio_edit'] }), inputSchema: audioEditOperationInput, outputSchema: output, summarize: (result) => result.message,
}))
