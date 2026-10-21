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

export const analyzeImageEditColorCapability = defineApplicationCapability({
  id: 'analyze_image_edit_color', version: 1, domain: 'image_edit', side: 'frontend', title: '分析图片自动校色建议',
  aliases: ['自动校色', '自动白平衡', '自动曝光', 'auto color', 'auto white balance'],
  description: '分析全能调色调整层之下的画面，返回白平衡（temperature_kelvin、tint）与曝光（exposure）的绝对建议值：四种光源估计投票，分歧大时只做部分校正以保留有意偏色；曝光识别低调/高调画面并保护高光。合并已读的 image_edit.layer.params 后经通用属性写入（同一次写入即一步撤销），写入后可用 observe_image_edit_color 核对。只读，不修改图片。',
  readOnly: true, control: capabilityControl('observe', ['image_edit.layer'], { revisionScopes: ['image_edit'], cancelable: true }),
  risk: 'R0', dataClasses: ['C1'], permission: 'image_edit:read', idempotent: true, destructive: false, timeoutMs: 120_000,
  supportsPreview: false, supportsUndo: false, requiredScopes: ['image_edit'], acceptsRefs: ['image_edit.layer'], producesRefs: ['image_edit.layer'],
  inputSchema: z.object({ layerRef }).strict(),
  outputSchema: z.object({ resultRef: layerRef, parameters: z.object({ temperature_kelvin: z.number(), tint: z.number(), exposure: z.number() }).strict(), revision: z.number().int().nonnegative(), message: z.string() }).strict(),
  successEvidence: ['返回由正式合成内核读取画面得到的建议值；写入后需观察并微调。'], failureRecovery: ['图片在分析中被修改时重新分析；纯透明画面无法分析。'],
  resolveOperationTargets: input => [input.layerRef], resolveOperationWriteTargets: () => [],
  concurrencyKey: 'image_edit_color_observe', resolveConcurrencyKey: input => `image_edit_color_observe:${input.layerRef.id}`,
  summarize: output => output.message,
})
