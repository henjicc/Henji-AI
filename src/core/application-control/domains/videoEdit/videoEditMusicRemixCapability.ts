import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document')
const clipRef = ref('video_edit.clip')

const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('seconds'), seconds: z.number().min(1).max(3600).describe('目标总时长（秒），按序列帧率取整到帧。') }).strict(),
  z.object({ kind: z.literal('frames'), frames: z.number().int().min(1).describe('目标总时长（序列帧）。') }).strict(),
  z.object({ kind: z.literal('sequence_end') }).strict().describe('让音乐结束在序列里其他内容的结尾（PR“对齐到序列出点”）。'),
  z.object({ kind: z.literal('clip_end'), clipRef: clipRef.describe('让音乐结束在这个片段的出点。') }).strict(),
])

export const remixVideoEditMusicCapability = defineApplicationCapability({
  id: 'remix_video_edit_music', version: 1, domain: 'video_edit', title: '音频重构到时长',
  description: '对标 PR“重新混合”：把一段音乐自动重新拼接到目标时长（可加长也可缩短，精确到帧）。先用节拍模型分析拍与小节（首次自动下载约 190 MB，失败时退回较粗的节拍估计；结果按文件内容缓存），再在小节位置相同、前后都相似的拍之间找跳转点，保留前奏与尾奏，结果替换为同一轨道上的一组子片段，接缝放在起音前并加 2 帧恒定功率交叉淡化，多出的不足一小节在结尾截掉并淡出。整次一步撤销。clipRef 为音频片段；已重构过的子片段再次调用会按记录的原始范围用新参数重算整组。repetition 0 尽量不让同一小段反复出现（循环取长），1 允许短循环；granularity beat 可在任意拍跳转（接缝多、最贴近目标），bar 只在小节线跳转（默认），phrase 只在乐句起点跳转、至少隔 4 小节（接缝最少）。seed 换不同的变体。自由节奏（散板、rubato、氛围铺底）会被拒绝并说明原因，不硬剪。返回每个接缝的帧位置与把握（0–1，越高越不易听出），也可沿 video_edit.clip.remix 读回；结构摘要沿 video_edit.media.music_structure 读取。片段须未链接画面、无变速和关键帧，结果范围内同轨不能有其他片段。仅本地计算，不调用付费模型。',
  aliases: ['重新混合', '音乐重构', '音乐时长', '拼接到时长', '对齐音乐长度', 'remix', 'music retarget'], readOnly: false, dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit'],
  acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip'], producesRefs: ['video_edit.clip'],
  inputSchema: z.object({
    documentRef, sequenceRef: ref('video_edit.sequence'), clipRef: clipRef.describe('要重构的音频片段（或某次重构的任一子片段）。'), target,
    repetition: z.number().min(0).max(1).default(0.5).describe('重复程度 0–1：0 尽量不重复同一小段，1 允许短循环反复。'),
    granularity: z.enum(['beat', 'bar', 'phrase']).default('bar').describe('切分粒度：beat 任意拍、bar 小节线（默认）、phrase 乐句起点。'),
    seed: z.number().int().min(0).max(2 ** 31 - 1).default(0).describe('0 为最佳结果；其他值得到可复现的不同变体。'),
  }).strict(),
  outputSchema: z.object({
    documentRef, resultRefs: z.array(clipRef), remixId: z.string(), startFrame: z.number().int().nonnegative(), targetFrames: z.number().int().positive(),
    seams: z.array(z.object({ frame: z.number().int().nonnegative(), confidence: z.number().min(0).max(1), kind: z.enum(['repeat', 'skip']), fromSeconds: z.number(), toSeconds: z.number() }).strict()),
    trimmedSeconds: z.number().nonnegative(),
    analysis: z.object({ tempo: z.number(), beatsPerBar: z.number().int(), beatSource: z.enum(['beat_this', 'spectral_flux']), cached: z.boolean(), model: z.enum(['used', 'fallback']) }).strict(),
    message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string() }).strict(),
  }).strict(),
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef, input.sequenceRef, input.clipRef], resolveOperationWriteTargets: input => [input.sequenceRef],
  control: capabilityControl('execute', ['video_edit.clip', 'video_edit.transition'], { cancelable: true, revisionScopes: ['video_edit'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'execute', entityTypes: ['video_edit.clip'], propertyIds: [], targetRefs: result.resultRefs, count: result.resultRefs.length, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
})
