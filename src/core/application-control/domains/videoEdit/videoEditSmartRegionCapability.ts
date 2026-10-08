import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const effectRef = applicationRefSchema.extend({ kind: z.literal('video_edit.effect') }).strict()
export const retryVideoEditSmartRegionCapability = defineApplicationCapability({
  id: 'retry_video_edit_smart_region', title: '重试智能区域分析',
  description: '重试一个效果失败的人脸、人物、背景或文字区域分析，与效果控件重试相同。多人选区及其他效果共享同一次素材分析，重试后全部一起更新。免费本地分析，不改遮罩设置；用 effect.region_status 读回进度和结果。',
  version: 1, domain: 'video_edit', aliases: ['重试区域', '重新分析人脸'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: true, destructive: false, timeoutMs: 30000, supportsPreview: false, supportsUndo: false,
  completionKind: 'submitted', requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.effect'], producesRefs: ['video_edit.effect'],
  inputSchema: z.object({ documentRef, effectRef }).strict(),
  outputSchema: z.object({ resultRef: effectRef, status: z.literal('analyzing'), message: z.string() }).strict(),
  resolveOperationTargets: parsed => [parsed.documentRef, parsed.effectRef], resolveOperationWriteTargets: parsed => [parsed.documentRef],
  concurrencyKey: 'video_edit_smart_region', resolveConcurrencyKey: parsed => `video_edit:${parsed.documentRef.id}`,
  control: capabilityControl('execute', ['video_edit.effect'], { revisionScopes: ['video_edit'], verificationRequired: false, resultState: 'submitted' }),
  summarize: result => result.message,
})
