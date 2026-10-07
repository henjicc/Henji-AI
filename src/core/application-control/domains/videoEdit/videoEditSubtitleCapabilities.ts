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
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`, resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: input => [input.documentRef],
  control: capabilityControl('execute', ['audio_edit.document'], { cancelable: true, revisionScopes: ['video_edit', 'audio_edit'], alsoImpacts: [{ effect: 'create', entityTypes: ['audio_edit.document'] }] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => (['execute', 'create'] as const).map(effect => ({ effect, entityTypes: ['audio_edit.document'], propertyIds: [], targetRefs: [output.audioDocumentRef], count: 1, verified: output.verified, evidence: output.verified ? ['已保存混音口播文档，可按引用续查识别。'] : [] })), summarize: output => output.message,
})
export const generateVideoEditSubtitleCapability = defineApplicationCapability({
  id: 'generate_video_edit_subtitles', title: '转录并生成剪辑字幕', description: '对 prepare_video_edit_subtitle_audio 返回的声音调用已配置口播识别模型，可能计费，须获得审批；modelId 省略时沿用口播自动选择支持时间戳的已配置模型。maxCharacters 是每行最大字数，maxLines 是每条最多行数，超长句按标点和词边界拆成多条；pauseSeconds 为词间停顿断句阈值。优先用词级时间戳，缺少时按字数比例估算分配（不代表识别出的逐词时刻）；minDurationSeconds 只延伸到下一句前的空隙。识别结果保存进原口播文档，字幕按原序列时间生成，一步撤销；音轨变动、关闭重开或取消时拒绝迟到回填。失败后继续使用同一 audioDocumentRef 恢复，已有识别结果不会重复计费；文字与时间修改走 video_edit.caption 通用属性。样式预设从 video_edit.subtitle_preset 读取 style，在同一通用事务中写入多个 caption.style。双语使用 translate_video_edit_subtitles，之后 translation 可通用读写。SRT 使用 export_video_edit。',
  version: 1, domain: 'video_edit', aliases: ['自动字幕', '创建字幕', '语音转字幕'], readOnly: false, risk: 'R2', dataClasses: ['C1'], permission: 'audio_edit:write', idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit', 'audio_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'audio_edit.document'], producesRefs: ['video_edit.caption', 'audio_edit.document'],
  inputSchema: z.object({ documentRef, sequenceRef, audioDocumentRef, modelId: z.string().min(1).optional(), language: z.enum(['zh', 'en']).optional().describe('口播识别语言提示：zh 中文，en 英语；省略沿用口播默认。'), ...autoSubtitleOptionsSchema.shape }).strict(),
  outputSchema: z.object({ documentRef, audioDocumentRef, captionRefs: z.array(ref('video_edit.caption')), createdCaptionRefs: z.array(ref('video_edit.caption')), message: z.string(), verified: z.boolean() }).strict(),
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`, resolveOperationTargets: input => [input.documentRef, input.audioDocumentRef], resolveOperationWriteTargets: input => [input.documentRef, input.audioDocumentRef],
  control: capabilityControl('execute', ['video_edit.caption', 'audio_edit.document'], { cancelable: true, revisionScopes: ['video_edit', 'audio_edit'], alsoImpacts: [{ effect: 'create', entityTypes: ['video_edit.caption'] }] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => [
    { effect: 'execute' as const, entityTypes: ['audio_edit.document'], propertyIds: [], targetRefs: [output.audioDocumentRef], count: 1, verified: output.verified, evidence: output.verified ? ['识别结果保存为口播文档，可继续按原引用恢复。'] : [] },
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
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`, resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: input => [input.documentRef],
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
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`, resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: input => [input.documentRef],
  control: capabilityControl('execute', ['video_edit.caption'], { revisionScopes: ['video_edit'], alsoImpacts: [{ effect: 'update', entityTypes: ['video_edit.caption'], propertyIds: ['video_edit.caption.text', 'video_edit.caption.duration'] }, { effect: 'create', entityTypes: ['video_edit.caption'] }] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => [
    ...refBatches(output.captionRefs).map(targetRefs => ({ effect: 'execute' as const, entityTypes: ['video_edit.caption'], propertyIds: [], targetRefs, count: targetRefs.length, verified: output.verified, evidence: output.verified ? ['整理后的字幕已保存并回读。'] : [] })),
    ...refBatches(output.updatedCaptionRefs).map(targetRefs => ({ effect: 'update' as const, entityTypes: ['video_edit.caption'], propertyIds: ['video_edit.caption.text', 'video_edit.caption.duration'], targetRefs, count: targetRefs.length, verified: output.verified, evidence: output.verified ? ['原字幕保留第一段并已回读核对。'] : [] })),
    ...refBatches(output.createdCaptionRefs).map(targetRefs => ({ effect: 'create' as const, entityTypes: ['video_edit.caption'], propertyIds: [], targetRefs, count: targetRefs.length, verified: output.verified, evidence: output.verified ? ['新增分段已从剪辑文件回读核对。'] : [] })),
  ], summarize: output => output.message,
})
export const VIDEO_EDIT_SUBTITLE_CAPABILITIES = [prepareVideoEditSubtitleCapability, generateVideoEditSubtitleCapability, translateVideoEditSubtitleCapability, segmentVideoEditSubtitleCapability]
