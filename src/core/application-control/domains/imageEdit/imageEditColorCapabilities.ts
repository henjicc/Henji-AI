import { z } from 'zod'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { colorReadoutSchema, colorScopesSchema } from '../shared/colorReadoutSchema'
import { COLOR_GRADE_EXPORT_DESCRIPTION, colorGradeExportInputShape, colorGradeExportOutputShape } from '../shared/colorGradeExportSchema'

const documentRef = z.object({ kind: z.literal('image_edit.document'), id: z.string().startsWith('v3:') }).strict()
const layerRef = z.object({ kind: z.literal('image_edit.layer'), id: z.string().startsWith('v3:') }).strict()
const gradeRef = z.object({ kind: z.enum(['image_edit.layer', 'image_edit.layer_filter']), id: z.string().startsWith('v3:') }).strict()
export const observeImageEditColorCapability = defineApplicationCapability({
  id: 'observe_image_edit_color', version: 1, domain: 'image_edit', side: 'frontend', title: '读取图片颜色读数',
  aliases: ['颜色读数', '直方图', '示波器', '曝光检查', '白平衡检查', 'color scopes', 'histogram'],
  description: '读取当前图片合成结果的颜色读数：中灰曝光偏差（EV）、高光/暗部溢出百分比、亮度分位、估计光源色温与可信度、彩度与主色、肤色候选。调色后再读一次即可核对；stage=before_grade 配合 layerRef（全能调色调整层）读取隐藏该层后的画面。includeScopes=true 时附直方图、波形与矢量示波器数组（与调色面板同一份数据）。只读。',
  readOnly: true, control: capabilityControl('observe', ['image_edit.document'], { revisionScopes: ['image_edit'], cancelable: true }), dataClasses: ['C1'], permission: 'image_edit:read', idempotent: true, destructive: false, timeoutMs: 120_000,
  supportsPreview: false, supportsUndo: false, requiredScopes: ['image_edit'], acceptsRefs: ['image_edit.document', 'image_edit.layer'], producesRefs: ['image_edit.document'],
  inputSchema: z.object({ documentRef, layerRef: layerRef.optional(), stage: z.enum(['before_grade', 'document']).optional(), includeScopes: z.boolean().optional() }).strict(),
  outputSchema: z.object({ resultRef: documentRef, stage: z.enum(['before_grade', 'document']), revision: z.number().int().nonnegative(), readout: colorReadoutSchema, scopes: colorScopesSchema.optional(), message: z.string() }).strict(),
  successEvidence: ['返回正式合成内核渲染的图片统计读数。'], failureRecovery: ['图片在读取中被修改时重新读取；调色前读数需要指定全能调色调整层。'],
  resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: () => [],
  concurrencyKey: 'image_edit_color_observe', resolveConcurrencyKey: input => `image_edit_color_observe:${input.documentRef.id}`,
  summarize: output => output.message,
})

const referenceRef = z.object({ kind: z.enum(['asset', 'generation.result', 'image_edit.preview', 'canvas.node', 'image_edit.document']), id: z.string().min(1) }).strict()
const signedSlider = z.number().min(-100).max(100)
export const analyzeImageEditColorCapability = defineApplicationCapability({
  id: 'analyze_image_edit_color', version: 1, domain: 'image_edit', side: 'frontend', title: '分析图片自动校色或参考匹配建议',
  aliases: ['自动校色', '自动白平衡', '自动曝光', '匹配颜色', '参考图调色', 'auto color', 'auto white balance', 'color match'],
  description: '分析全能调色调整层之下的画面（不含这一层）。不传 referenceRef：四种光源估计投票给白平衡（temperature_kelvin、tint）与曝光（exposure）绝对建议，分歧大时只做部分校正以保留有意偏色，曝光识别低调/高调并保护高光；apply=merge，把建议合并进已读的 image_edit.layer.params 后通用写入。传 referenceRef（素材 asset、生成结果 generation.result、编辑预览 image_edit.preview、画布节点 canvas.node 或另一份图片文档 image_edit.document）：与剪辑镜头匹配同一算法，OkLab MKL 颜色分布映射后反拟合为色温/色调/曝光/对比度/饱和度/高光/阴影七个可微调滑块；apply=replace，用返回的 parameters 整体写成该层 params（其余参数回到默认，避免旧调色叠加）。同一次写入即一步撤销，写入后用 observe_image_edit_color 核对。只读，不修改图片。',
  readOnly: true, control: capabilityControl('observe', ['image_edit.layer'], { revisionScopes: ['image_edit'], cancelable: true }), dataClasses: ['C1'], permission: 'image_edit:read', idempotent: true, destructive: false, timeoutMs: 120_000,
  supportsPreview: false, supportsUndo: false, requiredScopes: ['image_edit'], acceptsRefs: ['image_edit.layer', 'asset', 'generation.result', 'image_edit.preview', 'canvas.node', 'image_edit.document'], producesRefs: ['image_edit.layer'],
  inputSchema: z.object({ layerRef, referenceRef: referenceRef.optional().describe('参考图片；省略时做自动校色。') }).strict(),
  outputSchema: z.object({ resultRef: layerRef, apply: z.enum(['merge', 'replace']), parameters: z.object({ temperature_kelvin: z.number(), tint: z.number(), exposure: z.number(), contrast: signedSlider.optional(), saturation: signedSlider.optional(), highlights: signedSlider.optional(), shadows: signedSlider.optional() }).strict(), revision: z.number().int().nonnegative(), message: z.string() }).strict(),
  successEvidence: ['返回由正式合成内核读取画面得到的建议值；写入后需观察并微调。'], failureRecovery: ['图片在分析中被修改时重新分析；纯透明画面无法分析；参考读不出来时换一张参考或改用自动校色。'],
  resolveOperationTargets: input => [input.layerRef], resolveOperationWriteTargets: () => [],
  concurrencyKey: 'image_edit_color_observe', resolveConcurrencyKey: input => `image_edit_color_observe:${input.layerRef.id}`,
  summarize: output => output.message,
})

export const exportImageEditColorLutCapability = defineApplicationCapability({
  id: 'export_image_edit_color_lut', version: 1, domain: 'image_edit', side: 'frontend', title: '导出图片调色为 LUT 或 CDL',
  aliases: ['导出 LUT', '导出调色', '导出 cube', '导出 CDL', 'export LUT', 'export cube', 'export CDL'],
  description: `把一个全能调色调整层（image_edit.layer）或图层上的全能调色滤镜（image_edit.layer_filter）的参数导出成 .cube 3D LUT 或 ASC CDL 文件，带到 Resolve、Premiere、相机监看等其他软件里复用。${COLOR_GRADE_EXPORT_DESCRIPTION}图层不透明度、混合模式与蒙版属于合成，不进文件。`,
  readOnly: false, control: capabilityControl('execute', ['image_edit.layer', 'image_edit.layer_filter'], { revisionScopes: ['image_edit'], cancelable: true }), dataClasses: ['C1'], permission: 'image_edit:write', idempotent: false, destructive: false, timeoutMs: 120_000,
  supportsPreview: false, supportsUndo: false, requiredScopes: ['image_edit'], acceptsRefs: ['image_edit.layer', 'image_edit.layer_filter'], producesRefs: [],
  inputSchema: z.object({ layerRef: gradeRef, ...colorGradeExportInputShape }).strict(),
  outputSchema: z.object({ resultRef: gradeRef, ...colorGradeExportOutputShape }).strict(),
  successEvidence: ['文件写出后用正式解析器读回，测试色与正式调色的色差作为证据。'], failureRecovery: ['目标已存在时确认后传 overwrite=true；CDL 被拒绝时改导出 cube；LUT 资源读不到时重新导入 LUT。'],
  resolveOperationTargets: input => [input.layerRef], resolveOperationWriteTargets: () => [],
  concurrencyKey: 'image_edit_color_export', resolveConcurrencyKey: input => `image_edit_color_export:${input.layerRef.id}`,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => [{ effect: 'execute', entityTypes: [output.resultRef.kind], propertyIds: [], targetRefs: [output.resultRef], count: 1, verified: output.verification.verified, evidence: output.verification.verified ? [output.verification.condition] : [] }],
  summarize: output => output.message,
})
