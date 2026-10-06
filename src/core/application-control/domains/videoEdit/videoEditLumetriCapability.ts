import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const ref = (kind: string) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
export const analyzeVideoEditLumetriCapability = defineApplicationCapability({
  id: 'analyze_video_edit_lumetri', title: '分析片段自动校色建议', description: '分析指定画面片段当前帧的直方图与灰世界白平衡，返回 Lumetri 颜色的 temperature、tint、exposure、contrast 绝对建议值。不修改片段、不移动播放头、不创建文件。参数建议需合并到已读的 video_edit.effect.parameters 再通用写入；没有效果时通过通用集合创建 definition_id=effect:lumetri_color。灰世界不识别艺术意图，结果需观察并微调。',
  version: 1, domain: 'video_edit', aliases: ['自动校色', '白平衡建议', 'auto color'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip'], producesRefs: ['video_edit.clip'],
  successEvidence: ['返回固定版本、指定片段帧的校色建议；视觉效果需写入后观察。'], failureRecovery: ['片段修改后重新分析；纯色或过暗画面换一帧或手动校色。'],
  inputSchema: z.object({ documentRef: ref('video_edit.document'), sequenceRef: ref('video_edit.sequence'), clipRef: ref('video_edit.clip'), frame: z.number().int().nonnegative().optional() }).strict(),
  outputSchema: z.object({ resultRef: ref('video_edit.clip'), parameters: z.object({ temperature: z.number(), tint: z.number(), exposure: z.number(), contrast: z.number() }).strict(), frame: z.number().int().nonnegative(), documentRevision: z.number().int().nonnegative(), message: z.string() }).strict(),
  concurrencyKey: 'video_edit_lumetri', resolveConcurrencyKey: input => `video_edit_lumetri:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.clip'], { cancelable: true, revisionScopes: ['video_edit'] }), summarize: result => result.message,
})
