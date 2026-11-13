import { audioEditRepairSchema } from '../../../audioEdit/regions'
import { z } from 'zod'
import { applicationRefSchema, type ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { audioEditRangeSchema } from '../../../audioEdit/schema'
import { canvasDownloadDestinationSchema } from '../canvas/canvasExportApplicationCapabilities'
import { AUDIO_EDIT_TRANSCRIPTION_RESUBMISSIONS } from './audioEditTaskStatus'
import { checkAudioEditSoundCapability } from './audioEditSoundCheckCapability'

// 口播是通用文档（3.3）：列出、新建、打开、改名、移动、删除走通用文档能力；这里的 id 就是口播文档 ID
const documentRef = applicationRefSchema.extend({
  kind: z.literal('audio_edit.document'),
  id: z.string().min(1).max(500).describe('口播文档 ID：取自 list_documents（kind=audio_edit）返回的 id，不是文档所在项目的 ID'),
}).strict()
export const audioEditOperationInput = z.object({ documentRef, targetLufs: z.number().finite().min(-40).max(-5).optional().describe('目标积分响度 LUFS：短视频平台 -14，播客 -16（默认），广播电视 -23'), sensitivity: z.number().finite().min(0).max(100).optional().describe('口水音检测灵敏度 0–100，默认 50；越高检出越多，误检也越多'), policy: z.enum(['delete', 'attenuate', 'mute', 'keep']).optional().describe('呼吸声处理：delete 默认（快节奏），去掉呼吸并把字间残留的气声清成静音、只留短气口，和字连着的只减弱；attenuate 全部减弱 18 dB；mute 全部静音（保留时长）；keep 撤掉此前的呼吸处理'), sourcePath: z.string().min(1).max(4096).optional(), positionSeconds: z.number().finite().nonnegative().optional().describe('插入位置，剪后作品时间（秒）：与 audio_edit.caption 的 start_ms ÷ 1000、剪后时长同一坐标，落在剪切处时插在剪切之后那段声音的开头。与 positionSourceFrame 二选一'), replaceUntilSeconds: z.number().finite().nonnegative().optional().describe('给出时覆盖插入位置到这一秒之间听得到的声音（剪后作品时间）；与 replaceUntilSourceFrame 二选一'), positionSourceFrame: z.number().int().nonnegative().optional().describe('插入位置，原素材采样帧：与 audio_edit.transcript_block 的 start_frame / end_frame 同一坐标（要插在某个词块前后时用它最准）。与 positionSeconds 二选一'), replaceUntilSourceFrame: z.number().int().nonnegative().optional().describe('覆盖到原素材的这一采样帧；与 replaceUntilSeconds 二选一'), repair: audioEditRepairSchema.optional(), range: audioEditRangeSchema.optional(), modelId: z.string().optional().describe('完整语音识别模型 ID；通常省略（自动选已配置供应商里能处理长音频的模型，与界面“开始转写”一致）。要指定时取设置项 transcription.default_model 的可选值（search_application_settings 读取，auto 除外），只有已配置凭据的供应商可用'), taskId: z.string().optional(), format: z.enum(['xml', 'wav']).optional(), itemId: z.string().min(1).max(100).optional().describe('效果控件里要检测的“去除口水音”那一项的 id（读 audio_edit.document.effect_chain 得到）；不给时用第一项，链里没有就加到末尾'), includeSrt: z.boolean().optional(), destination: canvasDownloadDestinationSchema.optional(), undoRef: z.string().min(1).max(200).optional().describe('要撤销或重做的那一步：取自这份口播上某次操作回执里的 undoRef') }).strict()
export function audioEditInputSchema(id: string): z.ZodType<z.infer<typeof audioEditOperationInput>> {
  const base = audioEditOperationInput.pick({ documentRef: true })
  if (id === 'insert_audio_edit_file') return audioEditOperationInput.pick({ documentRef: true, sourcePath: true, positionSeconds: true, replaceUntilSeconds: true, positionSourceFrame: true, replaceUntilSourceFrame: true }).required({ sourcePath: true })
  if (id === 'repair_audio_edit_region') return audioEditOperationInput.pick({ documentRef: true, repair: true }).required({ repair: true })
  if (id === 'cancel_audio_edit_task') return base.extend({ taskId: z.string().min(1) })
  if (id === 'export_audio_edit') return audioEditOperationInput.pick({ documentRef: true, format: true, includeSrt: true, destination: true })
  if (id === 'transcribe_audio_edit') return audioEditOperationInput.pick({ documentRef: true, modelId: true })
  if (id === 'import_audio_edit_source') return audioEditOperationInput.pick({ documentRef: true, sourcePath: true }).required({ sourcePath: true })
  if (['quick_process_audio_edit', 'compress_audio_edit_silence', 'clean_audio_edit_fillers', 'clean_audio_edit_retakes'].includes(id)) return audioEditOperationInput.pick({ documentRef: true, range: true })
  if (id === 'process_audio_edit_breaths') return audioEditOperationInput.pick({ documentRef: true, range: true, policy: true })
  if (id === 'match_audio_edit_loudness') return audioEditOperationInput.pick({ documentRef: true, targetLufs: true })
  if (id === 'detect_audio_edit_mouth_clicks') return audioEditOperationInput.pick({ documentRef: true, itemId: true, range: true, sensitivity: true })
  if (id === 'undo_audio_edit' || id === 'redo_audio_edit') return audioEditOperationInput.pick({ documentRef: true, undoRef: true }).required({ undoRef: true })
  return base
}
const output = z.object({ resultRef: documentRef, message: z.string(), verified: z.boolean().optional(), count: z.number().nonnegative().optional(), shortenedMs: z.number().optional().describe('剪后时长的变化（毫秒）：正数为缩短；重新处理呼吸声时比上次删得少会是负数，表示变长'), durationFrames: z.number().nonnegative().optional(),
  editedSeconds: z.number().nonnegative().optional().describe('处理后剪后作品的时长（秒）'),
  sound: z.object({
    integratedLufs: z.number().finite().nullable().describe('处理后成品的整体积分响度 LUFS（与 check_audio_edit_sound 同一口径）；测不出为 null'),
    truePeakDbtp: z.number().finite().nullable().describe('处理后成品的真峰值 dBTP'),
    beforeLufs: z.number().finite().optional().describe('补偿前测得的积分响度'),
  }).strict().optional().describe('匹配响度后实际测得的成品响度；完整读回用 check_audio_edit_sound'),
  outputPath: z.string().optional().describe('导出：写出的成品文件（WAV，或 FCP7 XML）的本机路径'), audioPath: z.string().optional().describe('导出 XML 时：XML 引用的音频文件路径'), subtitlePath: z.string().optional().describe('导出时附带的 SRT 字幕路径'),
  quickProcess: z.object({
    retakesRemoved: z.number().int().nonnegative().describe('这次去掉的重念处数'), breathsRemoved: z.number().int().nonnegative().describe('删掉的呼吸处数'), breathsAttenuated: z.number().int().nonnegative().describe('减弱的呼吸处数（和字连着的）'),
    gapsSilenced: z.number().int().nonnegative().describe('清成静音的字间气口处数'), pausesCompressed: z.number().int().nonnegative().describe('这次新压缩的长停顿处数'), fillersRemoved: z.number().int().nonnegative().describe('删掉的语气词个数'),
    retakesToDecide: z.number().int().nonnegative().describe('处理后整份口播里待确认、必须由助手或人裁决的重念线索数（audio_edit.suggestion 按 attention=decide 筛出）'), retakesToCheck: z.number().int().nonnegative().describe('已自动删但把握不高、值得抽看的重念线索数（attention=check）'),
  }).strict().optional().describe('快速处理各步的结果；剪后时长变化见 shortenedMs'),
  transcription: z.object({
    modelId: z.string().describe('实际所用的语音识别模型'), granularity: z.enum(['word', 'segment', 'none']).describe('时间粒度：word 逐词（可以去重念），segment 只有整句时间'),
    blockCount: z.number().int().nonnegative().describe('得到的词块数'), characterCount: z.number().int().nonnegative().describe('识别出的字数（不含标点与空白）'),
    costCny: z.number().nonnegative().nullable().describe('这次的费用（人民币，与付费账本同一口径：按时长与模型单价）；0 表示沿用已计费的结果、没有再收费；null 表示模型没有单价资料'),
  }).strict().optional().describe('转写结果'),
  tasks: z.array(z.object({ requestId: z.string(), documentId: z.string(), kind: z.string(), state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']), progress: z.number().optional(), errorMessage: z.string().optional(), resubmission: z.enum(AUDIO_EDIT_TRANSCRIPTION_RESUBMISSIONS).optional().describe('只在最近一次转写上给出，表示再调 transcribe_audio_edit 会怎样：completed 已转写完成，不会整份再识别（插入段的补识别各自另记一条 kind 以 transcription_fill: 开头的任务）；running 本窗口正在转写，等它结束或用 cancel_audio_edit_task 取消；allowed 没有计费，可以重新转写；resume 已交给识别服务或已拿到结果，再调会接着查原任务或取回结果，不重复计费；blocked 无法确认是否已计费、或素材已变化，不会再提交（需要重新识别时用当前素材新建口播）；running_elsewhere 助手命令行（无窗口运行的助手）正在转写这份口播，等它结束或取消') })).optional(), undoRef: z.string().optional().describe('这一步的撤销引用：传给 undo_audio_edit 只撤这一步；之后口播又被改过（如用户手改）会拒绝撤销，不冲掉那些修改') }).strict()
export const AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS = new Set(['insert_audio_edit_file', 'repair_audio_edit_region', 'reset_audio_edit', 'format_audio_edit_subtitles', 'quick_process_audio_edit', 'compress_audio_edit_silence', 'clean_audio_edit_fillers', 'clean_audio_edit_retakes', 'process_audio_edit_breaths', 'match_audio_edit_loudness', 'detect_audio_edit_mouth_clicks', 'undo_audio_edit', 'redo_audio_edit'])
/** 这些操作完成后各形成一步撤销，回执带 undoRef。 */
export const AUDIO_EDIT_UNDOABLE_OPERATIONS = new Set([...AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS].filter((id) => id !== 'undo_audio_edit' && id !== 'redo_audio_edit'))
/** 按同一套口播回执执行的操作（处理器在 registerAudioEditCapabilityHandlers 里逐个登记）。 */
export const AUDIO_EDIT_OPERATION_CAPABILITIES: ApplicationCapabilityDefinition[] = ([
  ['insert_audio_edit_file', '插入或覆盖音频', '把已有音频文件插进口播：位置用 positionSeconds（剪后作品时间，听到的那一秒，与 audio_edit.caption 的 start_ms 同一坐标）或 positionSourceFrame（原素材采样帧，与 audio_edit.transcript_block 的 start_frame 同一坐标）给一个；给 replaceUntilSeconds / replaceUntilSourceFrame 则覆盖到那里。自动匹配采样格式，移动旧编辑并保留原文件，一步撤销，完成后立即保存。已有转写时插入段先显示占位“（需要重新转写）”（不进字幕），之后用 transcribe_audio_edit 只补识别插入段。要用麦克风现录用 start_audio_edit_recording。', false],
  ['repair_audio_edit_region', '修复声音区域', '按源采样帧和频率范围修复声音瑕疵：spectral_heal 修复频谱区域，可带归一化画笔；declick 去除短促爆音。创建可撤销修复记录，渲染并回读确认。启用、强度或增删已有记录可用 audio_edit.document.repairs 通用属性。', false],
  ['reset_audio_edit', '撤销口播所有修改', '用户明确要求后恢复初始剪辑：恢复原文、全部声音、字幕分段、锁定和处理设置，保留口播名、参考稿、显示偏好。旧口播没有原始文本时保留已有文字，不能假称恢复识别原文。可用回执的 undoRef 经 undo_audio_edit 恢复操作前状态。', false],
  ['format_audio_edit_subtitles', '整理字幕分段', '整理成片字幕的分段，上方文字、波形字幕与 SRT 共用，字幕段供首次放进剪辑时参考；已放进剪辑的字幕文字与分段在剪辑里定稿，这里改字、改分段不同步过去（剪切与恢复会让剪辑字幕跟着声音更新）；不改声音、词块 ID 或时间戳。有参考稿时按稿子断句：稿子的逗号、句号、问号、感叹号、分号处换行，一行一句，念时多带的句尾语气词归前一句，稿子里没有的一大段按停顿兜底，超过约 24 个字的长句在中间附近最明显的停顿处拆开；没有参考稿时按现有标点、停顿、长度和时长合并。之后逐段核对用 audio_edit.caption（显示文字、稿子原文、识别原样），改字写它的 text，分段用 audio_edit.transcript_block.caption_break_after。', false],
  ['import_audio_edit_source', '给口播导入素材', '给还没有素材的口播（如 create_document 新建的 audio_edit 文档）导入本机音频或视频文件，默认引用原文件、不复制；之后即可转写与剪辑。已有素材的口播不能再导入。', false],
  ['clean_audio_edit_retakes', '去掉口播重念', '照稿录口播时念坏了会马上重念：口误、没念好、在不该断的地方断开后重新起句。按逐词转写找出同一内容念了几遍的地方，只保留最后一遍；容忍同音字和改词，连续多遍、交错重念都收敛到最后一遍。念坏后说“哎”从前面某句开头重来时，从那句开头到“哎”整段删掉；开头相同、后面换了说法的，参考稿能佐证两遍念的是同一句才删，没有佐证的只留作待确认的剪辑线索（audio_edit.suggestion 里 kind=retake、current_state=available，按 attention=decide 筛出来；自带拿不准的原因 reason、像不像重念 score、各种做法 options（留后一遍、留前一遍、换个切点，各自删掉的文字与接缝两侧读起来的样子）及前后文），要逐处判断：把选中的做法 id 写进线索的 chosen_option（删词并补接缝停顿剪切；keep_later 等于整条接受，keep_both 等于驳回，status=applied / dismissed 是等价的简写），定不了的把 audience 写成 user 留给用户试听；自动删掉的重念同样带着 options，本地只能先按留最后一遍定，留哪一遍更好也用 chosen_option 改判，其中把握不高的按 attention=check 筛出来抽看，其余不必逐条读做法；删完还会再看一遍保留下来的内容，前后两段开头相同、仍像重念的也列为待确认（每 10 分钟录音最多 8 条，证据强的优先），不自动删。切点落在实际声音的停顿里，被删的词和其间停顿一起去掉，在文字里恢复任一词时停顿也一并恢复。有参考稿时不删稿子里本来就有的重复。呼吸也算气口：原切点连读时，会在两遍对应位置的明显停顿或呼吸处换遍拼接（留下前一遍念好的开头），贴着念坏那遍的一两个字一起删。结果是确定性的起点，不是终点：之后逐处复核每一刀（为什么重念、接缝两侧的停顿与语气、留哪一遍更好），改判写线索的 chosen_option；线索给的做法都不合适时才逐个改 audio_edit.transcript_block.included。重复调用是安全的：定过都留着、改过做法或手动恢复过的那一对两遍不会再动，回执里的待确认条数只算这次新列出的。需逐词时间的转写（插入后还没补识别的段跳过，两侧各自检测），免费，一步撤销。', false],
  ['process_audio_edit_breaths', '处理口播呼吸声', '在本机用 Respiro 模型逐帧找出呼吸声（第一次用时下载约 13 MB），按策略处理：delete（默认，快节奏）去掉呼吸，再清理字间气口：按逐帧声音电平找出前一个字真正结束、后一个字真正开始的位置（前一字留 0.01 秒余音、后一字前留 0.01 秒），中间残留的气声、呼吸尾巴整段静音，超出的部分从中间删去，句间与重念接缝处留约 0.2 秒、句中约 0.12 秒，只在标点、接缝、呼吸或明显停顿处清，连着念的词之间、不到 0.1 秒或只有底噪的短停顿不动，后一个字开头很轻的送气、擦音算作字头；按剪后的时间线合并接缝两侧气口，连同已删重念遗留的碎字尾巴一起清理；重复删除保留已有剪切，时长不反弹，用户手写或手动改过的剪切不覆盖；落成标识以 gap: 开头的静音与删除剪切，想要更长的停顿或保留语气时直接改对应的 gap: 剪切（audio_edit.cut 实体逐条改起止或停用）；和字连着的呼吸只减弱；attenuate 全部减弱；mute 全部静音；keep 撤掉此前的呼吸处理；非 delete 时同时撤掉此前的气口清理。已被重念、停顿剪掉的不再处理，用户逐处恢复过的不动。逐处判断与修改用 audio_edit.breath 实体（context、前后文字、handling）。免费，一步撤销。', false],
  ['match_audio_edit_loudness', '自动匹配口播响度', '按当前全部声音处理（修复、效果控件里的全部效果、区间音量、输出音量）渲染剪好的成品，测量积分响度，把到目标响度需要的补偿写进 audio_edit.document.output 的 loudness（同时打开自动匹配，末尾限幅 -1 dB），再测一次补偿后的成品，回执的 sound 给出实测整体响度与真峰值。改了其他处理后响度会变，需要重新匹配；削波、底噪等其余结果用 check_audio_edit_sound 读回。', false],
  ['detect_audio_edit_mouth_clicks', '检测口水音', '找出说话时口水带出的短促咔嗒声（约 0.3–10 毫秒的宽频瞬态），写进效果控件里“去除口水音”那一项（audio_edit.document.effect_chain，kind=mouth_declick）并打开它；检测听的是这一项之前的声音，修复用 LPC 插值一遍修完，可撤销。只在选区内检测时传 range（源采样帧），会替换这段原有的检测结果。', false],
  ['quick_process_audio_edit', '快速处理口播', '一次完成：有逐词转写时先去掉重念（插入后还没补识别的段跳过，不跨过它比对、不在里面下刀），再压缩实际音频停顿、清理已选语气词里自成一段的（前后都停了一下的迟疑；连着念的保留）、按默认策略处理呼吸声，形成一个撤销步骤；不提交付费转写。没有接入助手时它就是全部；有助手时只是起点，助手要在此基础上逐处复核。', false],
  ['compress_audio_edit_silence', '压缩口播停顿', '本地检测实际音频，按剪后的时间线合并接缝两侧停顿；接缝超过口播设置的保留长度就压到该长度，普通停顿仍按检测阈值判断。尊重锁定与选区，保留手写剪切，重复执行不重复剪切、不改变时长。', false],
  ['clean_audio_edit_fillers', '清理口播语气词', '按口播中选择的词类清理有逐词时间戳的语气词，不删除锁定内容。', false],
  ['transcribe_audio_edit', '转写口播素材', '用已配置的语音识别模型识别原素材，得到逐词时间的文字（之后才能去重念、整理字幕），按时长计费，走付费策略；参考稿只辅助内容对齐。会一直等到转写完成并保存才返回（最长约 10 分钟）；等不到时只是不再等，转写照常进行，用 query_audio_edit_tasks 查进度，completed 后读 audio_edit.transcript_block。已有转写的口播不会整份重新识别；插入或补录进来、文字显示为占位“（需要重新转写）”的段，再调一次就只补识别这些段（每段单独截取声音，只按这些段的时长计费，同样走付费策略；已付过费的段不再收费），结果替换占位，回执带 undoRef 可撤回补之前；没有这样的段时不再识别。超过所选模型单次上传上限时不上传、不收费，错误会说明：省略 modelId 让应用自动选长音频模型重试；只配置了短音频模型时请用户配置百炼这类长音频模型。中断或失败后能不能重新发起看 query_audio_edit_tasks 里最近一次转写的 resubmission。', false],
  ['process_audio_edit_sound', '准备口播声音处理', '按效果控件里要整段处理的效果（去除口水音、呼吸声、人声分离、去混响、插件）把全长录音先处理好并缓存，试听、XML 与成品共用处理结果。', false],
  ['export_audio_edit', '导出口播剪辑', '导出剪好的口播：format=wav 是成品音频，xml（默认）是 FCP7 XML 加它引用的音频；includeSrt 附带同名 SRT 字幕。省略 destination 时放进口播所在项目的“导出”文件夹（与剪辑导出一致；口播不在项目里时才需要指定快速下载或预设目录），重名加序号，不覆盖已有文件。回执的 outputPath、subtitlePath 是写出的文件路径，durationFrames 是实际交付时长。', false],
  ['query_audio_edit_tasks', '查询口播处理任务', '读取该口播的分析、转写、处理和导出状态；最近一次转写带 resubmission，说明能否重新转写、会不会重复计费。', true],
  ['cancel_audio_edit_task', '取消口播处理任务', '取消明确口播下正在进行的指定任务。', false],
  ['retry_audio_edit_save', '重试保存口播', '只重新确认已修改口播的保存，不重放剪辑或付费任务。', false],
  ['undo_audio_edit', '撤销口播的一步', '撤销某次操作回执里 undoRef 对应的那一步（去重念、快速处理、呼吸、停顿、语气词、字幕整理、插入、修复、全部还原等），与界面撤销同一个历史，撤销后立即保存。只在这一步仍是最近一步时撤：之后口播又被改过（通常是用户手改）就拒绝，不冲掉那些修改；这时逐处改回，或请用户在音频编辑里撤销。通用属性写入的回执用 undo_application_changes。', false],
  ['redo_audio_edit', '重做口播的一步', '恢复用 undo_audio_edit 按同一 undoRef 刚撤销的那一步；撤销之后口播又被改过就拒绝。', false],
] as const).map(([id, title, description, readOnly]) => defineApplicationCapability({
  id, title, description, version: 1, domain: 'audio_edit', aliases: [title], readOnly, dataClasses: ['C1'], idempotent: !['insert_audio_edit_file', 'export_audio_edit', 'transcribe_audio_edit', 'import_audio_edit_source', 'undo_audio_edit', 'redo_audio_edit'].includes(id), destructive: id === 'reset_audio_edit', timeoutMs: 600000, supportsPreview: false, supportsUndo: AUDIO_EDIT_UNDOABLE_OPERATIONS.has(id), requiredScopes: ['audio_edit'], acceptsRefs: ['audio_edit.document'], producesRefs: ['audio_edit.document'], concurrencyKey: 'audio_edit', resolveConcurrencyKey: (input) => `audio_edit:${input.documentRef.id}`, resolveOperationTargets: (input) => [input.documentRef], resolveOperationWriteTargets: (input) => readOnly ? [] : [input.documentRef], control: capabilityControl(readOnly ? 'observe' : 'execute', ['audio_edit.document'], { cancelable: true, revisionScopes: ['audio_edit'] }), mayRequirePaidConfirmation: id === 'transcribe_audio_edit', inputSchema: audioEditInputSchema(id), outputSchema: output, summarize: (result) => result.message,
  ...(AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS.has(id) || id === 'import_audio_edit_source' ? {
    verificationContract: { kind: 'effect_receipt' as const, requireEffects: true, requireVerifiedEffects: true },
    resolveObservedEffects: (_input: z.infer<typeof audioEditOperationInput>, result: z.infer<typeof output>) => [{
      effect: 'execute' as const, entityTypes: ['audio_edit.document'], propertyIds: [], targetRefs: [result.resultRef], count: 1,
      verified: result.verified === true, evidence: result.verified ? [id === 'import_audio_edit_source' ? '已从口播文件回读并核对导入的素材。' : '已从口播持久存储回读并核对实际剪辑与字幕。'] : [],
    }],
  } : {}),
}))
export const AUDIO_EDIT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [...AUDIO_EDIT_OPERATION_CAPABILITIES, checkAudioEditSoundCapability]
