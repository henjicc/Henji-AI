import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { titleTemplateOverridesSchema } from '../../../videoEdit/titleTemplates'

function ref<K extends string>(kind: K): z.ZodObject<Omit<typeof applicationRefSchema.shape, 'kind'> & { kind: z.ZodLiteral<K> }, z.core.$strict> { return applicationRefSchema.extend({ kind: z.literal(kind) }).strict() }
const target = z.object({ documentRef: ref('video_edit.document'), sequenceRef: ref('video_edit.sequence'), frame: z.number().int().nonnegative(), trackRef: ref('video_edit.track').optional() }).strict()
const output = z.object({ resultRef: ref('video_edit.document'), clipRefs: z.array(ref('video_edit.clip')).min(1).max(8), verified: z.boolean(), message: z.string() }).strict()
const applyInput = target.extend({ templateRef: ref('video_edit.title_template'), parameters: titleTemplateOverridesSchema.optional() }).strict()
const describeInput = target.extend({ description: z.string().trim().min(1).max(2000), providerId: z.string().min(1).optional(), modelId: z.string().min(1).optional() }).strict()
const common = {
  version: 1, domain: 'video_edit' as const, readOnly: false, dataClasses: ['C1'] as ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 300000, supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit'] as ['video_edit'],
  producesRefs: ['video_edit.document', 'video_edit.clip'], resolveConcurrencyKey: (input: z.infer<typeof target>) => `video_edit:${input.documentRef.id}`,
  resolveOperationTargets: (input: z.infer<typeof target>) => [input.documentRef, input.sequenceRef, ...(input.trackRef ? [input.trackRef] : [])], resolveOperationWriteTargets: (input: z.infer<typeof target>) => [input.documentRef],
  control: capabilityControl('execute', ['video_edit.document'], { revisionScopes: ['video_edit'], cancelable: true, alsoImpacts: [{ effect: 'create', entityTypes: ['video_edit.clip'] }] }),
  outputSchema: output, verificationContract: { kind: 'effect_receipt' as const, requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input: z.infer<typeof target>, result: z.infer<typeof output>) => [
    { effect: 'execute' as const, entityTypes: ['video_edit.document'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verified, evidence: result.verified ? ['标题实例已保存并从原剪辑回读核对。'] : [] },
    { effect: 'create' as const, entityTypes: ['video_edit.clip'], propertyIds: [], targetRefs: result.clipRefs, count: result.clipRefs.length, verified: result.verified, evidence: result.verified ? ['新文字与图形组合已从原剪辑回读。'] : [] },
  ], summarize: (result: z.infer<typeof output>) => result.message,
}
export const applyTitleTemplateCapability = defineApplicationCapability<z.infer<typeof applyInput>, z.infer<typeof output>>({ ...common, id: 'apply_video_edit_title_template', title: '应用动态图形标题模板', description: '先列出 video_edit.title_template，再将 templateRef 应用到明确序列的 frame（整数序列帧），按目标画幅换算文字、图形与关键帧。parameters 可覆盖文字text、副标题subtitle、图形颜色color、文字颜色textColor、字体font、秒数durationSeconds、入场entrance及计数countFrom/countTo。省略 trackRef 时放在落点已有画面上方；指定轨道则覆盖落点。整组一步撤销。后续用 graphic_object 或 clip 通用属性/关键帧编辑；另存模板用通用 title_template 集合（name/definition），内置模板固定。', aliases: ['基本图形', '标题模板', '人名条', 'lower third'], risk: 'R1', acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.track', 'video_edit.title_template'], inputSchema: applyInput, resolveOperationTargets: input => [...common.resolveOperationTargets(input), input.templateRef] })
export const describeTitleTemplateCapability = defineApplicationCapability<z.infer<typeof describeInput>, z.infer<typeof output>>({ ...common, id: 'generate_video_edit_title_from_description', title: '一句话生成标题动画', description: '将一句描述发给现有已配置文本模型，可能计费，必须按现有审批。生成封闭模板参数并在明确序列frame放入可编辑图形/文字和关键帧，一步撤销。支持人名条、标题卡、章节、片尾滚动、数字计数、强调框，只生成参数。providerId/modelId 省略用首个启用文本模型；取消、剪辑修改或会话关闭时拒绝迟到结果。后续通过图形对象通用属性继续编辑或另存本机模板。', aliases: ['描述生成', 'AI标题动画', '科技感人名条'], risk: 'R2', acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.track'], inputSchema: describeInput })
export const VIDEO_EDIT_TITLE_TEMPLATE_CAPABILITIES = [applyTitleTemplateCapability, describeTitleTemplateCapability]
