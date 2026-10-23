import { audioEditRepairSchema } from '../../../audioEdit/regions'
import { z } from 'zod'
import { applicationRefSchema, type ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { audioEditRangeSchema } from '../../../audioEdit/schema'
import { canvasDownloadDestinationSchema } from '../canvas/canvasExportApplicationCapabilities'

// 口播是通用文档（3.3）：列出、新建、打开、改名、移动、删除走通用文档能力；这里的 id 就是口播文档 ID
const documentRef = applicationRefSchema.extend({
  kind: z.literal('audio_edit.document'),
  id: z.string().min(1).max(500).describe('口播文档 ID：取自 list_documents（kind=audio_edit）返回的 id，不是文档所在项目的 ID'),
}).strict()
export const audioEditOperationInput = z.object({ documentRef, sourcePath: z.string().min(1).max(4096).optional(), positionSeconds: z.number().nonnegative().optional(), replaceUntilSeconds: z.number().nonnegative().optional(), repair: audioEditRepairSchema.optional(), range: audioEditRangeSchema.optional(), modelId: z.string().optional(), taskId: z.string().optional(), format: z.enum(['xml', 'wav']).optional(), includeProcessing: z.boolean().optional(), includeSrt: z.boolean().optional(), destination: canvasDownloadDestinationSchema.optional() }).strict()
export function audioEditInputSchema(id: string): z.ZodType<z.infer<typeof audioEditOperationInput>> {
  const base = audioEditOperationInput.pick({ documentRef: true })
  if (id === 'insert_audio_edit_file') return audioEditOperationInput.pick({ documentRef: true, sourcePath: true, positionSeconds: true, replaceUntilSeconds: true }).required({ sourcePath: true, positionSeconds: true })
  if (id === 'repair_audio_edit_region') return audioEditOperationInput.pick({ documentRef: true, repair: true }).required({ repair: true })
  if (id === 'cancel_audio_edit_task') return base.extend({ taskId: z.string().min(1) })
  if (id === 'export_audio_edit') return audioEditOperationInput.pick({ documentRef: true, format: true, includeProcessing: true, includeSrt: true, destination: true }).required({ destination: true })
  if (id === 'transcribe_audio_edit') return audioEditOperationInput.pick({ documentRef: true, modelId: true })
  if (['quick_process_audio_edit', 'compress_audio_edit_silence', 'clean_audio_edit_fillers'].includes(id)) return audioEditOperationInput.pick({ documentRef: true, range: true })
  return base
}
const output = z.object({ resultRef: documentRef, message: z.string(), verified: z.boolean().optional(), count: z.number().nonnegative().optional(), shortenedMs: z.number().nonnegative().optional(), durationFrames: z.number().nonnegative().optional(), tasks: z.array(z.object({ requestId: z.string(), documentId: z.string(), kind: z.string(), state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']), progress: z.number().optional(), errorMessage: z.string().optional() })).optional() }).strict()
export const AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS = new Set(['insert_audio_edit_file', 'repair_audio_edit_region', 'reset_audio_edit', 'format_audio_edit_subtitles', 'quick_process_audio_edit', 'compress_audio_edit_silence', 'clean_audio_edit_fillers'])
export const AUDIO_EDIT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  ['insert_audio_edit_file', '插入或覆盖音频', '在音频作品的 positionSeconds 秒处插入已有音频文件；提供 replaceUntilSeconds 则覆盖至该秒数。自动匹配采样格式，移动旧编辑并保留原文件，一步撤销，完成后立即保存。录音设备控制不在此能力内。', 'R1'],
  ['repair_audio_edit_region', '修复声音区域', '按源采样帧和频率范围修复声音瑕疵：spectral_heal 修复频谱区域，可带归一化画笔；declick 去除短促爆音。创建可撤销修复记录，渲染并回读确认。启用、强度或增删已有记录可用 audio_edit.document.repairs 通用属性。', 'R1'],
  ['reset_audio_edit', '撤销口播所有修改', '用户明确要求后恢复初始剪辑：恢复原文、全部声音、字幕分段、锁定和处理设置，保留口播名、参考稿、显示偏好。旧口播没有原始文本时保留已有文字，不能假称恢复识别原文。可用普通撤销恢复操作前状态。', 'R2'],
  ['format_audio_edit_subtitles', '整理口播字幕分段', '按现有标点、停顿、长度和时长合并词块为字幕段，上方文字、波形字幕与 SRT 共用分段；不改声音、词块 ID 或时间戳。之后可通过 caption_break_after 属性按全文语义细调边界，text 属性仅做有依据的校正。', 'R1'],
  ['quick_process_audio_edit', '快速处理口播', '一次压缩实际音频停顿并清理已选语气词，形成一个撤销步骤；不提交付费转写。', 'R1'],
  ['compress_audio_edit_silence', '压缩口播停顿', '本地检测实际音频，将合格停顿压缩为口播设置的保留长度，尊重锁定与选区。', 'R1'],
  ['clean_audio_edit_fillers', '清理口播语气词', '按口播中选择的词类清理有逐词时间戳的语气词，不删除锁定内容。', 'R1'],
  ['transcribe_audio_edit', '转写口播素材', '通过已配置语音模型识别原素材，可能计费；参考稿仅辅助内容对齐。', 'R2'],
  ['process_audio_edit_sound', '准备口播声音处理', '依照口播配方处理全长音轨，试听与可选 XML 声音交付共用处理结果。', 'R1'],
  ['export_audio_edit', '导出口播剪辑', '导出 FCP7 XML 或 WAV 到已配置下载目录，可附带 SRT；返回实际交付时长。', 'R2'],
  ['query_audio_edit_tasks', '查询口播处理任务', '读取该口播的分析、转写、处理和导出状态。', 'R0'],
  ['cancel_audio_edit_task', '取消口播处理任务', '取消明确口播下正在进行的指定任务。', 'R1'],
  ['retry_audio_edit_save', '重试保存口播', '只重新确认已修改口播的保存，不重放剪辑或付费任务。', 'R1'],
].map(([id, title, description, risk]) => defineApplicationCapability({
  id, title, description, version: 1, domain: 'audio_edit', aliases: [title], readOnly: risk === 'R0', risk: risk as 'R0' | 'R1' | 'R2', dataClasses: ['C1'], permission: risk === 'R0' ? 'audio_edit:read' : 'audio_edit:write', idempotent: !['insert_audio_edit_file', 'export_audio_edit', 'transcribe_audio_edit'].includes(id), destructive: id === 'reset_audio_edit', timeoutMs: 600000, supportsPreview: false, supportsUndo: ['insert_audio_edit_file', 'repair_audio_edit_region'].includes(id), requiredScopes: ['audio_edit'], acceptsRefs: ['audio_edit.document'], producesRefs: ['audio_edit.document'], concurrencyKey: 'audio_edit', resolveConcurrencyKey: (input) => `audio_edit:${input.documentRef.id}`, resolveOperationTargets: (input) => [input.documentRef], resolveOperationWriteTargets: (input) => risk === 'R0' ? [] : [input.documentRef], control: capabilityControl(risk === 'R0' ? 'observe' : 'execute', ['audio_edit.document'], { cancelable: true, revisionScopes: ['audio_edit'] }), mayRequirePaidConfirmation: id === 'transcribe_audio_edit', inputSchema: audioEditInputSchema(id), outputSchema: output, summarize: (result) => result.message,
  ...(AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS.has(id) ? {
    verificationContract: { kind: 'effect_receipt' as const, requireEffects: true, requireVerifiedEffects: true },
    resolveObservedEffects: (_input: z.infer<typeof audioEditOperationInput>, result: z.infer<typeof output>) => [{
      effect: 'execute' as const, entityTypes: ['audio_edit.document'], propertyIds: [], targetRefs: [result.resultRef], count: 1,
      verified: result.verified === true, evidence: result.verified ? ['已从口播持久存储回读并核对实际剪辑与字幕。'] : [],
    }],
  } : {}),
}))
