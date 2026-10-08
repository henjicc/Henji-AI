import { z } from 'zod'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'

const targetRef = z.object({ kind: z.literal('image_edit.layer'), id: z.string().startsWith('v3:') }).strict()
export const applyImageEditSelectionCapability = defineApplicationCapability({
  id: 'apply_image_edit_selection', version: 1, title: '应用图片选区',
  description: '把当前文档的独立选区栅格化，应用为指定图层蒙版、复制所选内容到新像素层，或删除所选内容为透明。蒙版应用替换目标蒙版；复制/删除保留原蒙版的可见范围。一次应用一次撤销。选区形状和羽化用 image_edit.selection.region 通用修改。',
  domain: 'image_edit', aliases: ['选区蒙版', '复制选区', '删除选区', 'apply selection mask'], side: 'frontend', readOnly: false,
  control: capabilityControl('update', ['image_edit.layer'], { revisionScopes: ['image_edit'], alsoImpacts: [{ effect: 'create', entityTypes: ['image_edit.layer'] }] }),
  risk: 'R1', dataClasses: ['C1'], permission: 'image_edit:write', idempotent: false, destructive: true,
  timeoutMs: 120_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['image_edit'], acceptsRefs: ['image_edit.layer', 'image_edit.selection'], producesRefs: ['image_edit.layer'],
  inputSchema: z.object({ targetRef, action: z.enum(['mask', 'copy', 'delete']) }).strict(),
  outputSchema: capabilityOutputSchema({ ref: targetRef, commandId: z.string(), verification: z.object({ verified: z.boolean() }).strict() }),
  successEvidence: ['返回实际目标图层引用，蒙版在正式状态中存在，资源进入原命令历史。'], failureRecovery: ['目标锁定时先解锁；作品或选区变化时重新读取后应用；取消不改变作品。'],
  resolveOperationTargets: input => [input.targetRef],
  resolveOperationWriteTargets: input => [input.targetRef],
  resolveObservedEffects: (input, output) => [{ effect: input.action === 'copy' ? 'create' : 'update', entityTypes: ['image_edit.layer'], propertyIds: [], targetRefs: [output.ref], count: 1, verified: output.verification.verified, evidence: [] }],
  concurrencyKey: 'image_edit', resolveConcurrencyKey: input => `image_edit:${input.targetRef.id}`,
  resolveTargetIds: input => ({ layerId: input.targetRef.id }), summarize: () => '选区已应用，可回读图层或撤销。',
})
