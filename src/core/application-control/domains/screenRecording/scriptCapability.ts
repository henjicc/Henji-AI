import { z } from 'zod'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const sessionRef = z.object({ kind: z.literal('screen_recording.session'), id: z.string().uuid() }).strict()
const resultRef = z.object({ kind: z.literal('screen_recording.understanding'), id: z.string() }).strict()
const documentRef = z.object({ kind: z.literal('video_edit.document'), id: z.string().min(1) }).strict()
const common = { version: 1, domain: 'screen_recording', readOnly: false, dataClasses: ['C1' as const],
  idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, requiredScopes: [], concurrencyKey: 'screen_recording',
}
export const generateRecordingScriptCapability = defineApplicationCapability({ ...common,
  id: 'generate_screen_recording_script', title: '生成录制操作脚本',
  description: '将已有步骤和成功的应用操作生成可编辑脚本。先 understand_screen_recording 生成步骤，再调用本操作。可重放范围为剪辑片段位置、缩放、旋转、透明度及序列名称、宽高；缺输入、失败、付费和其他操作会标明不能重放。脚本位于 screen_recording.understanding.result.operationScript，可用通用属性事务编辑标题、参数和完成后停留时间；快照由录制服务保存，不能写入任意代码。',
  aliases: ['操作脚本', '录屏重放脚本'], supportsUndo: true,
  inputSchema: z.object({ sessionRef }).strict(), outputSchema: z.object({ resultRef, steps: z.number().int().nonnegative(), blocked: z.number().int().nonnegative(), undoRef: z.string().optional(), verified: z.boolean() }).strict(),
  acceptsRefs: ['screen_recording.session'], producesRefs: ['screen_recording.understanding'],
  resolveOperationTargets: input => [input.sessionRef, { kind: 'screen_recording.understanding', id: input.sessionRef.id }],
  resolveOperationWriteTargets: input => [{ kind: 'screen_recording.understanding', id: input.sessionRef.id }],
  control: capabilityControl('update', ['screen_recording.understanding'], { cancelable: true }),
  summarize: result => `已生成 ${result.steps} 个脚本步骤，${result.blocked} 步需要重新录制。`,
})
export const replayRecordingCapability = defineApplicationCapability({ ...common,
  id: 'replay_screen_recording_script', title: '在临时副本重放录制',
  description: '在录制开始前快照的临时剪辑副本逐步执行脚本，完成后关闭并清理副本，原工程不变。stepId 可指定重放到哪一步，省略执行全部。只执行支持的免费剪辑属性操作；任何未完成、未知或付费操作在执行前阻断，不自动批准付费。失败立即停止并清理。会显示临时剪辑，需要 screen_recording:read、video_edit:write 和 documents:write。',
  aliases: ['重放脚本', '预演录制'], supportsUndo: false,
  inputSchema: z.object({ sessionRef, stepId: z.string().min(1).optional() }).strict(),
  outputSchema: z.object({ resultRef, completedSteps: z.array(z.string()), replaced: z.number().int().nonnegative(), verified: z.boolean() }).strict(),
  acceptsRefs: ['screen_recording.session'], producesRefs: ['screen_recording.understanding'], resolveOperationTargets: input => [input.sessionRef],
  control: capabilityControl('execute', ['screen_recording.understanding'], { cancelable: true }), summarize: result => `已在临时副本重放 ${result.completedSteps.length} 步，原工程未修改。`,
})
export const rerecordRecordingCapability = defineApplicationCapability({ ...common,
  id: 'rerecord_screen_recording_steps', title: '重录并替换步骤画面',
  description: '在临时剪辑副本重放前置操作并重录 stepId；省略 stepId 重录全部。sourceRef 必须选择当前痕迹AI窗口。生成的新画面替换 documentRef 内引用原录制的对应段落（含嵌套画面序列），按原旁白时段调速对齐，其他画面、旁白、字幕及时间点不变，整批一次剪辑撤销。目标段锁定、倒放、转场或已有确认打码时拒绝，失败不提交半份时间线。操作完成后原片仍保留。需要 screen_recording:read、video_edit:write、documents:write；不支持付费能力重放。',
  aliases: ['一键重录', '重录第二步', '替换录屏画面'], supportsUndo: true,
  inputSchema: z.object({ sessionRef, documentRef, stepId: z.string().min(1).optional(), sourceRef: z.object({ kind: z.literal('screen_recording.source'), id: z.string().regex(/^window:\d+:\d+$/) }).strict() }).strict(),
  outputSchema: z.object({ resultRef: documentRef, completedSteps: z.array(z.string()), replaced: z.number().int().nonnegative(), verified: z.boolean() }).strict(),
  acceptsRefs: ['screen_recording.session', 'screen_recording.source', 'video_edit.document'], producesRefs: ['video_edit.document'],
  resolveOperationTargets: input => [input.sessionRef, input.documentRef, input.sourceRef], resolveOperationWriteTargets: input => [input.documentRef],
  control: capabilityControl('execute', ['video_edit.document'], { cancelable: true }), summarize: result => `已替换 ${result.replaced} 段画面，旁白保持原位，可在剪辑撤销。`,
})
export const recordingScriptCapabilities = [generateRecordingScriptCapability, replayRecordingCapability, rerecordRecordingCapability]
