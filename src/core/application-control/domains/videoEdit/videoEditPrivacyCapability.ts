import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const clipRef = applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict()
const effectRef = applicationRefSchema.extend({ kind: z.literal('video_edit.effect') }).strict()
export const detectVideoEditPrivacyCapability = defineApplicationCapability({
  id: 'detect_video_edit_sensitive_text', version: 1, domain: 'video_edit', title: '只找敏感字并生成打码候选',
  description: '在本机分析 clipRef 视频用到的原片范围，只找邮箱、手机号、身份证、银行卡、密钥和URL凭据，逐条生成带移动遮罩的马赛克效果。候选初始 enabled=false，供人审阅后用 video_edit.effect.enabled 通用属性逐条或批量启用；未确认不改变预览或导出。普通文字不处理。使用随应用内置的快速文字模型，无需下载，不上传画面、不付费。使用原片坐标和时钟，已有缩放、变速和倒放保留。快速滚动、低清、旋转或短暂闪现仍须人工复核；一步撤销，保存失败只重试保存。',
  aliases: ['只擦敏感字', '剪辑隐私打码', '敏感文字打码'], readOnly: false, dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit'], concurrencyKey: 'video_edit',
  inputSchema: z.object({ documentRef, clipRef }).strict(), outputSchema: z.object({ resultRef: clipRef, effectRefs: z.array(effectRef), verified: z.boolean(), message: z.string() }).strict(),
  acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['video_edit.effect'],
  resolveOperationTargets: input => [input.documentRef, input.clipRef], resolveOperationWriteTargets: input => [input.documentRef, input.clipRef], resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  control: capabilityControl('create', ['video_edit.effect'], { cancelable: true, revisionScopes: ['video_edit'] }),
  resolveObservedEffects: (_input, result) => result.effectRefs.length ? [{ effect: 'create', entityTypes: ['video_edit.effect'], propertyIds: [], targetRefs: result.effectRefs, count: result.effectRefs.length, verified: result.verified, evidence: result.verified ? ['已保存并读回未启用的打码效果。'] : [] }] : [],
  summarize: result => result.message,
})
