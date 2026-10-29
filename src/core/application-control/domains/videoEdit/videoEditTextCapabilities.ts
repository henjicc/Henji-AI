import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '../../../videoEdit/time'
import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { videoEditTextSelectorSchema } from '../../../videoEdit/textTranscript'
import { normalizeTranscriptSearch } from '../../../media/transcriptSearch'
const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document'); const sequenceRef = ref('video_edit.sequence')
const input = z.object({ documentRef, sequenceRef, selector: videoEditTextSelectorSchema, frame: z.number().int().nonnegative().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES).optional(), name: z.string().trim().min(1).max(200).optional() }).strict()
const output = z.object({ documentRef, resultRef: sequenceRef, ranges: z.array(z.object({ from: z.number().int().nonnegative(), to: z.number().int().positive() }).strict()), changed: z.boolean(), verified: z.boolean(), message: z.string() }).strict()
export const VIDEO_EDIT_TEXT_CAPABILITIES = ([
  ['ripple_delete_video_edit_text', '按文本波纹删除剪辑范围', 'delete', '波纹删除对应视频、链接声音及其他轨道并闭合间隙，返回实际删除的原时间线半开帧范围。'],
  ['extract_video_edit_text', '按文本提取到新序列', 'extract', '把匹配内容及同时间段音画复制成紧凑的新序列，原序列保留，返回新序列供导出或继续编辑。'],
  ['insert_video_edit_text', '按文本插入剪辑', 'insert', '复制匹配内容，在 frame 指定的播放头帧插入并把后方音画一起后移；必须给 frame，原片段保留。'],
] as const).map(([id, title, action, description]) => defineApplicationCapability<z.infer<typeof input>, z.infer<typeof output>>({
  id, title, description: `${description} 优先 query_video_edit_transcript 局部检索，selector 直接使用返回的 match 候选；原剪辑改变后候选失效，须重新查询。也可读 video_edit.sequence.transcript（含当前词索引、原文、from/to帧、可编辑标记）。selector：words.ranges 使用含首尾的 start/end 词索引；text.text 按规范化原文匹配（忽略标点、空白、全半角与英文大小写），occurrence 为从0开始的第几次，省略匹配全部；不猜语义。fillers 删除口头禅，默认嗯、呃、额、啊、那个，可给 words；silence 使用口播音频检测且保留自然短停顿，请先调用 detect_video_edit_text_silence。词级时间按修剪、速度、倒放自动换算。句级识别或受保护内容拒绝编辑；经过锁定音画轨道整批拒绝。一步撤销，无付费识别。`,
  version: 1, domain: 'video_edit', aliases: [title, '基于文本的剪辑', ...(action === 'delete' ? ['删掉所有口头禅', '删除静音', '文本波纹删除'] : action === 'extract' ? ['把讲价格的那段提出来'] : ['文字插入到播放头'])],
  readOnly: false, dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: action === 'delete', timeoutMs: 30000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence'], producesRefs: ['video_edit.sequence'], inputSchema: action === 'insert' ? input.omit({ name: true }).required({ frame: true }) : action === 'extract' ? input.omit({ frame: true }) : input.omit({ frame: true, name: true }), outputSchema: output,
  concurrencyKey: 'video_edit', resolveConcurrencyKey: value => `video_edit:${value.documentRef.id}`, resolveOperationTargets: value => [value.documentRef, value.sequenceRef], resolveOperationWriteTargets: value => [value.documentRef, value.sequenceRef],
  control: capabilityControl('execute', ['video_edit.sequence'], { revisionScopes: ['video_edit'], alsoImpacts: [{ effect: 'execute', entityTypes: ['video_edit.document'] }] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: false, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, value) => value.changed ? [{ effect: 'execute' as const, entityTypes: ['video_edit.sequence'], propertyIds: [], targetRefs: [value.resultRef], count: 1, verified: value.verified, evidence: value.verified ? ['文本对应剪辑范围已保存并回读核对。'] : [] }] : [],
  summarize: value => value.message,
}))
export const queryVideoEditTranscriptCapability = defineApplicationCapability({
  id: 'query_video_edit_transcript', title: '按文字或时间查询剪辑转录',
  description: '免费只读查询已有转录与校对字幕，不识别、不计费、不切换页面。text 忽略标点、空白、全半角与英文大小写；省略则按段浏览。from/to 为半开序列整数帧，可限定 clipRef（含链接声音）或 itemRef。matchSource 区分 asr 原始转录与 caption 校对字幕；字幕命中没有精确词源时不可直接剪。返回局部文字、上下文、源素材微秒、序列帧及精度。用返回 selector 交给文本删除/提取/插入，剪辑改变、关闭或候选被回收后须重新查询。分页时重复原查询条件并带 nextCursor；每个剪辑保留最近四次查询。',
  version: 1, domain: 'video_edit', aliases: ['找某句话', '搜索口播', '查转录稿', '字幕检索'], readOnly: true, dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 30000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip', 'video_edit.item'], producesRefs: [],
  inputSchema: z.object({ documentRef, sequenceRef, text: z.string().trim().min(1).max(500).refine(value => Boolean(normalizeTranscriptSearch(value)), 'text 须包含文字或数字。').optional(),
    from: z.number().int().nonnegative().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES).optional(), to: z.number().int().positive().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES).optional(),
    clipRef: ref('video_edit.clip').optional(), itemRef: ref('video_edit.item').optional(), matchSource: z.enum(['all', 'asr', 'caption']).default('all'), contextWords: z.number().int().min(0).max(20).default(6), cursor: z.string().min(1).max(100).optional(), limit: z.number().int().min(1).max(50).default(20),
  }).strict().refine(value => value.from === undefined || value.to === undefined || value.to > value.from, 'to 必须大于 from。'),
  outputSchema: z.object({ documentRef, sequenceRef, total: z.number().int().nonnegative(), nextCursor: z.string().nullable(), message: z.string(), matches: z.array(z.object({
    matchId: z.string(), text: z.string().max(4000), before: z.string().max(4000), after: z.string().max(4000), from: z.number().int().nonnegative(), to: z.number().int().positive(), source: z.enum(['asr', 'caption']), precision: z.enum(['word', 'segment', 'caption']), editable: z.boolean(), clipRef: ref('video_edit.clip').optional(), itemRef: ref('video_edit.item').optional(), sourceRange: z.object({ startUs: z.number().int().nonnegative(), endUs: z.number().int().positive() }).strict().optional(), selector: z.object({ kind: z.literal('match'), matchId: z.string() }).strict().optional(),
  }).strict()).max(50) }).strict(),
  resolveOperationTargets: value => [value.documentRef, value.sequenceRef, ...(value.clipRef ? [value.clipRef] : []), ...(value.itemRef ? [value.itemRef] : [])], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.sequence'], { revisionScopes: ['video_edit'] }), summarize: value => value.message,
})
export const detectVideoEditTextSilenceCapability = defineApplicationCapability({
  id: 'detect_video_edit_text_silence', title: '检测文本剪辑停顿', description: '用已保存的口播声音免费检测真实静音，复用口播噪声阈值、停顿阈值和保留时长；记录到转录稿，不删除媒体。完成后读序列 transcript 或用 ripple_delete_video_edit_text 的 silence 选择器清理。提供 clipRef 时直接检测该片段声音并只返回序列帧 ranges，无需转录稿且不修改序列；该分支的结果可供人工或算法检查，不会填充文本剪辑 silence 选择器。不会发起付费识别。',
  version: 2, domain: 'video_edit', aliases: ['检测静音', '文本剪辑停顿'], readOnly: false, dataClasses: ['C1'], permission: 'video_edit:write', idempotent: true, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip'], producesRefs: ['video_edit.sequence'], inputSchema: z.object({ documentRef, sequenceRef, clipRef: ref('video_edit.clip').optional().describe('提供片段时直接检测原声音并返回序列帧范围，不要求序列转录稿，不修改转录稿。') }).strict(), outputSchema: output,
  concurrencyKey: 'video_edit', resolveConcurrencyKey: value => `video_edit:${value.documentRef.id}`, resolveOperationTargets: value => [value.documentRef, value.sequenceRef], resolveOperationWriteTargets: value => [value.documentRef, value.sequenceRef],
  control: capabilityControl('execute', ['video_edit.sequence'], { revisionScopes: ['video_edit'], cancelable: true }),
  verificationContract: { kind: 'effect_receipt', requireEffects: false, requireVerifiedEffects: true }, resolveObservedEffects: (_input, value) => value.changed ? [{ effect: 'execute' as const, entityTypes: ['video_edit.sequence'], propertyIds: [], targetRefs: [value.resultRef], count: 1, verified: value.verified, evidence: value.verified ? ['音频检测的静音范围已保存并回读。'] : [] }] : [], summarize: value => value.message,
})

export const getVideoEditClipPausesCapability = defineApplicationCapability({
  id: 'get_video_edit_clip_pauses', title: '取片段停顿图', description: '免费只读分析音频/视频片段的停顿，字幕断句、卡点和剪辑共用。读取已有词时间，同时检测真实全频与高频声音低谷；按素材内容及声道选择复用结果，不调用识别、不计费、不切换页面。返回 pauses 与 words 的 startFrame/endFrame 均为序列帧，已考虑片段起点、入点、变速、倒放。breath/punct 只是词间候选，不作为静音证据；silence 来自声音分析，其 cutFrame 为低谷内可用整数帧候选，仍需试听，未提供时没有足够帧精度。words_and_energy 表示同时取得词时间与声音证据。',
  version: 2, domain: 'video_edit', aliases: ['气口', '片段停顿', '字幕断点'], readOnly: true, dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.clip'], producesRefs: [],
  inputSchema: z.object({ clipRef: ref('video_edit.clip'), range: z.object({ from: z.number().int().nonnegative(), to: z.number().int().positive() }).strict().refine(value => value.to > value.from, 'to 必须大于 from。').optional().describe('目标词的半开序列帧范围，可使用转录查询结果的 from/to；只返回附近证据及首尾邻近切点候选。'), searchMs: z.number().min(50).max(1000).default(300).describe('在目标首尾附近寻找气口的播放时长，毫秒。'), retainedMs: z.number().min(0).max(1000).default(120).describe('低谷内建议保留的自然停顿时长，毫秒；只生成候选，不修改作品。') }).strict(),
  outputSchema: z.object({ clipRef: ref('video_edit.clip'), source: z.enum(['words_and_energy', 'energy']), pauses: z.array(z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().nonnegative(), durationMs: z.number().nonnegative(), kind: z.enum(['silence', 'breath', 'punct']), cutFrame: z.number().int().nonnegative().optional() }).strict()), words: z.array(z.object({ text: z.string(), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict()), cutCandidates: z.array(z.object({ boundary: z.enum(['start', 'end']), targetFrame: z.number().int().nonnegative(), cutFrame: z.number().int().nonnegative(), retainedFromFrame: z.number().int().nonnegative(), retainedToFrame: z.number().int().nonnegative() }).strict()).max(2), message: z.string() }).strict(),
  control: capabilityControl('observe', ['video_edit.clip'], { cancelable: true }), summarize: value => value.message,
})
