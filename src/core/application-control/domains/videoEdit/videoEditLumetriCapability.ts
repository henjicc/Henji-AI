import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { VIDEO_EDIT_LUMETRI } from '../../../videoEdit/lumetri'

const suggestedParameters = z.object(Object.fromEntries(VIDEO_EDIT_LUMETRI.params.map(param => [param.key, param.type === 'number' ? z.number().min(param.min).max(param.max).optional() : z.string().max(4096).optional()]))).strict()

const ref = (kind: string) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
export const analyzeVideoEditLumetriCapability = defineApplicationCapability({
  id: 'analyze_video_edit_lumetri', title: '分析片段自动校色建议', description: '默认均匀采样片段内5帧（sampleCount为1–9；指定frame时只采该帧）。自动校色返回 temperature/tint/exposure/contrast 绝对建议，合并已读 video_edit.effect.parameters 后通用写入。referenceClipRef指定同序列另一个画面片段时，按moments均值方差或histogram直方图匹配参考已调色画面，返回完整中性参数加RGB曲线；用返回parameters整体替换，并在同一通用事务把该效果的 frame_curves 写为 {}（或去掉被替换参数的键），避免旧Look或动画重复调色。没有效果时通用集合创建 definition_id=effect:lumetri_color。不修改片段、不移动播放头、不创建文件。统计不识别艺术意图，写入后需观察并微调。',
  version: 1, domain: 'video_edit', aliases: ['自动校色', '匹配颜色', '白平衡建议', 'auto color', 'color match'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip'], producesRefs: ['video_edit.clip'],
  successEvidence: ['返回指定片段采样帧及校色/参考匹配建议；视觉效果需写入后观察。'], failureRecovery: ['片段修改后重新分析；纯色或过暗画面选择其他参考或手动校色。'],
  inputSchema: z.object({ documentRef: ref('video_edit.document'), sequenceRef: ref('video_edit.sequence'), clipRef: ref('video_edit.clip'), frame: z.number().int().nonnegative().optional(), sampleCount: z.number().int().min(1).max(9).optional(), referenceClipRef: ref('video_edit.clip').optional(), matchMethod: z.enum(['moments', 'histogram']).optional() }).strict(),
  outputSchema: z.object({ resultRef: ref('video_edit.clip'), parameters: suggestedParameters, frame: z.number().int().nonnegative(), frames: z.array(z.number().int().nonnegative()).min(1).max(9), documentRevision: z.number().int().nonnegative(), message: z.string() }).strict(),
  concurrencyKey: 'video_edit_lumetri', resolveConcurrencyKey: input => `video_edit_lumetri:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.clip'], { cancelable: true, revisionScopes: ['video_edit'] }), summarize: result => result.message,
})
