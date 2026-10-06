import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { videoEditTextSelectorSchema } from '../../../videoEdit/textTranscript'
const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document'); const sequenceRef = ref('video_edit.sequence')
const input = z.object({ documentRef, sequenceRef, selector: videoEditTextSelectorSchema, frame: z.number().int().nonnegative().max(108000).optional(), name: z.string().trim().min(1).max(200).optional() }).strict()
const output = z.object({ documentRef, resultRef: sequenceRef, ranges: z.array(z.object({ from: z.number().int().nonnegative(), to: z.number().int().positive() }).strict()), changed: z.boolean(), verified: z.boolean(), message: z.string() }).strict()
export const VIDEO_EDIT_TEXT_CAPABILITIES = ([
  ['ripple_delete_video_edit_text', '按文本波纹删除剪辑范围', 'delete', '波纹删除对应视频、链接声音及其他轨道并闭合间隙，返回实际删除的原时间线半开帧范围。'],
  ['extract_video_edit_text', '按文本提取到新序列', 'extract', '把匹配内容及同时间段音画复制成紧凑的新序列，原序列保留，返回新序列供导出或继续编辑。'],
  ['insert_video_edit_text', '按文本插入剪辑', 'insert', '复制匹配内容，在 frame 指定的播放头帧插入并把后方音画一起后移；必须给 frame，原片段保留。'],
] as const).map(([id, title, action, description]) => defineApplicationCapability<z.infer<typeof input>, z.infer<typeof output>>({
  id, title, description: `${description} 先读 video_edit.sequence.transcript（含当前词索引、原文、from/to帧、可编辑标记）。selector：words.ranges 使用含首尾的 start/end 词索引；text.text 用稿子中的原文，occurrence 为从0开始的第几次，省略匹配全部；不猜语义，想提取讲价格的一段先读稿选择对应索引。fillers 删除口头禅，默认嗯、呃、额、啊、那个，可给 words；silence 使用口播音频检测且保留自然短停顿，请先调用 detect_video_edit_text_silence。词级时间按修剪、速度、倒放自动换算。句级识别或受保护内容拒绝编辑；经过锁定音画轨道整批拒绝。一步撤销，无付费识别。`,
  version: 1, domain: 'video_edit', aliases: [title, '基于文本的剪辑', ...(action === 'delete' ? ['删掉所有口头禅', '删除静音', '文本波纹删除'] : action === 'extract' ? ['把讲价格的那段提出来'] : ['文字插入到播放头'])],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: action === 'delete', timeoutMs: 30000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence'], producesRefs: ['video_edit.sequence'], inputSchema: input.superRefine((value, context) => {
    if (action === 'insert' && value.frame === undefined) context.addIssue({ code: 'custom', path: ['frame'], message: '插入必须指定播放头帧。' })
    if (action !== 'insert' && value.frame !== undefined) context.addIssue({ code: 'custom', path: ['frame'], message: 'frame 只用于插入。' })
    if (action !== 'extract' && value.name !== undefined) context.addIssue({ code: 'custom', path: ['name'], message: 'name 只用于提取的新序列。' })
  }), outputSchema: output,
  concurrencyKey: 'video_edit', resolveConcurrencyKey: value => `video_edit:${value.documentRef.id}`, resolveOperationTargets: value => [value.documentRef, value.sequenceRef], resolveOperationWriteTargets: value => [value.documentRef, value.sequenceRef],
  control: capabilityControl('execute', ['video_edit.sequence'], { revisionScopes: ['video_edit'], alsoImpacts: [{ effect: 'execute', entityTypes: ['video_edit.document'] }] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: false, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, value) => value.changed ? [{ effect: 'execute' as const, entityTypes: ['video_edit.sequence'], propertyIds: [], targetRefs: [value.resultRef], count: 1, verified: value.verified, evidence: value.verified ? ['文本对应剪辑范围已保存并回读核对。'] : [] }] : [],
  summarize: value => value.message,
}))
export const detectVideoEditTextSilenceCapability = defineApplicationCapability({
  id: 'detect_video_edit_text_silence', title: '检测文本剪辑停顿', description: '用已保存的口播声音免费检测真实静音，复用口播噪声阈值、停顿阈值和保留时长；记录到转录稿，不删除媒体。完成后读序列 transcript 或用 ripple_delete_video_edit_text 的 silence 选择器清理。没有转录稿时先用既有字幕转录流程；不会发起付费识别。',
  version: 1, domain: 'video_edit', aliases: ['检测静音', '文本剪辑停顿'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: true, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence'], producesRefs: ['video_edit.sequence'], inputSchema: z.object({ documentRef, sequenceRef }).strict(), outputSchema: output,
  concurrencyKey: 'video_edit', resolveConcurrencyKey: value => `video_edit:${value.documentRef.id}`, resolveOperationTargets: value => [value.documentRef, value.sequenceRef], resolveOperationWriteTargets: value => [value.documentRef, value.sequenceRef],
  control: capabilityControl('execute', ['video_edit.sequence'], { revisionScopes: ['video_edit'], cancelable: true }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true }, resolveObservedEffects: (_input, value) => [{ effect: 'execute' as const, entityTypes: ['video_edit.sequence'], propertyIds: [], targetRefs: [value.resultRef], count: 1, verified: value.verified, evidence: value.verified ? ['音频检测的静音范围已保存并回读。'] : [] }], summarize: value => value.message,
})
