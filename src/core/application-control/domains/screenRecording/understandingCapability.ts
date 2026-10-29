import { z } from 'zod'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'

export const understandRecordingCapability = defineApplicationCapability({
  id: 'understand_screen_recording', version: 1, domain: 'screen_recording', title: '理解录制并生成步骤',
  description: '分析已停止或恢复的会话，以能力调用、窗口切换、点击簇、画面和文字稿生成步骤、章节、停顿、等待与失误候选。默认免费复用已有文字稿；开启 transcribe 后按当前语音模型及付费策略识别，需要 audio_edit:write，可能创建口播文档保存识别结果，已有文字稿不重复计费。候选只供审阅，不剪原片。替换整份理解结果，返回 undoRef 可撤销本次理解修改；已付费的口播结果保留。用 screen_recording.understanding.result 通用读改。',
  aliases: ['录屏切分', '录制步骤', '等待段', '录屏转写'], readOnly: false, dataClasses: ['C1'], mayRequirePaidConfirmation: true,
  idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: true, requiredScopes: [], concurrencyKey: 'screen_recording',
  inputSchema: z.object({ sessionRef: z.object({ kind: z.literal('screen_recording.session'), id: z.string().uuid() }).strict(),
    transcribe: z.boolean().default(false).describe('开启后可能上传音频并产生识别费用，遵守用户付费策略；默认只读取已有转写'),
    detectVisuals: z.boolean().default(true).describe('在本地检测画面变化与静止；关闭后不生成等待加速候选'),
  }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: z.object({ kind: z.literal('screen_recording.understanding'), id: z.string() }).strict(), steps: z.number().int().nonnegative(), candidates: z.number().int().nonnegative(), audioUpdates: z.array(z.object({ ref: z.object({ kind: z.literal('audio_edit.document'), id: z.string() }).strict(), created: z.boolean(), transcribed: z.boolean() }).strict()), undoRef: z.string().optional(), verified: z.boolean() }),
  acceptsRefs: ['screen_recording.session'], producesRefs: ['screen_recording.understanding', 'audio_edit.document'],
  resolveOperationTargets: input => [input.sessionRef, { kind: 'screen_recording.understanding', id: input.sessionRef.id }],
  resolveOperationWriteTargets: input => [{ kind: 'screen_recording.understanding', id: input.sessionRef.id }],
  resolveConcurrencyKey: input => `screen_recording:${input.sessionRef.id}`,
  control: capabilityControl('update', ['screen_recording.understanding'], { cancelable: true, alsoImpacts: [{ effect: 'create', entityTypes: ['audio_edit.document'] }, { effect: 'update', entityTypes: ['audio_edit.document'] }] }),
  resolveObservedEffects: (_input, value) => [
    { effect: 'update', entityTypes: ['screen_recording.understanding'], propertyIds: ['screen_recording.understanding.result'], targetRefs: [value.resultRef], count: 1, verified: value.verified, evidence: value.verified ? ['理解结果已保存回读。'] : [] },
    ...value.audioUpdates.map(update => ({ effect: update.created ? 'create' as const : 'update' as const, entityTypes: ['audio_edit.document'], propertyIds: [], targetRefs: [update.ref], count: 1, verified: true, evidence: ['口播识别结果已保存。'] })),
  ],
  summarize: result => `已生成 ${result.steps} 个步骤和 ${result.candidates} 个剪辑候选，可读取和校正。`,
})
