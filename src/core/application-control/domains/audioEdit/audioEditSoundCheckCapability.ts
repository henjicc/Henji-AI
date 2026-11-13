import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { audioEditSoundCheckDeltaSchema, audioEditSoundCheckSchema } from '../../../audioEdit/soundCheck'

const documentRef = applicationRefSchema.extend({
  kind: z.literal('audio_edit.document'),
  id: z.string().min(1).max(500).describe('口播文档 ID：取自 list_documents（kind=audio_edit）返回的 id'),
}).strict()
const input = z.object({
  documentRef,
  startSeconds: z.number().finite().nonnegative().optional().describe('只测这一段时的开始，剪后作品时间（秒），与 audio_edit.caption 的 start_ms ÷ 1000 同一坐标；省略从头'),
  endSeconds: z.number().finite().positive().optional().describe('只测这一段时的结束（剪后作品时间，秒）；省略到结尾'),
  windowSeconds: z.number().finite().min(1).max(600).optional().describe('分段长度（秒），默认 10；用于找偏响、偏轻的段'),
  includeWindows: z.boolean().optional().describe('true 时逐段列出全部分段响度，并给出全部削波与过长停顿的位置；默认只给整体、关键段和各最多 8 处位置'),
}).strict()
const output = z.object({
  resultRef: documentRef,
  check: audioEditSoundCheckSchema,
  sinceLastCheck: audioEditSoundCheckDeltaSchema.optional(),
  message: z.string(),
  verified: z.boolean(),
}).strict()
export type CheckAudioEditSoundInput = z.infer<typeof input>
export type CheckAudioEditSoundOutput = z.infer<typeof output>

export const checkAudioEditSoundCapability = defineApplicationCapability<CheckAudioEditSoundInput, CheckAudioEditSoundOutput>({
  id: 'check_audio_edit_sound', title: '读回口播成品的声音',
  description: '只读检查口播剪好的成品现在听起来怎样：测的是剪切、修复、效果控件与输出都生效后的整条声音（和导出的 WAV 同一份）。'
    + '给出整体积分响度 LUFS、响度范围 LRA、4 倍重建真峰值 dBTP（与 measure_video_edit_loudness 同一口径）与采样峰值；削波（满刻度或平顶）的处数与位置；'
    + '静音段合计、开头结尾静音和超过口播批量设置检测时长的过长停顿位置；底噪电平与是否疑似 50/60 Hz 电源嗡声；偏响、偏轻、有削波的关键分段；issues 用一句话列出发现的问题。'
    + '时间一律是剪后作品时间（秒），与 audio_edit.caption 的 start_ms ÷ 1000、insert_audio_edit_file 的 positionSeconds 同一坐标。'
    + '降噪、匹配响度、快速处理、呼吸、停顿、修复或改效果与输出之后调用一次，核对处理是否达到目的；同一范围上次读回后口播改过时，sinceLastCheck 给出本次减上次的差值。'
    + '要修嗡声或底噪，在 audio_edit.document.effect_chain 的基本声音（essential）里打开 repair 的 hum（国内 mains=50）或 noise；有削波时先查输出音量（audio_edit.document.output）和效果控件里加增益的项是否过大，成段削波去爆音修不了（单段上限 128 毫秒），修复区域用原素材采样帧，不是这里的剪后秒。免费，不改口播；长口播需先渲染成品，可能要几十秒。',
  version: 1, domain: 'audio_edit', aliases: ['口播响度读回', '声音检查', '真峰值', '削波检测', '嗡声检测', '底噪', 'sound check'], readOnly: true, dataClasses: ['C1'], idempotent: true, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: false, requiredScopes: ['audio_edit'], acceptsRefs: ['audio_edit.document'], producesRefs: ['audio_edit.document'],
  inputSchema: input, outputSchema: output, concurrencyKey: 'audio_edit', resolveConcurrencyKey: parsed => `audio_edit:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['audio_edit.document'], { cancelable: true, revisionScopes: ['audio_edit'] }), summarize: result => result.message,
  resolveObservedEffects: (_input, result) => [{ effect: 'observe', entityTypes: ['audio_edit.document'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verified, evidence: ['从剪好的成品声音测量，未修改口播。'] }],
})
