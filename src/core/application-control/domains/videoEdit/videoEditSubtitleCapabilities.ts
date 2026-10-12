import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { defineApplicationCapability, capabilityControl } from '../shared/defineApplicationCapability'
import { autoSubtitleOptionsSchema } from '../../../videoEdit/autoSubtitles'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document'); const sequenceRef = ref('video_edit.sequence'); const audioDocumentRef = ref('audio_edit.document')
function refBatches<T>(refs: readonly T[]): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < refs.length; index += 128) batches.push(refs.slice(index, index + 128))
  return batches
}
const prepareInput = z.object({ documentRef, sequenceRef, scope: z.enum(['sequence', 'in-out', 'selection']).default('sequence'), trackRef: ref('video_edit.track').optional() }).strict()
const preparationOutput = z.object({ documentRef, audioDocumentRef, message: z.string(), verified: z.boolean() }).strict()
export const prepareVideoEditSubtitleCapability = defineApplicationCapability({
  id: 'prepare_video_edit_subtitle_audio', title: '准备序列字幕声音', description: '本地导出序列可听混音或指定轨道供转录，不产生识别费用。scope=sequence 为整条序列，in-out 为当前序列完整入出点，selection 为当前选中片段的声音（保持它们之间的序列空隙）。返回可恢复的口播文档引用，随后用 generate_video_edit_subtitles 转录；也可用既有口播任务查询、取消和恢复。字幕与标记不会改变已准备声音的身份，修改声音或序列时序后须重新准备。',
  version: 1, domain: 'video_edit', aliases: ['转录序列', '字幕混音'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'audio_edit:write', idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit', 'audio_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.track'], producesRefs: ['audio_edit.document'], inputSchema: prepareInput, outputSchema: preparationOutput,
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`, resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: input => [input.sequenceRef],
  control: capabilityControl('execute', ['audio_edit.document'], { cancelable: true, revisionScopes: ['video_edit', 'audio_edit'], alsoImpacts: [{ effect: 'create', entityTypes: ['audio_edit.document'] }] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => (['execute', 'create'] as const).map(effect => ({ effect, entityTypes: ['audio_edit.document'], propertyIds: [], targetRefs: [output.audioDocumentRef], count: 1, verified: output.verified, evidence: output.verified ? ['已保存混音口播文档，可按引用续查识别。'] : [] })), summarize: output => output.message,
})
export const generateVideoEditSubtitleCapability = defineApplicationCapability({
  id: 'generate_video_edit_subtitles', title: '生成剪辑字幕', description: '提供 clipRef 时按音频片段的原文生成字幕：originalText 可省略，默认取生成原文；优先读取生成结果原生时间戳，timeSource=native 禁止付费识别，auto 缺少时间戳时经用户确认后调用现有口播识别。时间来自识别、文字只取原文，未匹配部分插值并在 captions 中标记 estimated/confidence。考虑片段起点、入点、变速、倒放，返回每句序列帧及微秒，一步撤销。等待确认时应用立即返回 awaiting_user_confirmation，用户在主窗口确认后自动继续，用原 operationId 查询，禁止重复提交。clipRef 首次调用不要传 audioDocumentRef，更不能传 prepare 返回的混音文档；失败后仅复用本模式返回的 audioDocumentRef 恢复。也支持原有 audioDocumentRef 模式：对 prepare_video_edit_subtitle_audio 准备的混音转录，可能计费，须审批；modelId 省略自动选择时间戳模型。maxCharacters/maxLines 控制每行字数和每条行数。原有混音模式支持 pauseSeconds 停顿断句及 minDurationSeconds 延伸。已有识别结果不会重复计费；后续文字、时序、样式走 video_edit.caption 通用属性，双语用 translate_video_edit_subtitles，SRT 用 export_video_edit。',
  version: 1, domain: 'video_edit', aliases: ['自动字幕', '创建字幕', '语音转字幕'], readOnly: false, risk: 'R2', dataClasses: ['C1'], permission: 'audio_edit:write', idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit', 'audio_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip', 'audio_edit.document'], producesRefs: ['video_edit.caption', 'audio_edit.document'],
  inputSchema: z.object({ documentRef, sequenceRef, audioDocumentRef: audioDocumentRef.optional().describe("不传 clipRef 时，使用 prepare_video_edit_subtitle_audio 返回的混音文档；传 clipRef 时，只能使用该模式上次失败返回的恢复引用，首次调用应省略，不能传混音文档。"), clipRef: ref('video_edit.clip').optional(), originalText: z.string().min(1).optional(), timeSource: z.enum(['auto', 'native']).default('auto'), modelId: z.string().min(1).optional(), language: z.enum(['zh', 'en']).optional().describe('口播识别语言提示：zh 中文，en 英语；省略沿用口播默认。'), ...autoSubtitleOptionsSchema.shape }).strict(),
  outputSchema: z.object({ documentRef, audioDocumentRef: audioDocumentRef.optional(), captionRefs: z.array(ref('video_edit.caption')), createdCaptionRefs: z.array(ref('video_edit.caption')), timingSource: z.enum(['native', 'recognition']).optional(), captions: z.array(z.object({ captionRef: ref('video_edit.caption'), text: z.string(), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive(), startUs: z.number().int().nonnegative(), endUs: z.number().int().positive(), confidence: z.number().min(0).max(1), estimated: z.boolean() }).strict()).optional(), message: z.string(), verified: z.boolean() }).strict(),
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`, resolveOperationTargets: input => [input.documentRef, ...(input.audioDocumentRef ? [input.audioDocumentRef] : [])], resolveOperationWriteTargets: input => [input.sequenceRef, ...(input.audioDocumentRef ? [input.audioDocumentRef] : [])],
  control: capabilityControl('execute', ['video_edit.caption', 'audio_edit.document'], { cancelable: true, revisionScopes: ['video_edit', 'audio_edit'], alsoImpacts: [{ effect: 'create', entityTypes: ['video_edit.caption', 'audio_edit.document'] }] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (input, output) => [
    ...(input.clipRef && !input.audioDocumentRef && output.audioDocumentRef ? [{ effect: 'create' as const, entityTypes: ['audio_edit.document'], propertyIds: [], targetRefs: [output.audioDocumentRef], count: 1, verified: output.verified, evidence: output.verified ? ['识别源声音已保存为可恢复的口播文档。'] : [] }] : []),
    ...(output.audioDocumentRef ? [{ effect: 'execute' as const, entityTypes: ['audio_edit.document'], propertyIds: [], targetRefs: [output.audioDocumentRef], count: 1, verified: output.verified, evidence: output.verified ? ['识别结果保存为口播文档，可继续按原引用恢复。'] : [] }] : []),
    ...refBatches(output.captionRefs).map(targetRefs => ({ effect: 'execute' as const, entityTypes: ['video_edit.caption'], propertyIds: [], targetRefs, count: targetRefs.length, verified: output.verified, evidence: output.verified ? ['已回读核对字幕所在剪辑文档。'] : [] })),
    ...refBatches(output.createdCaptionRefs).map(targetRefs => ({ effect: 'create' as const, entityTypes: ['video_edit.caption'], propertyIds: [], targetRefs, count: targetRefs.length, verified: output.verified, evidence: output.verified ? ['本次新增字幕已从剪辑文件回读核对。'] : [] })),
  ], summarize: output => output.message,
})
export const translateVideoEditSubtitleCapability = defineApplicationCapability({
  id: 'translate_video_edit_subtitles', title: '生成双语剪辑字幕', description: '调用现有已配置文本模型翻译当前序列字幕，可能计费，须审批。targetLanguage 是第二语言；captionRefs 省略翻译全序列，可指定一批字幕。providerId/modelId 省略选择第一个已启用文本模型。原文保留，译文显示在下方，重生成会替换所选译文；所有译文一步撤销。原文须单行，多行时先用 segment_video_edit_subtitles（maxLines=1）整理，随后生成上下双行。翻译期间原字幕发生修改或取消时不覆盖新修改。后续校正/清除译文用 video_edit.caption.translation 通用属性，样式用 style；导出与烧录均包含双语。',
  version: 1, domain: 'video_edit', aliases: ['双语字幕', '字幕翻译', '第二语言字幕'], readOnly: false, risk: 'R2', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.caption'], producesRefs: ['video_edit.caption'],
  inputSchema: z.object({ documentRef, sequenceRef, captionRefs: z.array(ref('video_edit.caption')).min(1).optional(), targetLanguage: z.enum(['zh', 'en', 'ja', 'ko', 'fr', 'es', 'de']), providerId: z.string().min(1).optional(), modelId: z.string().min(1).optional() }).strict(),
  outputSchema: z.object({ documentRef, captionRefs: z.array(ref('video_edit.caption')), message: z.string(), verified: z.boolean() }).strict(),
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`, resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: input => [input.sequenceRef],
  control: capabilityControl('execute', ['video_edit.caption'], { cancelable: true, revisionScopes: ['video_edit'], alsoImpacts: [{ effect: 'update', entityTypes: ['video_edit.caption'], propertyIds: ['video_edit.caption.translation', 'video_edit.caption.style'] }] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => refBatches(output.captionRefs).flatMap(targetRefs => (['execute', 'update'] as const).map(effect => ({ effect, entityTypes: ['video_edit.caption'], propertyIds: effect === 'update' ? ['video_edit.caption.translation', 'video_edit.caption.style'] : [], targetRefs, count: targetRefs.length, verified: output.verified, evidence: output.verified ? ['译文已保存并从剪辑文件回读核对。'] : [] }))), summarize: output => output.message,
})
export const segmentVideoEditSubtitleCapability = defineApplicationCapability({
  id: 'segment_video_edit_subtitles', title: '整理剪辑字幕长句', description: '免费整理已有字幕：按每行字数 maxCharacters 和每条行数 maxLines，将超长句按标点与词边界拆成多条，一步撤销。只有字幕区间时间，内部边界按字数比例估算，整理后可手动校正。captionRefs 省略整理全序列。已有译文须先用 caption.translation 清除，再整理并重新翻译，避免把旧译文重复贴到多条字幕。双语之前设 maxLines=1。原文、样式、片段锚定保留，原始字幕引用保留为第一段。',
  version: 1, domain: 'video_edit', aliases: ['字幕自动拆分', '长句拆分', '字幕分段'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 30000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.caption'], producesRefs: ['video_edit.caption'],
  inputSchema: z.object({ documentRef, sequenceRef, captionRefs: z.array(ref('video_edit.caption')).min(1).optional(), maxCharacters: autoSubtitleOptionsSchema.shape.maxCharacters, maxLines: autoSubtitleOptionsSchema.shape.maxLines }).strict(),
  outputSchema: z.object({ documentRef, captionRefs: z.array(ref('video_edit.caption')), createdCaptionRefs: z.array(ref('video_edit.caption')), updatedCaptionRefs: z.array(ref('video_edit.caption')), message: z.string(), verified: z.boolean() }).strict(),
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`, resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: input => [input.sequenceRef],
  control: capabilityControl('execute', ['video_edit.caption'], { revisionScopes: ['video_edit'], alsoImpacts: [{ effect: 'update', entityTypes: ['video_edit.caption'], propertyIds: ['video_edit.caption.text', 'video_edit.caption.duration'] }, { effect: 'create', entityTypes: ['video_edit.caption'] }] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => [
    ...refBatches(output.captionRefs).map(targetRefs => ({ effect: 'execute' as const, entityTypes: ['video_edit.caption'], propertyIds: [], targetRefs, count: targetRefs.length, verified: output.verified, evidence: output.verified ? ['整理后的字幕已保存并回读。'] : [] })),
    ...refBatches(output.updatedCaptionRefs).map(targetRefs => ({ effect: 'update' as const, entityTypes: ['video_edit.caption'], propertyIds: ['video_edit.caption.text', 'video_edit.caption.duration'], targetRefs, count: targetRefs.length, verified: output.verified, evidence: output.verified ? ['原字幕保留第一段并已回读核对。'] : [] })),
    ...refBatches(output.createdCaptionRefs).map(targetRefs => ({ effect: 'create' as const, entityTypes: ['video_edit.caption'], propertyIds: [], targetRefs, count: targetRefs.length, verified: output.verified, evidence: output.verified ? ['新增分段已从剪辑文件回读核对。'] : [] })),
  ], summarize: output => output.message,
})
export const VIDEO_EDIT_SUBTITLE_CAPABILITIES = [prepareVideoEditSubtitleCapability, generateVideoEditSubtitleCapability, translateVideoEditSubtitleCapability, segmentVideoEditSubtitleCapability]
