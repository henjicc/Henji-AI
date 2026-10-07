import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { videoEditDuckingSettingsSchema } from '../../../videoEdit/audioDucking'

const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const clipRef = applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict()
const input = z.object({ documentRef, musicClipRefs: z.array(clipRef).min(1).describe('同一序列里已标为 music 的声音片段；先用 video_edit.clip.audio_role 通用属性标注音乐及对话或音效。'), settings: videoEditDuckingSettingsSchema }).strict()
const output = z.object({ resultRef: documentRef, clipRefs: z.array(clipRef).min(1), message: z.string(), verified: z.boolean() }).strict()
export const generateVideoEditAudioDuckingCapability = defineApplicationCapability<z.infer<typeof input>, z.infer<typeof output>>({
  id: 'generate_video_edit_audio_ducking', title: '对话出现时自动压低背景音乐',
  description: '在明确音乐片段上自动生成音量回避关键帧，可一步撤销。targetRole 指定对话 dialogue 或音效 sound_effect；分析同时间可听目标片段的非静音区间，不是语义识别，目标中残留音乐或噪声也可能触发。reductionDb 为降低分贝（12 常用，越大越低），sensitivity 0–100（越高越能捕获轻声），fadeSeconds 为语音前压低及结束后恢复的时长。重新生成只替换回避生成的点，用户点保留且同帧优先；需保护原手动曲线时先试听。静音目标或无重叠目标会清除旧回避点。只分析本地声音，未调用付费模型。',
  version: 1, domain: 'video_edit', aliases: ['回避', '自动闪避', 'audio ducking', '基本声音'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit'],
  acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['video_edit.document', 'video_edit.clip'],
  inputSchema: input, outputSchema: output, concurrencyKey: 'video_edit', resolveConcurrencyKey: parsed => `video_edit:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef, ...parsed.musicClipRefs], resolveOperationWriteTargets: parsed => parsed.musicClipRefs,
  control: capabilityControl('update', ['video_edit.clip'], { propertyIds: ['video_edit.clip.volume.keyframes'], cancelable: true, revisionScopes: ['video_edit'] }),
  summarize: result => result.message, verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'update', entityTypes: ['video_edit.clip'], propertyIds: ['video_edit.clip.volume.keyframes'], targetRefs: result.clipRefs, count: result.clipRefs.length, verified: result.verified, evidence: result.verified ? ['已从保存后的剪辑回读核对音量关键帧。'] : [] }],
})
