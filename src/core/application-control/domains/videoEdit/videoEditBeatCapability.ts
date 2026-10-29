import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const sequenceRef = applicationRefSchema.extend({ kind: z.literal('video_edit.sequence') }).strict()
const clipRef = applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict()
const markerRef = applicationRefSchema.extend({ kind: z.literal('video_edit.marker') }).strict()
export const analyzeVideoEditBeatsCapability = defineApplicationCapability({
  id: 'analyze_video_edit_beats', title: '分析节拍', description: '分析明确音频片段或序列混音，生成节拍标记和相对重音强度，可一步撤销。clipRef 指定带声音的片段；省略则分析 sequenceRef 的可听混音。重新分析替换同一来源的旧节拍标记，普通标记保留。mediaRef 指定原音频或视频素材时只离线分析，不创建标记；不可与 clipRef 同时使用。BPM、节拍和起音秒数沿 video_edit.media.audio_analysis 读取，未分析为 null。四拍小节相位是估计值。结果沿 video_edit.marker 通用实体读取；片段 snap_to_beat 属性控制整理时吸附，钉点优先。仅本地计算，不调用付费模型。',
  version: 1, domain: 'video_edit', aliases: ['卡鼓点', '音乐节拍', 'beat detection'], readOnly: false, dataClasses: ['C1'], idempotent: false, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip', 'video_edit.media'], producesRefs: ['video_edit.marker'],
  inputSchema: z.object({ documentRef, sequenceRef, clipRef: clipRef.optional(), mediaRef: applicationRefSchema.extend({ kind: z.literal('video_edit.media') }).strict().optional() }).strict(),
  outputSchema: z.object({ resultRef: documentRef, markerRefs: z.array(markerRef), audio: z.object({ bpm: z.number(), beats: z.array(z.number()), onsets: z.array(z.number()), beatsPerBar: z.number(), barOrigin: z.number() }).strict().optional(), message: z.string(), verified: z.boolean() }).strict(),
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef, input.sequenceRef, ...(input.clipRef ? [input.clipRef] : []), ...(input.mediaRef ? [input.mediaRef] : [])], resolveOperationWriteTargets: input => [input.sequenceRef],
  control: capabilityControl('execute', ['video_edit.sequence', 'video_edit.marker'], { cancelable: true, revisionScopes: ['video_edit'], alsoImpacts: [{ effect: 'execute', entityTypes: ['video_edit.media'], propertyIds: ['video_edit.media.audio_analysis'] }] }),
  summarize: result => result.message, verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (input, result) => input.mediaRef ? [{ effect: 'execute', entityTypes: ['video_edit.media'], propertyIds: ['video_edit.media.audio_analysis'], targetRefs: [input.mediaRef], count: 1, verified: result.verified, evidence: result.verified ? ['已读回原素材音频分析缓存。'] : [] }] : [{ effect: 'execute', entityTypes: ['video_edit.marker'], propertyIds: [], targetRefs: result.markerRefs, count: result.markerRefs.length, verified: result.verified, evidence: result.verified ? ['已从保存后的剪辑核对节拍标记。'] : [] }],
})
