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
export const audioEditOperationInput = z.object({ documentRef, policy: z.enum(['delete', 'attenuate', 'mute', 'keep']).optional().describe('呼吸声处理：delete 默认（快节奏），去掉呼吸并把字间残留的气声清成静音、只留短气口，和字连着的只减弱；attenuate 全部减弱 18 dB；mute 全部静音（保留时长）；keep 撤掉此前的呼吸处理'), sourcePath: z.string().min(1).max(4096).optional(), positionSeconds: z.number().nonnegative().optional(), replaceUntilSeconds: z.number().nonnegative().optional(), repair: audioEditRepairSchema.optional(), range: audioEditRangeSchema.optional(), modelId: z.string().optional(), taskId: z.string().optional(), format: z.enum(['xml', 'wav']).optional(), includeProcessing: z.boolean().optional(), includeSrt: z.boolean().optional(), destination: canvasDownloadDestinationSchema.optional() }).strict()
export function audioEditInputSchema(id: string): z.ZodType<z.infer<typeof audioEditOperationInput>> {
  const base = audioEditOperationInput.pick({ documentRef: true })
  if (id === 'insert_audio_edit_file') return audioEditOperationInput.pick({ documentRef: true, sourcePath: true, positionSeconds: true, replaceUntilSeconds: true }).required({ sourcePath: true, positionSeconds: true })
  if (id === 'repair_audio_edit_region') return audioEditOperationInput.pick({ documentRef: true, repair: true }).required({ repair: true })
  if (id === 'cancel_audio_edit_task') return base.extend({ taskId: z.string().min(1) })
  if (id === 'export_audio_edit') return audioEditOperationInput.pick({ documentRef: true, format: true, includeProcessing: true, includeSrt: true, destination: true }).required({ destination: true })
  if (id === 'transcribe_audio_edit') return audioEditOperationInput.pick({ documentRef: true, modelId: true })
  if (id === 'import_audio_edit_source') return audioEditOperationInput.pick({ documentRef: true, sourcePath: true }).required({ sourcePath: true })
  if (['quick_process_audio_edit', 'compress_audio_edit_silence', 'clean_audio_edit_fillers', 'clean_audio_edit_retakes'].includes(id)) return audioEditOperationInput.pick({ documentRef: true, range: true })
  if (id === 'process_audio_edit_breaths') return audioEditOperationInput.pick({ documentRef: true, range: true, policy: true })
  return base
}
const output = z.object({ resultRef: documentRef, message: z.string(), verified: z.boolean().optional(), count: z.number().nonnegative().optional(), shortenedMs: z.number().optional().describe('剪后时长的变化（毫秒）：正数为缩短；重新处理呼吸声时比上次删得少会是负数，表示变长'), durationFrames: z.number().nonnegative().optional(), tasks: z.array(z.object({ requestId: z.string(), documentId: z.string(), kind: z.string(), state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']), progress: z.number().optional(), errorMessage: z.string().optional() })).optional() }).strict()
export const AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS = new Set(['insert_audio_edit_file', 'repair_audio_edit_region', 'reset_audio_edit', 'format_audio_edit_subtitles', 'quick_process_audio_edit', 'compress_audio_edit_silence', 'clean_audio_edit_fillers', 'clean_audio_edit_retakes', 'process_audio_edit_breaths'])
export const AUDIO_EDIT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  ['insert_audio_edit_file', '插入或覆盖音频', '在音频作品的 positionSeconds 秒处插入已有音频文件；提供 replaceUntilSeconds 则覆盖至该秒数。自动匹配采样格式，移动旧编辑并保留原文件，一步撤销，完成后立即保存。录音设备控制不在此能力内。', 'R1'],
  ['repair_audio_edit_region', '修复声音区域', '按源采样帧和频率范围修复声音瑕疵：spectral_heal 修复频谱区域，可带归一化画笔；declick 去除短促爆音。创建可撤销修复记录，渲染并回读确认。启用、强度或增删已有记录可用 audio_edit.document.repairs 通用属性。', 'R1'],
  ['reset_audio_edit', '撤销口播所有修改', '用户明确要求后恢复初始剪辑：恢复原文、全部声音、字幕分段、锁定和处理设置，保留口播名、参考稿、显示偏好。旧口播没有原始文本时保留已有文字，不能假称恢复识别原文。可用普通撤销恢复操作前状态。', 'R2'],
  ['format_audio_edit_subtitles', '整理口播字幕分段', '按现有标点、停顿、长度和时长合并词块为字幕段，上方文字、波形字幕与 SRT 共用分段；不改声音、词块 ID 或时间戳。之后可通过 caption_break_after 属性按全文语义细调边界，text 属性仅做有依据的校正。', 'R1'],
  ['import_audio_edit_source', '给口播导入素材', '给还没有素材的口播（如 create_document 新建的 audio_edit 文档）导入本机音频或视频文件，默认引用原文件、不复制；之后即可转写与剪辑。已有素材的口播不能再导入。', 'R1'],
  ['clean_audio_edit_retakes', '去掉口播重念', '照稿录口播时念坏了会马上重念：口误、没念好、在不该断的地方断开后重新起句。按逐词转写找出同一内容念了几遍的地方，只保留最后一遍；容忍同音字和改词，连续多遍、交错重念都收敛到最后一遍。切点落在实际声音的停顿里，被删的词和其间停顿一起去掉，在文字里恢复任一词时停顿也一并恢复。有参考稿时不删稿子里本来就有的重复。呼吸也算气口：原切点连读时，会在两遍对应位置的明显停顿或呼吸处换遍拼接（留下前一遍念好的开头），贴着念坏那遍的一两个字一起删。结果是确定性的起点，不是终点：之后逐处复核每一刀（为什么重念、接缝两侧的停顿与语气、能否在更好的气口换遍），用 audio_edit.transcript_block.included 调整。需逐词时间的转写，免费，一步撤销。', 'R1'],
  ['process_audio_edit_breaths', '处理口播呼吸声', '在本机用 Respiro 模型逐帧找出呼吸声（第一次用时下载约 13 MB），按策略处理：delete（默认，快节奏）去掉呼吸，再清理字间气口：按逐帧声音电平找出前一个字真正结束、后一个字真正开始的位置（前一字留 0.02 秒余音、后一字前留 0.01 秒），中间残留的气声、呼吸尾巴整段静音，超出的部分从中间删去，句间与重念接缝处留约 0.2 秒、句中约 0.12 秒，本来更短的只静音；落成标识以 gap: 开头的静音与删除剪切，想要更长的停顿或保留语气时直接改 audio_edit.document.cuts 里对应的 gap: 剪切；和字连着的呼吸只减弱；attenuate 全部减弱；mute 全部静音；keep 撤掉此前的呼吸处理；非 delete 时同时撤掉此前的气口清理。已被重念、停顿剪掉的不再处理，用户逐处恢复过的不动。逐处判断与修改用 audio_edit.breath 实体（context、前后文字、handling）。免费，一步撤销。', 'R1'],
  ['quick_process_audio_edit', '快速处理口播', '一次完成：有逐词转写时先去掉重念，再压缩实际音频停顿、清理已选语气词、按默认策略处理呼吸声，形成一个撤销步骤；不提交付费转写。没有接入助手时它就是全部；有助手时只是起点，助手要在此基础上逐处复核。', 'R1'],
  ['compress_audio_edit_silence', '压缩口播停顿', '本地检测实际音频，将合格停顿压缩为口播设置的保留长度，尊重锁定与选区。', 'R1'],
  ['clean_audio_edit_fillers', '清理口播语气词', '按口播中选择的词类清理有逐词时间戳的语气词，不删除锁定内容。', 'R1'],
  ['transcribe_audio_edit', '转写口播素材', '通过已配置语音模型识别原素材，可能计费；参考稿仅辅助内容对齐。', 'R2'],
  ['process_audio_edit_sound', '准备口播声音处理', '依照口播配方处理全长音轨，试听与可选 XML 声音交付共用处理结果。', 'R1'],
  ['export_audio_edit', '导出口播剪辑', '导出 FCP7 XML 或 WAV 到已配置下载目录，可附带 SRT；返回实际交付时长。', 'R2'],
  ['query_audio_edit_tasks', '查询口播处理任务', '读取该口播的分析、转写、处理和导出状态。', 'R0'],
  ['cancel_audio_edit_task', '取消口播处理任务', '取消明确口播下正在进行的指定任务。', 'R1'],
  ['retry_audio_edit_save', '重试保存口播', '只重新确认已修改口播的保存，不重放剪辑或付费任务。', 'R1'],
].map(([id, title, description, risk]) => defineApplicationCapability({
  id, title, description, version: 1, domain: 'audio_edit', aliases: [title], readOnly: risk === 'R0', risk: risk as 'R0' | 'R1' | 'R2', dataClasses: ['C1'], permission: risk === 'R0' ? 'audio_edit:read' : 'audio_edit:write', idempotent: !['insert_audio_edit_file', 'export_audio_edit', 'transcribe_audio_edit', 'import_audio_edit_source'].includes(id), destructive: id === 'reset_audio_edit', timeoutMs: 600000, supportsPreview: false, supportsUndo: ['insert_audio_edit_file', 'repair_audio_edit_region'].includes(id), requiredScopes: ['audio_edit'], acceptsRefs: ['audio_edit.document'], producesRefs: ['audio_edit.document'], concurrencyKey: 'audio_edit', resolveConcurrencyKey: (input) => `audio_edit:${input.documentRef.id}`, resolveOperationTargets: (input) => [input.documentRef], resolveOperationWriteTargets: (input) => risk === 'R0' ? [] : [input.documentRef], control: capabilityControl(risk === 'R0' ? 'observe' : 'execute', ['audio_edit.document'], { cancelable: true, revisionScopes: ['audio_edit'] }), mayRequirePaidConfirmation: id === 'transcribe_audio_edit', inputSchema: audioEditInputSchema(id), outputSchema: output, summarize: (result) => result.message,
  ...(AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS.has(id) || id === 'import_audio_edit_source' ? {
    verificationContract: { kind: 'effect_receipt' as const, requireEffects: true, requireVerifiedEffects: true },
    resolveObservedEffects: (_input: z.infer<typeof audioEditOperationInput>, result: z.infer<typeof output>) => [{
      effect: 'execute' as const, entityTypes: ['audio_edit.document'], propertyIds: [], targetRefs: [result.resultRef], count: 1,
      verified: result.verified === true, evidence: result.verified ? [id === 'import_audio_edit_source' ? '已从口播文件回读并核对导入的素材。' : '已从口播持久存储回读并核对实际剪辑与字幕。'] : [],
    }],
  } : {}),
}))
