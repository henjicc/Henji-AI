import { z } from 'zod'
import { applicationRefSchema, type ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

/*
 * 音频编辑录音：开始、暂停、继续、停止、中断后恢复。录音占着麦克风、跨越很久，是设备会话的生命周期，
 * 写不成某个属性，所以是一组语义操作（与 start_screen_recording 一组同理）；业务全部走音频编辑里录音按钮用的同一个会话。
 * 状态读回走通用实体 audio_capture.settings 的 recording 与 pending_files。
 */

const documentRef = applicationRefSchema.extend({
  kind: z.literal('audio_edit.document'),
  id: z.string().min(1).max(500).describe('口播文档 ID：取自 list_documents（kind=audio_edit）返回的 id'),
}).strict()
/** 同一时间只有一段音频编辑录音：所有录音操作都落在这一个目标上，互相串行。 */
export const AUDIO_CAPTURE_TARGET = { kind: 'audio_capture.settings', id: 'singleton' } as const
const captureRef = z.object({ kind: z.literal('audio_capture.settings'), id: z.literal('singleton') }).strict()

export const startAudioEditRecordingInput = z.object({
  documentRef: documentRef.optional().describe('录进哪份口播；省略时新建一份录音口播'),
  projectId: z.string().min(1).optional().describe('省略 documentRef 新建口播时放进这个项目；都省略放在作品目录的“口播”文件夹'),
  positionSeconds: z.number().finite().nonnegative().optional().describe('录到作品里的位置（秒）；省略接在作品末尾，新建的从 0 开始'),
  replaceUntilSeconds: z.number().finite().nonnegative().optional().describe('给出时覆盖 positionSeconds 到这一秒之间的原声音；省略只插入、不覆盖'),
}).strict()
export const resumeAudioEditRecordingInput = z.object({
  positionSeconds: z.number().finite().nonnegative().optional().describe('从作品的哪一秒接着录；省略时音频编辑正显示这份口播就从当前播放头接（与界面“继续录音”一样），没显示就接在刚拼回那一段的末尾'),
}).strict()
export const recoverAudioEditRecordingInput = z.object({
  outputPath: z.string().min(1).max(4096).optional().describe('待恢复的录音文件，取自 audio_capture.settings.pending_files 的 outputPath；省略时用刚中断的那一个，只有一个待恢复文件时用它'),
  action: z.enum(['restore', 'discard']).default('restore').describe('restore 拼回录音开始时的作品与位置；discard 移到回收区（可以从回收区找回）'),
}).strict()
export const audioEditRecordingPhaseSchema = z.enum(['idle', 'recording', 'paused', 'stopped', 'interrupted'])
const output = z.object({
  resultRef: z.union([documentRef, captureRef]),
  message: z.string(),
  verified: z.boolean(),
  recording: z.object({ phase: audioEditRecordingPhaseSchema, durationSeconds: z.number().nonnegative(), positionSeconds: z.number().nullable() }).strict(),
  durationFrames: z.number().nonnegative().optional(),
  undoRef: z.string().optional().describe('这次拼回作品的撤销引用：交给 undo_audio_edit 只撤这一步'),
  finishing: z.boolean().optional().describe('等了约 45 秒仍在停止、拼回或保存：照常在后台进行，不要重发；读 audio_capture.settings.recording，busy 变回 false 后看 lastTake：state=saved 已拼回（undoRef 交给 undo_audio_edit），state=failed 没拼回（error 是原因）'),
}).strict()
export type AudioEditRecordingOutput = z.infer<typeof output>

const SPECS = [
  ['start_audio_edit_recording', '开始音频编辑录音', '用麦克风录进一份口播，与音频编辑里点“开始录音”同一套实现：录音在后台进行，切页面、界面重载都不停，不切换页面，不收费。documentRef 省略时新建一份录音口播。positionSeconds 省略接在作品末尾（新建的从 0 开始）；给 replaceUntilSeconds 覆盖这一段原声音。用哪个麦克风、什么采样率跟随用户的录音设置（audio_capture.settings 的通用属性；要换设备先改它，之后的录音都用新设置）。录屏或讲解正开着麦克风时会被拒绝（读 audio_capture.settings.recording 的 microphoneInUse）。录音期间这份口播不能编辑。进度读 audio_capture.settings.recording，停止用 stop_audio_edit_recording。', 60_000, false],
  ['pause_audio_edit_recording', '暂停音频编辑录音', '把已录的这一段先拼进口播并保存（一步撤销，回执带 undoRef），这时作品可以试听和编辑；resume_audio_edit_recording 继续录新的一段。最多等约 45 秒，长录音没拼完时返回 finishing=true，拼完后看 audio_capture.settings.recording 的 lastTake（state 与 undoRef）。', 60_000, true],
  ['resume_audio_edit_recording', '继续音频编辑录音', '暂停后继续录新的一段，设备与参数同开始时。默认：音频编辑正显示这份口播时与界面“继续录音”一样从当前播放头接（试听中先停），没显示时接在刚拼回那一段的末尾；给 positionSeconds 从作品的那一秒接。', 60_000, false],
  ['stop_audio_edit_recording', '停止音频编辑录音', '停止录音，把这一段拼回开始时选的作品与位置并保存，回读作品时长；一步撤销，回执的 undoRef 交给 undo_audio_edit 可撤掉这次拼接。界面重载后还没接管的录音也能停；已经被界面停止或覆盖到头自动停止的，如实返回那次拼回的结果。最多等约 45 秒，没拼完时返回 finishing=true：读 audio_capture.settings.recording 的 busy 与 lastTake（state、undoRef、error），不要重复停止。拼回失败时说明录音文件在哪，用 recover_audio_edit_recording 拼回。', 60_000, true],
  ['recover_audio_edit_recording', '恢复中断的音频编辑录音', '录音中断（设备拔出、程序崩溃或卡死）后处理留下的录音文件：restore 拼回录音开始时的作品与位置并保存（一步撤销），discard 移到回收区。待恢复文件读 audio_capture.settings.pending_files。原作品在这段录音之后又被改过时不能拼回，请用户在音频编辑的恢复横幅里另存为新草稿。最多等约 45 秒，没做完时返回 finishing=true，读 audio_capture.settings.recording 的 busy 与 lastTake（state、undoRef、error）。', 60_000, true],
] as const

export const AUDIO_EDIT_RECORDING_CAPABILITIES: ApplicationCapabilityDefinition[] = SPECS.map(([id, title, description, timeoutMs, supportsUndo]) => defineApplicationCapability({
  id, title, description, version: 1, domain: 'audio_edit', aliases: [title, '录音', 'record voiceover'], readOnly: false, dataClasses: ['C1'], idempotent: false, destructive: false, timeoutMs,
  supportsPreview: false, supportsUndo, requiredScopes: ['audio_edit'], acceptsRefs: ['audio_edit.document'], producesRefs: ['audio_edit.document'], concurrencyKey: 'audio_capture',
  inputSchema: id === 'start_audio_edit_recording' ? startAudioEditRecordingInput : id === 'resume_audio_edit_recording' ? resumeAudioEditRecordingInput : id === 'recover_audio_edit_recording' ? recoverAudioEditRecordingInput : z.object({}).strict(),
  resolveOperationTargets: (input: { documentRef?: { kind: string; id: string } }) => [AUDIO_CAPTURE_TARGET, ...(input.documentRef ? [input.documentRef] : [])],
  ...(id === 'start_audio_edit_recording' ? { resolveOperationWriteTargets: (input: { documentRef?: { kind: string; id: string } }, operationId: string) => [AUDIO_CAPTURE_TARGET, input.documentRef ?? { kind: 'audio_edit.document', id: `pending:${operationId}` }] } : {}),
  control: capabilityControl('execute', ['audio_edit.document'], { revisionScopes: ['audio_edit'] }),
  outputSchema: output, summarize: (result: AudioEditRecordingOutput) => result.message,
  // 暂停、停止、恢复等不及时如实返回“仍在进行”（verified=false、finishing=true），不能因此被判成失败而重发。
  verificationContract: { kind: 'effect_receipt' as const, requireEffects: true, requireVerifiedEffects: !supportsUndo },
  resolveObservedEffects: (_input: unknown, result: AudioEditRecordingOutput) => [{
    effect: 'execute' as const, entityTypes: ['audio_edit.document'], propertyIds: [], targetRefs: [result.resultRef], count: 1,
    verified: result.verified, evidence: result.verified ? ['已从主进程读回录音状态，并核对口播保存后的内容。'] : [],
  }],
}) as ApplicationCapabilityDefinition)
