import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '../../../videoEdit/time'
import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const clipRef = applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict()
export const rippleVideoEditClipSpeedCapability = defineApplicationCapability({
  id: 'ripple_video_edit_clip_speed', version: 1, domain: 'video_edit', title: '改变片段速度并波纹调整后续片段',
  description: '与速度/持续时间对话框勾选“波纹编辑”同一操作：改变视频、声音或代码片段速度，自动按实际时长变化移动它们所在轨道的后续片段；一次编辑、一次撤销。默认按目标序列的链接选择展开音画及编组，linked=false 只改列出的片段。其他轨道不因同步波纹开关单独移动，片段标注、锚定字幕/标记按现有速度编辑规则跟随。速度百分比与持续时间二选一；持续时间保持源内容并反算速度，与普通 duration 属性修剪不同。锁轨、重叠或超过序列24小时边界时整组拒绝，无部分修改。',
  aliases: ['波纹变速', '放慢并后移后续镜头', '加速并前移后续片段'], readOnly: false, risk: 'R1', dataClasses: ['C1'],
  permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 30000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['video_edit.clip'],
  inputSchema: z.object({ documentRef, clipRefs: z.array(clipRef).min(1).describe('同一目标序列中的片段；引用取自 video_edit.clip。'),
    speedPercent: z.number().finite().min(1).max(10000).optional().describe('100 为原速，50 为半速；开头内容不动，时长按实际速度换算。'),
    durationFrames: z.number().int().positive().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES).optional().describe('每个目标片段的新持续时间（帧），保持源内容并反算速度；与 speedPercent 二选一。'),
    reverse: z.boolean().optional(), preservePitch: z.boolean().optional(), linked: z.boolean().optional(),
  }).strict().superRefine((input, context) => {
    if ((input.speedPercent === undefined) === (input.durationFrames === undefined)) context.addIssue({ code: 'custom', path: ['speedPercent'], message: '需要 speedPercent 或 durationFrames 之一，不能同时指定。' })
  }),
  outputSchema: z.object({ resultRef: documentRef, changedClipRefs: z.array(clipRef), message: z.string(),
    verification: z.object({ verified: z.boolean(), target: documentRef, condition: z.string() }).strict(),
  }).strict(),
  resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef, ...input.clipRefs], resolveOperationWriteTargets: input => [input.documentRef],
  control: capabilityControl('execute', ['video_edit.document', 'video_edit.clip'], { revisionScopes: ['video_edit'] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => {
    const receipt = { effect: 'execute' as const, propertyIds: [], verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }
    return [{ ...receipt, entityTypes: ['video_edit.document'], targetRefs: [result.resultRef], count: 1 },
      ...Array.from({ length: Math.ceil(result.changedClipRefs.length / 128) }, (_, index) => {
        const refs = result.changedClipRefs.slice(index * 128, (index + 1) * 128)
        return { ...receipt, entityTypes: ['video_edit.clip'], targetRefs: refs, count: refs.length }
      }),
    ]
  },
  summarize: result => result.message,
})

const rampSchema = z.object({
  atSeconds: z.number().finite().nonnegative().describe('坡道中心的序列时间（秒），即希望变速的那一刻画面所在时间线位置；须在片段范围内。'),
  speedPercent: z.number().finite().min(1).max(10000).describe('坡道处的目标速度百分比，如 20 为升格慢放、400 为快进。'),
  holdSeconds: z.number().finite().min(0).max(600).optional().describe('在目标速度上保持的时间线秒数，默认 0（到达后立刻回到基础速度）。'),
  easeInSeconds: z.number().finite().min(0).max(60).optional().describe('从基础速度过渡到目标速度的时长（秒），默认 0.3，越长越平缓。'),
  easeOutSeconds: z.number().finite().min(0).max(60).optional().describe('从目标速度回到基础速度的时长（秒），默认与 easeInSeconds 相同。'),
}).strict()
export const rampVideoEditClipSpeedCapability = defineApplicationCapability({
  id: 'ramp_video_edit_clip_speed', version: 1, domain: 'video_edit', title: '按时刻或节拍给片段做速度坡道',
  description: '速度坡道（对标 PR 时间重映射、剪映曲线变速）：在片段的指定时刻把速度平滑变到目标速度（如 20% 升格慢放、400% 快进），保持一段后缓出回到基础速度，可一次放多处；snap=beat 把每个时刻吸到最近的节拍标记（先用 analyze_video_edit_beats 生成），snap=marker 吸到最近的任意标记。或用 preset 套用整段曲线预设（蒙太奇、英雄时刻、子弹时间、跳接、闪进、闪出）。片段用到的素材不变，时长随曲线变化；默认波纹调整同轨后续片段，ripple=false 时只用到后面片段之前的空白。默认按链接选择同时改链接的声音，声音随曲线拉伸且默认保持音调（速度曲线超出 25%–400% 时声音不保持音调）。曲线写入 time_remap 属性，可再用通用属性微调或写 null 移除；一次编辑、一次撤销。',
  aliases: ['速度坡道', '曲线变速', '升格慢放', '卡点变速', '时间重映射', 'speed ramp', 'time remap'], readOnly: false, risk: 'R1', dataClasses: ['C1'],
  permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 30000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['video_edit.clip'],
  inputSchema: z.object({ documentRef, clipRef: clipRef.describe('要变速的视频、声音、嵌套序列或代码片段，引用取自 video_edit.clip。'),
    ramps: z.array(rampSchema).max(63).optional().describe('速度坡道列表；与 preset 二选一。'),
    preset: z.enum(['montage', 'hero', 'bullet', 'jump', 'flash_in', 'flash_out']).optional().describe('整段曲线预设：montage 蒙太奇（快-慢-快）、hero 英雄时刻（中段 25% 慢放）、bullet 子弹时间（中段 15%）、jump 跳接（中段 400% 闪过）、flash_in 闪进（开头快进）、flash_out 闪出（结尾快进）。'),
    baseSpeedPercent: z.number().finite().min(1).max(10000).optional().describe('坡道之外的基础速度百分比，默认 100。'),
    snap: z.enum(['none', 'beat', 'marker']).optional().describe('坡道时刻吸附：none（默认）、beat 最近的节拍标记、marker 最近的任意序列标记。'),
    frameInterpolation: z.enum(['nearest', 'blend', 'optical_flow']).optional().describe('慢放补帧：nearest 帧采样、blend 帧混合（慢放更顺）；optical_flow 预留，当前按 blend。省略时有慢于 100% 的坡道就用 blend。'),
    ripple: z.boolean().optional().describe('默认 true：时长变化时同轨后续片段跟着移动。'),
    linked: z.boolean().optional().describe('默认按链接选择同时改链接的声音/画面；false 只改这一个片段。'),
  }).strict().superRefine((input, context) => {
    if (Boolean(input.ramps?.length) === Boolean(input.preset)) context.addIssue({ code: 'custom', path: ['ramps'], message: '需要 ramps（至少一处）或 preset 之一，不能同时指定。' })
  }),
  outputSchema: z.object({ resultRef: documentRef, changedClipRefs: z.array(clipRef), durationFrames: z.number().int().positive(),
    curve: z.array(z.object({ sourceSeconds: z.number(), speedPercent: z.number() }).strict()).describe('写入的曲线点：素材位置（距片段开头的源秒数）与该处速度。'),
    snappedSeconds: z.array(z.number()).describe('每处坡道吸附后的序列时间（秒）。'), message: z.string(),
    verification: z.object({ verified: z.boolean(), target: documentRef, condition: z.string() }).strict(),
  }).strict(),
  resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef, input.clipRef], resolveOperationWriteTargets: input => [input.documentRef],
  control: capabilityControl('execute', ['video_edit.document', 'video_edit.clip'], { revisionScopes: ['video_edit'] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => {
    const receipt = { effect: 'execute' as const, propertyIds: [], verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }
    return [{ ...receipt, entityTypes: ['video_edit.document'], targetRefs: [result.resultRef], count: 1 },
      ...Array.from({ length: Math.ceil(result.changedClipRefs.length / 128) }, (_, index) => {
        const refs = result.changedClipRefs.slice(index * 128, (index + 1) * 128)
        return { ...receipt, entityTypes: ['video_edit.clip'], targetRefs: refs, count: refs.length }
      }),
    ]
  },
  summarize: result => result.message,
})
