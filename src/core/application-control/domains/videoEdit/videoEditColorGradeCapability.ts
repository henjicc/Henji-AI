import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { VIDEO_EDIT_COLOR_GRADE } from '../../../videoEdit/colorGrade'
import { colorReadoutSchema, colorScopesSchema } from '../shared/colorReadoutSchema'
import { COLOR_GRADE_EXPORT_DESCRIPTION, colorGradeExportInputShape, colorGradeExportOutputShape } from '../shared/colorGradeExportSchema'

const suggestedParameters = z.object(Object.fromEntries(VIDEO_EDIT_COLOR_GRADE.params.map(param => [param.key, param.type === 'number' ? z.number().min(param.min).max(param.max).optional() : param.type === 'boolean' ? z.boolean().optional() : z.string().max(4096).optional()]))).strict()

const ref = (kind: string) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
export const analyzeVideoEditColorGradeCapability = defineApplicationCapability({
  id: 'analyze_video_edit_color', title: '分析片段自动校色建议', description: '默认均匀采样片段内5帧（sampleCount为1–9；指定frame时只采该帧）。自动校色返回 temperature_kelvin（光源色温，6500 不变）/tint/exposure/contrast 绝对建议，合并已读 video_edit.effect.parameters 后通用写入。自动校色用灰世界、Shades of Gray、灰边缘、白块四种光源估计投票（分歧大时只做部分校正，保留日落等有意偏色），曝光按对数平均亮度并识别低调/高调画面、保护高光。referenceClipRef指定同序列另一个画面片段时做镜头匹配：默认 mkl 在 OkLab 中按颜色分布映射后反拟合为色温/色调/曝光/对比度/饱和度/高光/阴影滑块（可直接微调），moments/histogram 为逐通道 RGB 曲线；用返回parameters整体替换，并在同一通用事务把该效果的 frame_curves 写为 {}（或去掉被替换参数的键），避免旧Look或动画重复调色。没有效果时通用集合创建 definition_id=effect:color_grade。不修改片段、不移动播放头、不创建文件。统计不识别艺术意图，写入后需观察并微调。',
  version: 1, domain: 'video_edit', aliases: ['自动校色', '匹配颜色', '白平衡建议', 'auto color', 'color match'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip'], producesRefs: ['video_edit.clip'],
  successEvidence: ['返回指定片段采样帧及校色/参考匹配建议；视觉效果需写入后观察。'], failureRecovery: ['片段修改后重新分析；纯色或过暗画面选择其他参考或手动校色。'],
  inputSchema: z.object({ documentRef: ref('video_edit.document'), sequenceRef: ref('video_edit.sequence'), clipRef: ref('video_edit.clip'), frame: z.number().int().nonnegative().optional(), sampleCount: z.number().int().min(1).max(9).optional(), referenceClipRef: ref('video_edit.clip').optional(), matchMethod: z.enum(['mkl', 'moments', 'histogram']).optional() }).strict(),
  outputSchema: z.object({ resultRef: ref('video_edit.clip'), parameters: suggestedParameters, frame: z.number().int().nonnegative(), frames: z.array(z.number().int().nonnegative()).min(1).max(9), documentRevision: z.number().int().nonnegative(), documentVersion: z.string().min(1).describe('实际采样文档版本，与截帧 documentVersion 使用同一标识；宿主重启或文档重开后不同，不可按字符串排序。'), message: z.string() }).strict(),
  concurrencyKey: 'video_edit_color_grade', resolveConcurrencyKey: input => `video_edit_color_grade:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.clip'], { cancelable: true, revisionScopes: ['video_edit'] }), summarize: result => result.message,
})

export const observeVideoEditColorCapability = defineApplicationCapability({
  id: 'observe_video_edit_color', title: '读取画面颜色读数', description: '读取片段或节目画面的颜色读数：中灰曝光偏差（EV）、高光/暗部溢出百分比、亮度分位、估计光源色温与可信度、彩度与主色、肤色候选。调色前后各读一次即可核对结果：stage=before_grade 为该片段全能调色之前，after_grade 为之后（默认），program 为整个合成画面（不传 clipRef 时默认）。includeScopes=true 时附直方图、波形与矢量示波器数组（与调色面板示波器同一份数据）。只读，不修改剪辑。比看截图判断偏色、曝光更准。',
  version: 1, domain: 'video_edit', aliases: ['颜色读数', '示波器', '直方图', '曝光检查', '白平衡检查', 'color scopes', 'histogram', 'waveform'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip'], producesRefs: ['video_edit.sequence'],
  successEvidence: ['返回实际渲染画面的统计读数；数值来自正式渲染帧。'], failureRecovery: ['片段修改后重新读取；纯透明或空白画面换一帧。'],
  inputSchema: z.object({ documentRef: ref('video_edit.document'), sequenceRef: ref('video_edit.sequence'), clipRef: ref('video_edit.clip').optional(), frame: z.number().int().nonnegative().optional(), stage: z.enum(['before_grade', 'after_grade', 'program']).optional(), sampleCount: z.number().int().min(1).max(9).optional().describe('不指定 frame 时在片段内均匀采样的帧数，默认 1（播放头或片段中点）'), includeScopes: z.boolean().optional() }).strict(),
  outputSchema: z.object({ resultRef: ref('video_edit.sequence'), stage: z.enum(['before_grade', 'after_grade', 'program']), frame: z.number().int().nonnegative(), frames: z.array(z.number().int().nonnegative()).min(1).max(9), readout: colorReadoutSchema, scopes: colorScopesSchema.optional(), documentRevision: z.number().int().nonnegative(), documentVersion: z.string().min(1), message: z.string() }).strict(),
  concurrencyKey: 'video_edit_color_observe', resolveConcurrencyKey: input => `video_edit_color_observe:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.sequence'], { cancelable: true, revisionScopes: ['video_edit'] }), summarize: result => result.message,
})

export const exportVideoEditColorLutCapability = defineApplicationCapability({
  id: 'export_video_edit_color_lut', title: '导出片段调色为 LUT 或 CDL',
  description: `把片段上一个全能调色效果（effectRef 取 video_edit.effect，definition_id=effect:color_grade）导出成 .cube 3D LUT 或 ASC CDL 文件，带到 Resolve、Premiere、相机监看等其他软件里复用。调色带关键帧时按 frame（序列帧，须在片段内）求值，省略时取播放头所在帧（播放头不在片段内则取片段首帧），回执 frame 为实际使用的帧。${COLOR_GRADE_EXPORT_DESCRIPTION}效果强度与作用区域属于合成，不进文件。`,
  version: 1, domain: 'video_edit', aliases: ['导出 LUT', '导出调色', '导出 cube', '导出 CDL', 'export LUT', 'export cube', 'export CDL'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 120000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.effect'], producesRefs: [],
  successEvidence: ['文件写出后用正式解析器读回，测试色与正式调色的色差作为证据。'], failureRecovery: ['目标已存在时确认后传 overwrite=true；CDL 被拒绝时改导出 cube；LUT 文件丢失时恢复或重新导入。'],
  inputSchema: z.object({ documentRef: ref('video_edit.document'), effectRef: ref('video_edit.effect'), frame: z.number().int().nonnegative().optional(), ...colorGradeExportInputShape }).strict(),
  outputSchema: z.object({ resultRef: ref('video_edit.effect'), clipRef: ref('video_edit.clip'), frame: z.number().int().nonnegative(), ...colorGradeExportOutputShape }).strict(),
  concurrencyKey: 'video_edit_color_export', resolveConcurrencyKey: input => `video_edit_color_export:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef, input.effectRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('execute', ['video_edit.effect'], { cancelable: true, revisionScopes: ['video_edit'] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => [{ effect: 'execute', entityTypes: ['video_edit.effect'], propertyIds: [], targetRefs: [output.resultRef], count: 1, verified: output.verification.verified, evidence: output.verification.verified ? [output.verification.condition] : [] }],
  summarize: result => result.message,
})
