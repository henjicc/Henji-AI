import { z } from 'zod'
import { applicationRefSchema } from '../../identifiers'
import { defineApplicationCapability, capabilityControl } from '../shared/defineApplicationCapability'
import { videoEditAnnotationFrameRangeSchema, videoEditAnnotationStatusSchema } from '../../../videoEdit/annotationQuery'
import { videoEditAnnotationAuthorSchema } from '../../../videoEdit/annotations'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '../../../videoEdit/time'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const annotationRef = ref('video_edit.annotation')
const frame = z.number().int().nonnegative().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES)
const reply = z.string().trim().min(1).max(2000)
const verification = z.object({ verified: z.boolean(), condition: z.string() }).strict()
/** 同一次修改或删除最多处理的批注数：一份工程的批注很少上百，再多就该先缩小条件。 */
const MAX_BATCH = 500

const where = z.object({
  sequenceRef: ref('video_edit.sequence').optional().describe('只看这个序列；省略为整份剪辑的全部序列。'),
  statuses: z.array(videoEditAnnotationStatusSchema).min(1).max(4).optional().describe('draft 待发送、open 待处理、addressed 已改完、resolved 已确认，列多个为“或”。'),
  authorKinds: z.array(videoEditAnnotationAuthorSchema.shape.kind).min(1).max(3).optional().describe('作者种类：user 用户、assistant 内置助手、external 外部智能体。'),
  range: videoEditAnnotationFrameRangeSchema.optional().describe('序列帧闭区间 {fromFrame,toFrame}，与批注自身时间（frame 到 end_frame）有重叠即命中。'),
  clipRefs: z.array(ref('video_edit.clip')).min(1).max(64).optional().describe('挂在这些片段上的批注：所属片段 clip_id，或时间段目标 target.clipIds 含该片段。'),
}).strict()

export const queryVideoEditAnnotationsCapability = defineApplicationCapability({
  id: 'query_video_edit_annotations', version: 1, title: '按条件筛选剪辑批注', domain: 'video_edit',
  description: '按状态、作者种类、时间段重叠、片段组合筛选一份剪辑里的批注（各条件为“且”，同一条件列多个值为“或”），分页返回每条的引用、所属序列、状态、作者、时间、所属片段、目标形状、正文摘要（超过 200 字截断并标 textTruncated）、回复数和最后一条回复。结果的 refs 与 revisions 会登记成读取基线，删除时把返回的 baselineId 交给 remove_video_edit_annotations，不用再逐条读取。要看完整 target、thread 时再用 read_application_entity 读单条。只读，不改播放头或选区。',
  aliases: ['列出批注', '筛选批注', '查批注', '已改完的批注', 'annotations'], readOnly: true, dataClasses: ['C1'], idempotent: true, destructive: false,
  timeoutMs: 15_000, supportsPreview: false, supportsUndo: false, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip'], producesRefs: ['video_edit.annotation'],
  inputSchema: z.object({ documentRef: ref('video_edit.document'), where: where.default({}), limit: z.number().int().min(1).max(200).default(50), cursor: z.string().min(1).max(40).optional().describe('上一页返回的 nextCursor；剪辑内容有任何修改后旧 cursor 失效，请不带 cursor 重新查询。') }).strict(),
  outputSchema: z.object({
    documentRef: ref('video_edit.document'), refs: z.array(annotationRef), revisions: z.record(z.string(), z.number().int().nonnegative()),
    items: z.array(z.object({ ref: annotationRef, sequenceRef: ref('video_edit.sequence'), status: videoEditAnnotationStatusSchema, author: videoEditAnnotationAuthorSchema, frame, endFrame: frame.nullable(), clipRef: ref('video_edit.clip').nullable(), targetKind: z.string(), text: z.string(), textTruncated: z.boolean(), replyCount: z.number().int().nonnegative(), lastReply: z.string().nullable() }).strict()),
    total: z.number().int().nonnegative(), nextCursor: z.string().nullable(), message: z.string(),
  }).strict(),
  control: capabilityControl('observe', ['video_edit.annotation'], { revisionScopes: ['video_edit'] }),
  resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: () => [],
  resolveObservedEffects: (_input, output) => [{ effect: 'observe', entityTypes: ['video_edit.annotation'], propertyIds: [], targetRefs: output.refs.map(item => ({ kind: item.kind, id: item.id })), count: Math.max(1, output.refs.length), verified: true, evidence: [] }],
  summarize: output => output.message,
})

const status = z.enum(['open', 'addressed', 'resolved'])
export const updateVideoEditAnnotationsCapability = defineApplicationCapability({
  id: 'update_video_edit_annotations', version: 1, title: '按条件批量改批注状态', domain: 'video_edit',
  description: '按条件把一批批注改成同一状态，一次提交、一步撤销。where 同 query_video_edit_annotations，但必须写 statuses 说明从哪些状态改起，免得把用户的待发送草稿一并发出、或碰到已确认的整批被拒；已经是目标 status 的不动。reply 会追加到每一条。规则与逐条修改相同：写 addressed 必须附 reply 说明改了什么；resolved 只能由已改完的批注写成，且只在用户于对话里明确说通过后才写，必须附 reply 写明是用户确认的；open 表示重开或驳回，会清掉处理关联；不能写 draft。任一条不合规则整批拒绝、不改任何东西，错误里点名那一条的引用。逐条改状态、逐条回复用 change_application_entities（同一事务里的多条修改也只提交一次）。锁定轨道上的批注也能改。',
  aliases: ['批量确认批注', '批量改批注状态', '驳回批注', '重开批注', '批注改完'], readOnly: false, dataClasses: ['C1'], idempotent: false, destructive: false,
  timeoutMs: 20_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip'], producesRefs: ['video_edit.annotation'],
  inputSchema: z.object({ documentRef: ref('video_edit.document'), where: where.extend({ statuses: z.array(videoEditAnnotationStatusSchema).min(1).max(4).describe('必填：只改当前处于这些状态的批注，例如 ["open"] 改完、["addressed"] 确认。') }).strict(), status, reply: reply.optional() }).strict(),
  outputSchema: z.object({ documentRef: ref('video_edit.document'), resultRefs: z.array(annotationRef), message: z.string(), verification }).strict(),
  control: capabilityControl('update', ['video_edit.annotation'], { propertyIds: ['video_edit.annotation.status', 'video_edit.annotation.thread'], revisionScopes: ['video_edit'] }),
  resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: input => [input.documentRef],
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveObservedEffects: (_input, output) => [{ effect: 'update', entityTypes: ['video_edit.annotation'], propertyIds: ['video_edit.annotation.status', 'video_edit.annotation.thread'], targetRefs: output.resultRefs.map(item => ({ kind: item.kind, id: item.id })), count: Math.max(1, output.resultRefs.length), verified: output.verification.verified, evidence: [output.verification.condition] }],
  summarize: output => output.message,
})

export const removeVideoEditAnnotationsCapability = defineApplicationCapability({
  id: 'remove_video_edit_annotations', version: 1, title: '批量删除或合并剪辑批注', domain: 'video_edit',
  description: '一次提交删除多条批注，一步撤销。先用 query_video_edit_annotations 筛出目标，把返回的 refs 填进 annotationRefs、返回的 baselineId 填进 baselineIds；不用逐条读取。清掉已处理的批注就筛 statuses=[addressed,resolved]，待发送与待处理的不要删。合并重复：mergeInto 给保留的那一条（它也要在同一次查询结果里），annotationRefs 给要并掉的重复项，保留的那条下会追加一条助手回复，列出并掉的批注正文，mergeNote 可写合并理由。只在用户于对话里要求清理、删除或合并时使用。锁定轨道上的批注也能删。',
  aliases: ['批量删除批注', '清除已处理批注', '清空批注', '合并重复批注'], readOnly: false, dataClasses: ['C1'], idempotent: false, destructive: true,
  timeoutMs: 20_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.annotation'], producesRefs: ['video_edit.annotation'],
  baselineCapabilityId: 'query_video_edit_annotations',
  inputSchema: z.object({ documentRef: ref('video_edit.document'), annotationRefs: z.array(annotationRef).min(1).max(MAX_BATCH), mergeInto: annotationRef.optional(), mergeNote: reply.optional() }).strict().superRefine((value, ctx) => {
    if (value.mergeNote && !value.mergeInto) ctx.addIssue({ code: 'custom', path: ['mergeNote'], message: 'mergeNote 只在合并时使用，请同时给 mergeInto。' })
    if (value.mergeInto && value.annotationRefs.some(item => item.id === value.mergeInto!.id)) ctx.addIssue({ code: 'custom', path: ['mergeInto'], message: '保留的那一条不能同时出现在要删除的 annotationRefs 里。' })
  }),
  outputSchema: z.object({ documentRef: ref('video_edit.document'), removedRefs: z.array(annotationRef), resultRefs: z.array(annotationRef), message: z.string(), verification }).strict(),
  control: capabilityControl('delete', ['video_edit.annotation'], { revisionScopes: ['video_edit'], alsoImpacts: [{ effect: 'update', entityTypes: ['video_edit.annotation'], propertyIds: ['video_edit.annotation.thread'] }] }),
  resolveOperationTargets: input => [input.documentRef, ...input.annotationRefs, ...(input.mergeInto ? [input.mergeInto] : [])],
  resolveOperationWriteTargets: input => [...input.annotationRefs, ...(input.mergeInto ? [input.mergeInto] : [])],
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveObservedEffects: (_input, output) => [
    { effect: 'delete', entityTypes: ['video_edit.annotation'], propertyIds: [], targetRefs: output.removedRefs.map(item => ({ kind: item.kind, id: item.id })), count: Math.max(1, output.removedRefs.length), verified: output.verification.verified, evidence: [output.verification.condition] },
    ...(output.resultRefs.length ? [{ effect: 'update' as const, entityTypes: ['video_edit.annotation'], propertyIds: ['video_edit.annotation.thread'], targetRefs: output.resultRefs.map(item => ({ kind: item.kind, id: item.id })), count: output.resultRefs.length, verified: output.verification.verified, evidence: [output.verification.condition] }] : []),
  ],
  summarize: output => output.message,
})

export const VIDEO_EDIT_ANNOTATION_CAPABILITIES = [queryVideoEditAnnotationsCapability, updateVideoEditAnnotationsCapability, removeVideoEditAnnotationsCapability]
