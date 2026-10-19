import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { subtitleCorrectionBudgetsSchema, subtitleCorrectionCuesSchema, subtitleCorrectionTermSchema } from '../../../videoEdit/subtitleCorrection'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document'); const sequenceRef = ref('video_edit.sequence'); const captionRef = ref('video_edit.caption')
const index = z.number().int().nonnegative().safe()
const packet = z.object({ instructions: z.string().optional(), rules: z.string().optional(), glossary: z.array(subtitleCorrectionTermSchema), core: z.object({ startWord: index, endWord: index }).strict(), words: z.array(z.object({ index, text: z.string() }).strict()), baseline: z.array(z.object({ captionId: z.string(), startWord: index, endWord: index, text: z.string() }).strict()).max(64) }).strict()
export const queryVideoEditSubtitleCorrectionCapability = defineApplicationCapability({
  id: 'query_video_edit_subtitle_correction', version: 1, domain: 'video_edit', title: '按预算读取字幕校对批次',
  description: '首次给documentRef、sequenceRef，可选captionRefs、budgets={inputTokens,outputTokens,contextTokens}、rules与glossary=[{term,variants?}]；根据已有来源词按输入/输出双预算分批，不识别、不调用模型、不改作品。默认预算12000/6000/500，保守估算仅用于packet窗口，不是精确token或计费；调用者还须预留自身会话开销。词表只含索引和文字，core外是只读上下文，规则在计划内复用，术语按局部文字/错词变体筛选。返回planId、批数、进度及当前批packet；模型只需提交startWord/endWord/text，不提交时间。人工改写、缺词源或无法可靠定位的字幕受保护，可分页读protected列表。续查只传documentRef、sequenceRef、planId，可指定batchIndex或protectedOffset；省略batchIndex取下一未完成批。失败只重试该批，成功批不重做。计划仅在本次文档实例保留，最多4份；重开或声音/片段时序变化后重新规划。已完成结果正常保存，保护用户后来修改。随后用apply_video_edit_subtitle_correction应用本批；语义正确性仍需听看复核。',
  aliases: ['字幕分批校对', '字幕校对计划'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.caption'], producesRefs: ['video_edit.caption'],
  inputSchema: z.object({ documentRef, sequenceRef, planId: z.string().uuid().optional(), batchIndex: index.optional(), protectedOffset: index.default(0), includeGuidance: z.boolean().default(false).describe('首次总返回instructions/rules；续查复用原计划规则而不重复返回，需要在新上下文重读时设true。'), captionRefs: z.array(captionRef).min(1).max(1000).optional(), budgets: subtitleCorrectionBudgetsSchema.optional(), rules: z.string().max(4000).optional(), glossary: z.array(subtitleCorrectionTermSchema).max(200).optional() }).strict(),
  outputSchema: z.object({ documentRef, sequenceRef, planId: z.string().uuid(), batchCount: index, completed: index, pending: index, conflicts: index,
    batch: z.object({ index, state: z.enum(['pending', 'applied', 'conflict']), packet: packet.nullable(), estimatedInputTokens: index, estimatedOutputTokens: index, captionRefs: z.array(captionRef).max(64), lastError: z.string().max(2000).nullable() }).strict().nullable(),
    protected: z.array(z.object({ captionRef, reason: z.enum(['authored_text', 'no_word_source', 'unaligned_source', 'unreliable_timing']) }).strict()).max(20), protectedCount: index, protectedNextOffset: index.nullable(), message: z.string(),
  }).strict(),
  resolveOperationTargets: input => [input.documentRef, input.sequenceRef], resolveOperationWriteTargets: () => [], control: capabilityControl('observe', ['video_edit.caption'], { cancelable: true, revisionScopes: ['video_edit'] }), summarize: output => output.message,
})
export const applyVideoEditSubtitleCorrectionCapability = defineApplicationCapability({
  id: 'apply_video_edit_subtitle_correction', version: 1, domain: 'video_edit', title: '应用一批字幕校对',
  description: '给query_video_edit_subtitle_correction返回的documentRef、sequenceRef、planId、batchIndex和cues=[{startWord,endWord,text}]。闭合词范围必须连续、完整、唯一并按顺序覆盖本批core，不能修改上下文、漏词、重复、乱序、跨原字幕合并或提交时间；可在原字幕内拆分，最多128段。应用沿正式来源时钟生成字幕时间，保留样式和词源；译文保留完整并标待复核，不按原文猜拆。明显扩写及输出超预算拒绝，但词义准确仍需模型与听看复核。只改本批，已有人工修改、锁轨或源变化拒绝覆盖；失败后可用原计划单独重试本批，成功批按相同结果重复调用不新增历史，已成功批的不同结果拒绝。每批沿原保存与撤销一次提交，未改字/断句则不新增撤销。计划不跨文档重开；保存失败沿原操作恢复保存，不重做本批。不会调用识别或模型，不产生识别费用。',
  aliases: ['提交字幕校对批次'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence'], producesRefs: ['video_edit.caption'],
  inputSchema: z.object({ documentRef, sequenceRef, planId: z.string().uuid(), batchIndex: index, cues: subtitleCorrectionCuesSchema }).strict(),
  outputSchema: z.object({ documentRef, sequenceRef, batchIndex: index, captionRefs: z.array(captionRef).max(128), createdCaptionRefs: z.array(captionRef).max(128), updatedCaptionRefs: z.array(captionRef).max(64), changed: z.boolean(), replayed: z.boolean(), verified: z.boolean(), message: z.string() }).strict(),
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`, resolveOperationTargets: input => [input.documentRef, input.sequenceRef], resolveOperationWriteTargets: input => [input.sequenceRef],
  control: capabilityControl('execute', ['video_edit.caption'], { cancelable: true, revisionScopes: ['video_edit'], alsoImpacts: [{ effect: 'update', entityTypes: ['video_edit.caption'], propertyIds: ['video_edit.caption.text', 'video_edit.caption.start', 'video_edit.caption.duration'] }, { effect: 'create', entityTypes: ['video_edit.caption'] }] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: false, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => output.changed ? [
    { effect: 'execute' as const, entityTypes: ['video_edit.caption'], propertyIds: [], targetRefs: output.captionRefs, count: output.captionRefs.length, verified: output.verified, evidence: output.verified ? ['本批词范围校验与字幕保存回读通过。'] : [] },
    ...(output.updatedCaptionRefs.length ? [{ effect: 'update' as const, entityTypes: ['video_edit.caption'], propertyIds: ['video_edit.caption.text', 'video_edit.caption.start', 'video_edit.caption.duration'], targetRefs: output.updatedCaptionRefs, count: output.updatedCaptionRefs.length, verified: output.verified, evidence: output.verified ? ['本批原字幕已校对。'] : [] }] : []),
    ...(output.createdCaptionRefs.length ? [{ effect: 'create' as const, entityTypes: ['video_edit.caption'], propertyIds: [], targetRefs: output.createdCaptionRefs, count: output.createdCaptionRefs.length, verified: output.verified, evidence: output.verified ? ['拆分的字幕已生成并保存。'] : [] }] : []),
  ] : [], summarize: output => output.message,
})
