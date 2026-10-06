import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const clipRef = applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict()
export const rippleVideoEditClipSpeedCapability = defineApplicationCapability({
  id: 'ripple_video_edit_clip_speed', version: 1, domain: 'video_edit', title: '改变片段速度并波纹调整后续片段',
  description: '与速度/持续时间对话框勾选“波纹编辑”同一操作：改变视频、声音或代码片段速度，自动按实际时长变化移动它们所在轨道的后续片段；一次编辑、一次撤销。默认按目标序列的链接选择展开音画及编组，linked=false 只改列出的片段。其他轨道不因同步波纹开关单独移动，片段标注、锚定字幕/标记按现有速度编辑规则跟随。速度百分比与持续时间二选一；持续时间保持源内容并反算速度，与普通 duration 属性修剪不同。锁轨、重叠或超过序列30分钟上限时整组拒绝，无部分修改。',
  aliases: ['波纹变速', '放慢并后移后续镜头', '加速并前移后续片段'], readOnly: false, risk: 'R1', dataClasses: ['C1'],
  permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 30000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['video_edit.clip'],
  inputSchema: z.object({ documentRef, clipRefs: z.array(clipRef).min(1).max(500).describe('同一目标序列中的片段；引用取自 video_edit.clip。'),
    speedPercent: z.number().finite().min(1).max(10000).optional().describe('100 为原速，50 为半速；开头内容不动，时长按实际速度换算。'),
    durationFrames: z.number().int().positive().max(108000).optional().describe('每个目标片段的新持续时间（帧），保持源内容并反算速度；与 speedPercent 二选一。'),
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
