import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { videoEditLoudnessMeasurementSchema } from '../../../videoEdit/loudness'

const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const clipRef = applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict()
const input = z.object({ documentRef, clipRefs: z.array(clipRef).min(1).max(256).describe('同一序列中要单独测量或标准化的声音片段；从实体目录读取完整引用。') }).strict()
const output = z.object({ resultRef: documentRef, results: z.array(z.object({ clipRef, volume: z.number().min(0).max(2), measurement: videoEditLoudnessMeasurementSchema })).min(1).max(256), message: z.string(), verified: z.boolean() }).strict()
export const measureVideoEditLoudnessCapability = defineApplicationCapability<z.infer<typeof input>, z.infer<typeof output>>({
  id: 'measure_video_edit_loudness', title: '测量剪辑片段响度与真峰值',
  description: '只读测量明确声音片段的积分 LUFS、末尾三秒短期 LUFS、4 倍重建真峰值 dBTP、采样峰值 dBFS。每段独立测量，包含当前音量、变速、声道映射、淡化与音频效果，忽略轨道静音和相邻片段过渡；不是整片混音。静音、低于门限或太短时 LUFS 为 null，不是零。',
  version: 1, domain: 'video_edit', aliases: ['响度测量', 'LUFS', 'true peak'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['video_edit.document'],
  inputSchema: input, outputSchema: output, concurrencyKey: 'video_edit', resolveConcurrencyKey: parsed => `video_edit:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef, ...parsed.clipRefs], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.clip'], { cancelable: true, revisionScopes: ['video_edit'] }), summarize: result => result.message,
  resolveObservedEffects: (_input, result) => [{ effect: 'observe', entityTypes: ['video_edit.clip'], propertyIds: [], targetRefs: result.results.map(result => result.clipRef), count: result.results.length, verified: result.verified, evidence: ['从明确片段混音测量，未修改音量。'] }],
})
export const normalizeVideoEditLoudnessCapability = defineApplicationCapability<z.infer<typeof input> & { targetLufs: number }, z.infer<typeof output>>({
  id: 'normalize_video_edit_loudness', title: '把对白片段标准化到目标响度',
  description: '先测量每段声音，再计算并调整已有片段音量，重新测量确认与目标相差不超过 0.5 LU；多个片段一步撤销。targetLufs 是积分听感响度：网络视频常用 -14，播客 -16，广播 EBU R128 -23；越接近零越响。效果限制目标或增益超过当前 +6.02 dB 上限时不写入，建议降低目标或在导出整片时用带真峰值限幅的标准化。此操作只改片段增益，不添加限幅效果。',
  version: 1, domain: 'video_edit', aliases: ['对白音量统一', '响度标准化', 'loudness normalization'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['video_edit.document'],
  inputSchema: input.extend({ targetLufs: z.number().finite().min(-70).max(-5).describe('目标积分响度 LUFS；-14 网络视频、-16 播客、-23 EBU R128 广播。') }), outputSchema: output,
  concurrencyKey: 'video_edit', resolveConcurrencyKey: parsed => `video_edit:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef, ...parsed.clipRefs], resolveOperationWriteTargets: parsed => parsed.clipRefs,
  control: capabilityControl('update', ['video_edit.clip'], { propertyIds: ['video_edit.clip.volume'], cancelable: true, revisionScopes: ['video_edit'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'update', entityTypes: ['video_edit.clip'], propertyIds: ['video_edit.clip.volume'], targetRefs: result.results.map(result => result.clipRef), count: result.results.length, verified: result.verified, evidence: result.verified ? ['已重新测量并从剪辑文件回读核对增益。'] : [] }],
})
export const VIDEO_EDIT_LOUDNESS_CAPABILITIES = [measureVideoEditLoudnessCapability, normalizeVideoEditLoudnessCapability]
