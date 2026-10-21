import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document')
const clipRef = ref('video_edit.clip')
const soundRef = ref('sound_library.sound')
const at = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('frame'), frame: z.number().int().nonnegative().describe('序列整数帧。') }).strict(),
  z.object({ kind: z.literal('marker'), markerRef: ref('video_edit.marker').describe('节拍或普通标记，如 analyze_video_edit_beats 生成的节拍。') }).strict(),
  z.object({ kind: z.literal('cut'), clipRef: clipRef.describe('切点所在片段。'), edge: z.enum(['start', 'end']).describe('start 为片段入点（切入），end 为出点（切出）。') }).strict(),
])
export const videoEditSoundEffectPlacementSchema = z.object({
  soundRef: soundRef.describe('search_sound_effects 返回的音效。'),
  at,
  anchor: z.enum(['hit', 'attack']).default('hit').describe('hit：声音最响的击中点对齐到目标时刻（默认，嗖、冲击、叮都用它）；attack：起音点对齐（需要声音从这一刻开始响时用）。'),
  offsetFrames: z.number().int().min(-600).max(600).default(0).describe('在目标时刻基础上提前（负）或推后（正）的帧数。'),
  trackRef: ref('video_edit.track').optional().describe('放到指定音频轨道；省略时找第一条在该区间空闲的音频轨道，没有就新建一条。'),
  gainDb: z.number().min(-40).max(6).optional().describe('片段音量增益 dB；省略为原音量。'),
}).strict()

const placed = z.object({ clipRef, soundRef, startFrame: z.number().int().nonnegative(), targetSeconds: z.number(), anchorSeconds: z.number(), alignedSeconds: z.number(), trimmedHeadSeconds: z.number(), trackRef: ref('video_edit.track') }).strict()

export const placeVideoEditSoundEffectsCapability = defineApplicationCapability({
  id: 'place_video_edit_sound_effects', version: 1, domain: 'video_edit', title: '把音效卡点放进剪辑',
  description: '把音效库里的音效放进明确的剪辑序列，并让音效的击中点（或起音点）精确对齐到指定帧、标记（如节拍）或片段切点；声音在击中点之前的部分若放不下（目标太靠近开头）会自动裁掉开头，对齐精度到微秒。一次最多 64 个，全部进同一步撤销；片段标为“音效”声音类型，自动找空闲音频轨道，没有就新建。音效引用文件夹里的原文件，不复制。完成后保存并回读核对每个音效的击中点时刻。先用 search_sound_effects 挑音效；不会发起付费生成。',
  aliases: ['加音效', '音效卡点', '转场音效', 'add sound effect', 'sfx sync'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit', 'sound_library'],
  acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.marker', 'video_edit.clip', 'video_edit.track', 'sound_library.sound'], producesRefs: ['video_edit.clip'],
  inputSchema: z.object({ documentRef, sequenceRef: ref('video_edit.sequence'), placements: z.array(videoEditSoundEffectPlacementSchema).min(1).max(64) }).strict(),
  outputSchema: z.object({ resultRefs: z.array(clipRef), documentRef, placements: z.array(placed), message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string() }).strict() }).strict(),
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef, input.sequenceRef], resolveOperationWriteTargets: input => [input.sequenceRef],
  control: capabilityControl('execute', ['video_edit.clip'], { cancelable: true, revisionScopes: ['video_edit'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'execute', entityTypes: ['video_edit.clip'], propertyIds: [], targetRefs: result.resultRefs, count: result.resultRefs.length, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
})
