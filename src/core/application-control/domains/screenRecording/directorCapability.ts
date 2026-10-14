import { z } from 'zod'
import { recordingOperationSchema } from '../../../screenRecording/script'
import { recordingVoiceSchema } from '../../../screenRecording/director'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const sessionRef = z.object({ kind: z.literal('screen_recording.session'), id: z.string().uuid() }).strict()
const documentRef = z.object({ kind: z.literal('video_edit.document'), id: z.string().min(1) }).strict()
const common = { version: 1, domain: 'screen_recording', readOnly: false, risk: 'R1' as const, dataClasses: ['C1' as const], permission: 'screen_recording:write', idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false, requiredScopes: [], concurrencyKey: 'screen_recording' }
export const planDirectorInputSchema = z.object({
  goal: z.string().trim().min(1).max(2000), voice: recordingVoiceSchema,
  steps: z.array(z.object({ title: z.string().trim().min(1).max(120), narration: z.string().trim().min(1).max(2000), picture: z.string().trim().min(1).max(1000), operations: z.array(recordingOperationSchema).min(1).max(16), settleMs: z.number().int().min(100).max(10000).default(700) }).strict()).min(1).max(40),
}).strict()
export const planRecordingDirectorCapability = defineApplicationCapability({ ...common,
  id: 'plan_screen_recording_director', title: '规划导演录制',
  description: '把用户教程目标编排为分步操作、旁白及预计画面，保存为可审阅的录制会话。助手先按目标与当前应用状态填写 steps，再提交本能力；只支持声明中的有限免费操作，不接受代码或任意鼠标宏。剪辑操作会保存起始快照并在临时副本执行；settings.registry 只支持 interface.theme_preset 四个预设，执行时打开设置，结束恢复。voice 从生成模型目录选择语音模型及其参数，已复刻音色使用该模型的正式音色参数。返回后让人审阅；用 screen_recording.understanding.result 通用写入修改 director.narration/voice 与 operationScript，改动须设 confirmed=false，另一次写入设 true 确认。规划不调用付费服务。',
  aliases: ['AI导演', '制作操作教程', '规划录屏'], inputSchema: planDirectorInputSchema,
  outputSchema: z.object({ resultRef: sessionRef, verified: z.boolean() }).strict(),
  acceptsRefs: ['video_edit.clip', 'video_edit.sequence'], producesRefs: ['screen_recording.session'],
  resolveOperationTargets: input => input.steps.flatMap(v => v.operations.map(o => o.target)),
  resolveOperationWriteTargets: (_input, id) => [{ kind: 'screen_recording.session', id: `pending:${id}` }],
  control: capabilityControl('create', ['screen_recording.session']), summarize: () => '导演脚本已保存，请审阅步骤与旁白后确认。',
})
export const startRecordingDirectorCapability = defineApplicationCapability({ ...common,
  id: 'start_screen_recording_director', title: '执行导演录制并成片',
  description: '执行已确认的导演脚本：沿当前付费策略生成旁白，按实测时长留出画面停顿，在临时副本操作并录制本应用窗口，显示虚拟光标，结束自动生成可编辑剪辑。修改脚本后必须重新确认。需要 screen_recording:read、documents:write、video_edit:write、generation:create、settings:write、application:write、navigation:write 权限。已有配音任务续查，不重付；取消用 cancel_screen_recording_director，已生成文件保留。结果一次剪辑撤销，原始录制保留。',
  aliases: ['开始导演录制', '按脚本录教程'], inputSchema: z.object({ sessionRef, documentRef }).strict(),
  outputSchema: z.object({ resultRef: documentRef, sessionRef, sequenceRefs: z.array(z.object({ kind: z.literal('video_edit.sequence'), id: z.string() }).strict()), verified: z.boolean() }).strict(),
  acceptsRefs: ['screen_recording.session', 'video_edit.document'], producesRefs: ['screen_recording.session', 'video_edit.sequence'], supportsUndo: true,
  resolveOperationTargets: input => [input.sessionRef, input.documentRef], resolveOperationWriteTargets: input => [input.sessionRef, input.documentRef],
  control: capabilityControl('execute', ['screen_recording.session', 'video_edit.document'], { cancelable: true }), summarize: () => '导演录制已生成可编辑成片。',
})
export const cancelRecordingDirectorCapability = defineApplicationCapability({ ...common,
  id: 'cancel_screen_recording_director', title: '取消导演录制', description: '停止此会话正在执行的导演录制，结束采集、清理临时工程并恢复演示设置。已提交配音任务不自动重放，已保存原片与配音保留。',
  aliases: ['停止导演录制'], inputSchema: z.object({ sessionRef }).strict(), outputSchema: z.object({ resultRef: sessionRef, verified: z.boolean() }).strict(),
  acceptsRefs: ['screen_recording.session'], producesRefs: ['screen_recording.session'], resolveOperationTargets: input => [input.sessionRef],
  control: capabilityControl('execute', ['screen_recording.session']), summarize: () => '已请求停止导演录制。',
})
export const redubRecordingCapability = defineApplicationCapability({ ...common,
  id: 'redub_screen_recording_sentence', title: '修改录制旁白并重新配音',
  description: '选择录制成片中带文字稿的音频片段，修改一句文字并重新配音。沿正式生成付费策略使用原导演音色或指定 voice（可选择已复刻音色），不重新生成其他句子。小幅延长轻微放慢画面，较大延长插入末帧并后移后续内容；同步字幕、淡入淡出及响度。rerecord=true 复用操作脚本重录对应步骤，需要额外 application:write、settings:write、navigation:write 权限；先产生一次画面撤销，再产生一次配音撤销。普通补录一次剪辑撤销。需 screen_recording:read、video_edit:write、generation:create、documents:write 权限。已编辑为重叠声音、动画或锁轨时拒绝自动对齐。',
  aliases: ['改文字稿补录', '重新配这一句'],
  inputSchema: z.object({ sessionRef, clipRef: z.object({ kind: z.literal('video_edit.clip'), id: z.string().min(1) }).strict(), text: z.string().trim().min(1).max(2000), voice: recordingVoiceSchema.optional(), rerecord: z.boolean().default(false) }).strict(),
  outputSchema: z.object({ resultRef: z.object({ kind: z.literal('video_edit.clip'), id: z.string() }).strict(), verified: z.boolean(), undoSteps: z.number().int().min(1).max(2) }).strict(),
  acceptsRefs: ['screen_recording.session', 'video_edit.clip'], producesRefs: ['video_edit.clip'], supportsUndo: true,
  resolveOperationTargets: input => [input.sessionRef, input.clipRef], resolveOperationWriteTargets: input => [input.sessionRef, input.clipRef],
  control: capabilityControl('execute', ['screen_recording.session', 'video_edit.clip'], { cancelable: true }), summarize: () => '旁白、字幕及画面对齐已更新，可在剪辑中撤销。',
})
export const recordingDirectorCapabilities = [planRecordingDirectorCapability, startRecordingDirectorCapability, cancelRecordingDirectorCapability, redubRecordingCapability]
