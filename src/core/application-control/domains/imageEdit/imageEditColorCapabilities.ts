import { z } from 'zod'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { colorReadoutSchema, colorScopesSchema } from '../shared/colorReadoutSchema'

const documentRef = z.object({ kind: z.literal('image_edit.document'), id: z.string().startsWith('v3:') }).strict()
const layerRef = z.object({ kind: z.literal('image_edit.layer'), id: z.string().startsWith('v3:') }).strict()
export const observeImageEditColorCapability = defineApplicationCapability({
  id: 'observe_image_edit_color', version: 1, domain: 'image_edit', side: 'frontend', title: '读取图片颜色读数',
  aliases: ['颜色读数', '直方图', '示波器', '曝光检查', '白平衡检查', 'color scopes', 'histogram'],
  description: '读取当前图片合成结果的颜色读数：中灰曝光偏差（EV）、高光/暗部溢出百分比、亮度分位、估计光源色温与可信度、彩度与主色、肤色候选。调色后再读一次即可核对；stage=before_grade 配合 layerRef（全能调色调整层）读取隐藏该层后的画面。includeScopes=true 时附直方图、波形与矢量示波器数组（与调色面板同一份数据）。只读。',
  readOnly: true, control: capabilityControl('observe', ['image_edit.document'], { revisionScopes: ['image_edit'], cancelable: true }),
  risk: 'R0', dataClasses: ['C1'], permission: 'image_edit:read', idempotent: true, destructive: false, timeoutMs: 120_000,
  supportsPreview: false, supportsUndo: false, requiredScopes: ['image_edit'], acceptsRefs: ['image_edit.document', 'image_edit.layer'], producesRefs: ['image_edit.document'],
  inputSchema: z.object({ documentRef, layerRef: layerRef.optional(), stage: z.enum(['before_grade', 'document']).optional(), includeScopes: z.boolean().optional() }).strict(),
  outputSchema: z.object({ resultRef: documentRef, stage: z.enum(['before_grade', 'document']), revision: z.number().int().nonnegative(), readout: colorReadoutSchema, scopes: colorScopesSchema.optional(), message: z.string() }).strict(),
  successEvidence: ['返回正式合成内核渲染的图片统计读数。'], failureRecovery: ['图片在读取中被修改时重新读取；调色前读数需要指定全能调色调整层。'],
  resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: () => [],
  concurrencyKey: 'image_edit_color_observe', resolveConcurrencyKey: input => `image_edit_color_observe:${input.documentRef.id}`,
  summarize: output => output.message,
})
