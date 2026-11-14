import { audioEditGainRegionsSchema, audioEditRepairsSchema } from '@/core/audioEdit/regions'
import { audioEditEffectChainSchema, audioEditOutputSchema } from '@/core/audioEdit/effects'
import { z } from 'zod'
import { type ApplicationFieldDefinition, type ApplicationPropertyDescriptor, type JsonValue, fieldWriterTable } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import type { AudioEditProjectDocument, AudioEditProcessorDescriptor, AudioEditTranscriptBlock } from '@/core/audioEdit/types'
import { applyAudioEditSuggestion, audioEditSuggestionOptionBlocker, audioEditSuggestionState, chooseAudioEditSuggestionOption, chosenAudioEditSuggestionOption, dismissAudioEditSuggestion, setAudioEditBlocks, updateAudioEditCut } from '@/core/audioEdit/edits'
import { audioEditCutsSchema, audioEditSettingsSchema, audioEditFrameRateSchema, audioEditViewSettingsSchema } from '@/core/audioEdit/schema'
import { DEFAULT_AUDIO_EDIT_VIEW_SETTINGS } from '@/core/audioEdit/edits'
import { hasAudioEditModifications } from '@/core/audioEdit/baseline'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'
import { setAudioEditBreathHandling, type AudioEditBreathView } from '@/core/audioEdit/breaths'
import { describeAudioEditCaptions, setAudioEditCaptionText } from '@/core/audioEdit/captionReview'
import { joinAudioEditText } from '@/core/audioEdit/captions'
import type { AudioBreath } from '@/core/audioAnalysis/breath/respiro'

export const AUDIO_EDIT_ENTITY_TYPES = { project: 'audio_edit.document', transcriptBlock: 'audio_edit.transcript_block', cut: 'audio_edit.cut', caption: 'audio_edit.caption', suggestion: 'audio_edit.suggestion', breath: 'audio_edit.breath', processorChain: 'audio_edit.processor_chain', render: 'audio_edit.render' } as const
export type AudioEditEntityType = typeof AUDIO_EDIT_ENTITY_TYPES[keyof typeof AUDIO_EDIT_ENTITY_TYPES]
export interface AudioEditFieldSource { document: AudioEditProjectDocument; childId: string; availableProcessors?: AudioEditProcessorDescriptor[]; breaths?: { views: AudioEditBreathView[]; raw: AudioBreath[] }; sourceProblem?: string }
export function audioEditSchemaRef(kind: 'entity' | 'property', id: string) {
  const version = id === AUDIO_EDIT_ENTITY_TYPES.transcriptBlock || id.startsWith(`${AUDIO_EDIT_ENTITY_TYPES.transcriptBlock}.`) ? 2 : 1
  const value = [...(version === 1 ? id : `${id}:v${version}`)].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version, digest: `sha256:${value.padEnd(64, value).slice(0, 64)}` } as const
}
function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue }
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('INVALID_VALUE'); return value }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('INVALID_VALUE'); return value }
function block(source: AudioEditFieldSource) { const found = source.document.transcript.find((item) => item.id === source.childId); if (!found) throw new Error('NOT_FOUND'); return found }
/*
 * 写入器只做不可变更新（换掉改到的那个节点，其余沿用原引用）：作品发布后是冻结的，原地修改会当场报错；
 * 沿用的子树在提交时不必重新校验，一小时口播改一个词不再整份复制和校验。
 */
function replaceBlock(source: AudioEditFieldSource, patch: Partial<AudioEditTranscriptBlock>, respectLock = true): void {
  const item = block(source)
  if (respectLock && item.locked) throw new Error('词块已锁定')
  source.document = { ...source.document, transcript: source.document.transcript.map((entry) => entry === item ? { ...entry, ...patch } : entry) }
}
function setDocument<K extends keyof AudioEditProjectDocument>(source: AudioEditFieldSource, key: K, value: AudioEditProjectDocument[K]): void {
  source.document = { ...source.document, [key]: value }
}
function cut(source: AudioEditFieldSource) { const found = source.document.cuts?.find((item) => item.id === source.childId); if (!found) throw new Error('NOT_FOUND'); return found }
function frame(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_VALUE'); return value }
function breath(source: AudioEditFieldSource) { const found = source.breaths?.views.find((item) => item.id === source.childId); if (!found) throw new Error('NOT_FOUND'); return found }
function caption(source: AudioEditFieldSource) { const found = describeAudioEditCaptions(source.document).find((item) => item.id === source.childId); if (!found) throw new Error('NOT_FOUND'); return found }
function suggestion(source: AudioEditFieldSource) { const found = source.document.suggestions.find((item) => item.id === source.childId); if (!found) throw new Error('NOT_FOUND'); return found }

/** 线索上下文单侧最多取的字数：没有标点的长段也只带出一句左右，不把半篇稿子塞给助手。 */
const CLUE_CONTEXT_MAX_CHARS = 60
const CLAUSE_END = /[。！？.!?；;，,、…]$/
interface SuggestionTexts { removed: string; kept: string; before: string; after: string }
const suggestionTextCache = new WeakMap<AudioEditProjectDocument, Map<string, SuggestionTexts>>()
const joinBlocks = (blocks: readonly AudioEditTranscriptBlock[]): string => blocks.reduce((text, item) => joinAudioEditText(text, item.text.trim()), '')
/**
 * 线索的文字与上下文（读取时由词块现算，不落盘）：上下文只取还听得到的词，跳过已删的；
 * 向前取到上一处句读为止，向后取到句读并至少与被删段一样长（重念时后一段通常就是重来的那一遍）。
 */
function suggestionTexts(source: AudioEditFieldSource): SuggestionTexts {
  const { document } = source
  let cache = suggestionTextCache.get(document)
  if (!cache) { cache = new Map(); suggestionTextCache.set(document, cache) }
  const cached = cache.get(source.childId)
  if (cached) return cached
  const item = suggestion(source)
  const transcript = document.transcript
  const own = new Set(item.blockIds)
  const indices = transcript.flatMap((entry, index) => own.has(entry.id) ? [index] : [])
  const bound = (index: number) => index < 0 ? transcript.length : index
  const head = indices.length ? indices[0] : bound(transcript.findIndex((entry) => entry.endFrame > item.startFrame))
  const tail = indices.length ? indices.at(-1)! + 1 : bound(transcript.findIndex((entry) => entry.startFrame >= item.endFrame))
  const audible = (entry: AudioEditTranscriptBlock) => entry.included && !own.has(entry.id)
  const forward = (from: number, minChars: number): { text: string; next: number } => {
    const picked: AudioEditTranscriptBlock[] = []
    let index = from, length = 0
    for (; index < transcript.length && length < CLUE_CONTEXT_MAX_CHARS; index++) {
      const entry = transcript[index]
      if (!audible(entry)) continue
      picked.push(entry); length += entry.text.trim().length
      if (length >= minChars && CLAUSE_END.test(entry.text.trim())) { index++; break }
    }
    return { text: joinBlocks(picked), next: index }
  }
  const picked: AudioEditTranscriptBlock[] = []
  for (let index = head - 1, length = 0; index >= 0 && length < CLUE_CONTEXT_MAX_CHARS; index--) {
    const entry = transcript[index]
    if (!audible(entry)) continue
    if (picked.length && CLAUSE_END.test(entry.text.trim())) break
    picked.unshift(entry); length += entry.text.trim().length
  }
  const removed = joinBlocks(indices.map((index) => transcript[index]))
  const kept = forward(tail, removed.length)
  const texts = { removed, kept: kept.text, before: joinBlocks(picked), after: forward(kept.next, 0).text }
  cache.set(source.childId, texts)
  return texts
}
/** 做法里每段文字最多给这么多字：接缝一侧的上下文、被删文字的一头 */
const OPTION_TEXT_CHARS = 14
/** 已自动删的重念里，把握低于这个数的值得助手抽看。依据见 tickets/46-正式使用链路/设计-口播粗剪算法.md 8.6：定稿用例四种条件下，低于它的自动删除错了约两成，不低于它的约百分之五 */
const CHECK_SCORE = 0.7
// 文档每次修改都换新对象：按文档对象记下算过的结果，同一版文档里一条线索只算一次（分页读几十条线索、逐条查可写性时不重复扫全文）
const clueCache = new WeakMap<AudioEditProjectDocument, Map<string, unknown>>()
function perClue<T>(source: AudioEditFieldSource, name: string, compute: () => T): T {
  let cache = clueCache.get(source.document)
  if (!cache) { cache = new Map(); clueCache.set(source.document, cache) }
  const key = `${name}:${source.childId}`
  if (!cache.has(key)) cache.set(key, compute())
  return cache.get(key) as T
}
const chosenOption = (source: AudioEditFieldSource): string => perClue(source, 'chosen', () => chosenAudioEditSuggestionOption(source.document, suggestion(source)) ?? '')
const suggestionOptions = (source: AudioEditFieldSource): JsonValue => perClue(source, 'options', () => json(describeSuggestionOptions(source)))
export interface AudioEditSuggestionOptionText { id: string; current?: true; removed_text: string; reads_as: string }
/**
 * 一处重念除“都留着”以外的各种做法（读取时现算）：删掉什么、接缝两侧连起来读是什么样。
 * 只给接缝两侧各十几个字与被删文字的头尾：整段上下文在线索自己的 removed_text、kept_text、before_text、after_text 里已经给过一次，
 * 一小时口播有上百条待确认，每种做法再各带一遍整段就是十几万字。
 * 这条线索自己已经删掉的词当作还在，再按这种做法删；别的线索、用户手动删掉的词不归这条线索管，哪种做法下都不算在内。
 */
function describeSuggestionOptions(source: AudioEditFieldSource): AudioEditSuggestionOptionText[] {
  const item = suggestion(source)
  const options = (source.document.suggestionHandoff?.[item.id]?.options ?? []).filter((option) => option.blockIds.length)
  if (!options.length) return []
  const transcript = source.document.transcript
  const position = new Map(transcript.map((entry, index) => [entry.id, index]))
  const own = new Set(item.status === 'applied' ? item.blockIds : [])
  const present = (entry: AudioEditTranscriptBlock) => entry.included || own.has(entry.id)
  const current = chosenOption(source)
  return options.flatMap((option): AudioEditSuggestionOptionText[] => {
    const indices = option.blockIds.flatMap((id) => position.has(id) ? [position.get(id)!] : [])
    if (!indices.length) return []
    const first = Math.min(...indices), last = Math.max(...indices)
    const removedIds = new Set(option.blockIds)
    let before = '', after = ''
    for (let index = first - 1; index >= 0 && before.length < OPTION_TEXT_CHARS; index--) if (present(transcript[index]) && !removedIds.has(transcript[index].id)) before = joinAudioEditText(transcript[index].text.trim(), before)
    for (let index = last + 1; index < transcript.length && after.length < OPTION_TEXT_CHARS; index++) if (present(transcript[index]) && !removedIds.has(transcript[index].id)) after = joinAudioEditText(after, transcript[index].text.trim())
    const removed = joinBlocks(transcript.filter((entry) => removedIds.has(entry.id)))
    return [{
      id: option.id, ...(option.id === current ? { current: true } : {}),
      removed_text: removed.length > OPTION_TEXT_CHARS * 2 + 1 ? `${removed.slice(0, OPTION_TEXT_CHARS)}…${removed.slice(-OPTION_TEXT_CHARS)}` : removed,
      reads_as: `${before}｜${after}`,
    }]
  })
}
/** 这条重念线索要不要助手看：decide 待确认、必须裁决；check 已自动删但把握不高或是口吃，值得抽看；none 其余。 */
function suggestionAttention(source: AudioEditFieldSource): 'decide' | 'check' | 'none' {
  return perClue(source, 'attention', () => {
    const item = suggestion(source)
    if (item.kind !== 'retake') return 'none'
    const state = audioEditSuggestionState(source.document, item)
    if (item.status === 'pending') return state === 'available' ? 'decide' : 'none'
    const handoff = source.document.suggestionHandoff?.[item.id]
    return item.status === 'applied' && state === 'removed' && handoff?.score !== undefined && (handoff.score < CHECK_SCORE || handoff.reason === 'stutter') ? 'check' : 'none'
  })
}
/** 界面与助手读同一份判断：线索要不要看、各种做法删完读起来的样子、被删的文字与前后文。 */
export const audioEditSuggestionAttention = (document: AudioEditProjectDocument, id: string): 'decide' | 'check' | 'none' => suggestionAttention({ document, childId: id })
export const audioEditSuggestionOptionTexts = (document: AudioEditProjectDocument, id: string): readonly AudioEditSuggestionOptionText[] => perClue({ document, childId: id }, 'optionTexts', () => describeSuggestionOptions({ document, childId: id }))
export const audioEditSuggestionTexts = (document: AudioEditProjectDocument, id: string): Readonly<SuggestionTexts> => suggestionTexts({ document, childId: id })
/** 整份口播里要助手或人看的重念线索数：decide 必须裁决，check 已自动删、值得抽看（与 audio_edit.suggestion.attention 同一判断）。 */
export function audioEditRetakeAttentionCounts(document: AudioEditProjectDocument): { decide: number; check: number } {
  const counts = { decide: 0, check: 0 }
  for (const item of document.suggestions) {
    const attention = suggestionAttention({ document, childId: item.id })
    if (attention !== 'none') counts[attention]++
  }
  return counts
}
/**
 * 线索面板上的分层，界面与助手读同一份：decide 要人定（待确认，或助手标给用户试听的），check 已自动删但值得抽看，
 * auto 已自动处理或助手已定，hint 还没处理的语气词与长停顿。不在面板里的（失效、锁定、语气词与停顿已处理掉）为 null。
 * 注意 suggestion.status 只是线索标记：pending 的语气词若声音已被别的处理删掉，面板里不再出现。
 */
export type AudioEditClueTier = 'decide' | 'check' | 'auto' | 'hint'
export function audioEditClueTier(document: AudioEditProjectDocument, item: AudioEditProjectDocument['suggestions'][number]): AudioEditClueTier | null {
  const state = audioEditSuggestionState(document, item)
  if (item.kind !== 'retake') return state === 'available' ? 'hint' : null
  if (document.suggestionHandoff?.[item.id]?.audience === 'user') return state === 'stale' ? null : 'decide'
  if (!(state === 'available' || (item.status === 'applied' && state === 'removed') || (item.status === 'dismissed' && state === 'dismissed'))) return null
  const attention = suggestionAttention({ document, childId: item.id })
  return attention === 'decide' ? 'decide' : attention === 'check' ? 'check' : 'auto'
}
export function audioEditClueCounts(document: AudioEditProjectDocument): Record<AudioEditClueTier, number> {
  const counts = { decide: 0, check: 0, auto: 0, hint: 0 }
  for (const item of document.suggestions) {
    const tier = audioEditClueTier(document, item)
    if (tier) counts[tier]++
  }
  return counts
}
function field(entityType: AudioEditEntityType, suffix: string, title: string, value: ApplicationPropertyDescriptor['value'], read: (source: AudioEditFieldSource) => JsonValue, write?: (source: AudioEditFieldSource, value: JsonValue | undefined) => void | Promise<void>, storeActions: string[] = [], description = `口播剪辑${title}。`): ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource> {
  const id = `${entityType}.${suffix}`
  return { propertyId: id, descriptor: { id, entityType, version: audioEditSchemaRef('property', id).version, title, description, value, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['audio_edit:read'], write: write ? ['audio_edit:write'] : [] }, revisionScopes: ['audio_edit'], schemaRef: audioEditSchemaRef('property', id), ...(!write ? { readOnlyReason: '由源媒体、识别结果或剪辑时间线计算。' } : {}) }, read, ...(write ? { writer: { write: (draft, mutation) => write(draft, mutation.value) } } : {}), storeActions }
}
/** 内容长、只有少数线索用得上的属性：不点名的整实体读取不带它 */
function omitFromDefaultRead(definition: ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource>): ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource> {
  return { ...definition, descriptor: { ...definition.descriptor, omitFromDefaultRead: true } }
}
/** 写入后读回的值可能与写入值写法不同（如路径被规范化），以执行器证据验收。 */
function verifiedByExecution(definition: ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource>): ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource> {
  return { ...definition, descriptor: { ...definition.descriptor, verificationStrategy: 'execution' } }
}
/** 写入后按排版规则读回（补中英文空格、去行尾标点），读回与写入值写法不同但已生效。 */
function normalizedOnWrite(definition: ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource>): ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource> {
  return { ...definition, descriptor: { ...definition.descriptor, valueComparison: 'normalized' } }
}
function readOnly(definition: ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource>, reason: string): ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource> {
  return { ...definition, descriptor: { ...definition.descriptor, readOnlyReason: reason } }
}
const TEXT = { kind: 'string', maxLength: 20000 } as const
/** 参考稿不设长度上限：长稿读取按 textPage 分段取。 */
const REFERENCE_SCRIPT = { kind: 'string' } as const
const BOOL = { kind: 'boolean' } as const
const INT = { kind: 'integer', hardRange: { min: 0 } } as const
const objectValue = (id: string): ApplicationPropertyDescriptor['value'] => ({ kind: 'json', schemaRef: audioEditSchemaRef('property', id) })
const E = AUDIO_EDIT_ENTITY_TYPES
export const AUDIO_EDIT_FIELDS: Record<AudioEditEntityType, ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource>[]> = {
  [E.project]: [
    // 口播名就是文件名（3.3）：只读，改名走通用文档属性 documents.document.name
    readOnly(field(E.project, 'name', '口播名（文件名）', { kind: 'string', minLength: 1, maxLength: 200 }, (s) => s.document.name), '口播名就是文件名，请改 documents.document.name（同一文档 ID）。'),
    field(E.project, 'reference_script', '参考逐字稿', REFERENCE_SCRIPT, (s) => s.document.referenceScript, (s, v) => setDocument(s, 'referenceScript', string(v)), ['setReferenceScript']),
    field(E.project, 'batch_settings', '批量剪辑设置', objectValue('audio_edit.batch_settings'), (s) => json(s.document.batchSettings ?? {}), (s, v) => setDocument(s, 'batchSettings', audioEditSettingsSchema.parse(v))),
    readOnly(field(E.project, 'cuts', '声音编辑区间总览（mode 为 delete 删除或 mute 静音，省略时删除）', objectValue('audio_edit.cuts'), (s) => json(s.document.cuts ?? [])),
      '逐条增删改请用 audio_edit.cut 实体（create_items / remove_items / set_properties），只换改到的那一处，不会覆盖别人同时改的其他剪切。'),
    field(E.project, 'gain_regions', '音量区域（采样帧、分贝与淡入淡出采样帧）', objectValue('audio_edit.gain_regions'), s => json(s.document.gainRegions ?? []), (s, v) => setDocument(s, 'gainRegions', audioEditGainRegionsSchema.parse(v))),
    field(E.project, 'repairs', '声音修复区域（源采样帧、Hz、强度、启用与归一化画笔）', objectValue('audio_edit.repairs'), s => json(s.document.repairs ?? []), (s, v) => setDocument(s, 'repairs', audioEditRepairsSchema.parse(v))),
    field(E.project, 'effect_chain', '效果控件（有顺序的效果链）', objectValue('audio_edit.effect_chain'), s => json(s.document.effectChain ?? []), (s, v) => setDocument(s, 'effectChain', audioEditEffectChainSchema.parse(v)), [],
      '效果控件：从上到下依次处理录音本身（源时间，剪辑区间只决定播放哪些部分；效果从不改变时长）。每项 { id, kind, enabled, … }：'
      + 'builtin（name、amount 0–1 效果强度、builtin { id 音频内置效果 ID, params 参数同剪辑的音频效果 }）；essential 基本声音（settings 同剪辑片段的基本声音，不含 loudness / volume）；'
      + 'mouth_declick 去除口水音（sensitivity 0–100、analyzed、clicks 要修掉的源采样帧范围、skipped 用户关掉不处理的范围；检测用 detect_audio_edit_mouth_clicks，某处听着不对就把它从 clicks 挪到 skipped）；breath 呼吸声（mode attenuate 减弱 / mute 静音、reductionDb、breaths 源采样帧范围）；'
      + 'separation（mode isolate 人声分离 / dereverb 去混响、amount 0–1）；plugin 第三方插件（name、pluginId 取自 audio_edit.processor_chain 的 available_processors、parameters 参数名到 0–1）。最多 32 项。'),
    field(E.project, 'chain_bypassed', '效果控件整体关闭', BOOL, s => s.document.chainBypassed ?? false, (s, v) => setDocument(s, 'chainBypassed', boolean(v)), [],
      '为 true 时试听与导出都不经过效果链（对比处理前后）；输出一节照常。'),
    field(E.project, 'output', '输出（作用在剪好的整条声音上）', objectValue('audio_edit.output'), s => json(s.document.output ?? { volumeDb: 0 }), (s, v) => setDocument(s, 'output', audioEditOutputSchema.parse(v)), [],
      '输出：volumeDb 音量 -24–24 dB；loudness 自动匹配响度 { enabled, targetLufs 目标积分响度, gainDb 补偿 }，打开时末尾限幅 -1 dB；gainDb 由 match_audio_edit_loudness 测量后写入。'),
    field(E.project, 'view_settings', '文字大小、左右留白与时间轴字幕', objectValue('audio_edit.view_settings'), (s) => json(s.document.viewSettings ?? DEFAULT_AUDIO_EDIT_VIEW_SETTINGS), (s, v) => setDocument(s, 'viewSettings', audioEditViewSettingsSchema.parse(v))),
    field(E.project, 'xml_frame_rate', '音频 XML 帧率', objectValue('audio_edit.frame_rate'), (s) => json(s.document.xmlFrameRate ?? { numerator: 25, denominator: 1 }), (s, v) => setDocument(s, 'xmlFrameRate', audioEditFrameRateSchema.parse(v))),
    field(E.project, 'selected_asr_model_id', '语音识别模型', TEXT, (s) => s.document.selectedAsrModelId ?? ''),
    // 重新定位原素材：与界面“重新定位”同一个主进程核对（内容必须与原素材相同，不同的请当新口播导入）
    // 素材不随普通编辑与撤销改变，写入由 AudioEditMutationExecutor 先交给 relinkAudioEdit，不经这里的草稿写入
    verifiedByExecution(field(E.project, 'source_path', '原素材文件路径', { kind: 'string', minLength: 1, maxLength: 4096 }, (s) => s.document.source.sourcePath, () => {
      throw new Error('INTERNAL:source_path 由口播执行器经重新定位服务写入。')
    }, [], '原素材在本机的路径。原文件被移动或改名、source_problem 报找不到时，写入新位置的本机绝对路径即重新定位：应用核对这个文件与原素材内容相同（不同就拒绝，请用 create_document 新建口播再导入），剪辑、转写与字幕都保留。重新定位不进撤销（撤销其他修改时素材位置不变）。')),
    field(E.project, 'source_problem', '原素材现在能不能用', TEXT, (s) => s.sourceProblem ?? '', undefined, [],
      '空字符串表示原素材在、内容没变；否则是问题说明：找不到原素材（写 source_path 重新定位）或内容已改变（需要新建口播重新导入）。'),
    field(E.project, 'duration_frames', '源时长帧数', INT, (s) => s.document.source.durationFrames),
    field(E.project, 'sample_rate', '采样率', INT, (s) => s.document.source.sampleRate),
    field(E.project, 'clue_counts', '线索面板上的数目（与界面同一份）：decide 待定、check 建议抽看、auto 已自动处理、hint 还没处理的语气词与停顿', objectValue('audio_edit.clue_counts'), (s) => json(audioEditClueCounts(s.document))),
    field(E.project, 'has_modifications', '是否存在可全部撤销的修改', BOOL, (s) => hasAudioEditModifications(s.document)),
    field(E.project, 'original_text_available', '是否保留原始识别文本（旧口播为否，不能恢复过去的文字纠正）', BOOL, (s) => s.document.editBaseline?.kind === 'original'),
  ],
  [E.transcriptBlock]: [
    field(E.transcriptBlock, 'document_id', '所属口播（口播文档 ID，分页读取时可按此筛选）', TEXT, (s) => s.document.id),
    field(E.transcriptBlock, 'original_text', '保留的初始文本（旧口播为升级时的文字）', TEXT, (s) => s.document.editBaseline?.transcript.find((item) => item.id === s.childId)?.text ?? block(s).text),
    field(E.transcriptBlock, 'text', '校正文本', TEXT, (s) => block(s).text, (s, v) => replaceBlock(s, { text: string(v) })),
    field(E.transcriptBlock, 'caption_break_after', '此词之后结束字幕段（不改变声音或时间戳）', BOOL, (s) => block(s).captionBreakAfter ?? false, (s, v) => replaceBlock(s, { captionBreakAfter: boolean(v) })),
    field(E.transcriptBlock, 'start_frame', '开始采样帧（除以 sample_rate 得秒，非视频帧）', INT, (s) => block(s).startFrame),
    field(E.transcriptBlock, 'end_frame', '结束采样帧（除以 sample_rate 得秒，非视频帧）', INT, (s) => block(s).endFrame),
    field(E.transcriptBlock, 'sample_rate', '时间戳采样率（每秒采样帧数）', INT, (s) => s.document.source.sampleRate),
    field(E.transcriptBlock, 'included', '是否保留', BOOL, (s) => block(s).included, (s, v) => { if (block(s).locked) throw new Error('词块已锁定'); s.document = setAudioEditBlocks(s.document, [s.childId], boolean(v)) }, ['toggleBlock', 'setBlocksIncluded']),
    field(E.transcriptBlock, 'locked', '是否锁定', BOOL, (s) => block(s).locked, (s, v) => replaceBlock(s, { locked: boolean(v) }, false)),
    field(E.transcriptBlock, 'granularity', '时间戳粒度', { kind: 'enum', values: [{ value: 'word', label: '逐词' }, { value: 'segment', label: '句段' }] }, (s) => block(s).granularity),
  ],
  [E.cut]: [
    field(E.cut, 'document_id', '所属口播（口播文档 ID，分页读取时可按此筛选）', TEXT, (s) => s.document.id),
    field(E.cut, 'start_frame', '开始采样帧（原素材时间，除以 sample_rate 得秒）', INT, (s) => cut(s).startFrame, (s, v) => { s.document = updateAudioEditCut(s.document, cut(s).id, { startFrame: frame(v) }) }),
    field(E.cut, 'end_frame', '结束采样帧（原素材时间，须晚于开始）', INT, (s) => cut(s).endFrame, (s, v) => { s.document = updateAudioEditCut(s.document, cut(s).id, { endFrame: frame(v) }) }),
    field(E.cut, 'enabled', '是否生效（停用的自动剪切留作标记，之后重跑呼吸、气口处理也不再剪这里）', BOOL, (s) => cut(s).enabled, (s, v) => { s.document = updateAudioEditCut(s.document, cut(s).id, { enabled: boolean(v) }) }),
    field(E.cut, 'mode', '处理方式：delete 删除这段（成片变短）、mute 静音（保留时长）', { kind: 'enum', values: [{ value: 'delete', label: '删除' }, { value: 'mute', label: '静音' }] }, (s) => cut(s).mode ?? 'delete', (s, v) => {
      if (v !== 'delete' && v !== 'mute') throw new Error('mode 只能写 delete 或 mute。')
      s.document = updateAudioEditCut(s.document, cut(s).id, { mode: v })
    }),
    field(E.cut, 'reason', '来源：silence 由停顿、重念、呼吸、气口等自动处理生成，manual 手动添加', { kind: 'enum', values: [{ value: 'silence', label: '自动处理' }, { value: 'manual', label: '手动' }] }, (s) => cut(s).reason),
    field(E.cut, 'sample_rate', '时间戳采样率（每秒采样帧数）', INT, (s) => s.document.source.sampleRate),
  ],
  [E.caption]: [
    field(E.caption, 'document_id', '所属音频作品（文档 ID，分页读取时可按此筛选）', TEXT, (s) => s.document.id),
    normalizedOnWrite(field(E.caption, 'text', '成片字幕文字', TEXT, (s) => caption(s).text, (s, v) => { s.document = setAudioEditCaptionText(s.document, s.childId, string(v)) }, [],
      '成片字幕显示的文字（排版后：中文与英文、数字之间有空格，行尾逗号句号已去掉，单独的“哎”“嗯”等叹词不显示）。'
      + '改写时逐字比对写回这段的词块文字（保留的字留在原词块，删掉的去掉，新加的归前一个字所在的词块），词时间与声音不变；音频编辑里的文字与导出的 SRT 共用；字幕段只供首次放进剪辑时参考：已放进剪辑的字幕文字在剪辑里定稿，这里改字不同步过去（剪切与恢复会让剪辑字幕跟着声音更新）。'
      + '校对原则：既不完全照稿也不完全照识别——实际念的与稿子不同（改词、加词、少念）按实际念的写；同音错字、专有名词、英文大小写、数字按稿子写；拿不准时保留识别。只改字，分段用 audio_edit.transcript_block.caption_break_after。')),
    field(E.caption, 'spoken_text', '这段词块文字原样拼接（识别结果加已有校正，未排版）', TEXT, (s) => caption(s).spokenText),
    field(E.caption, 'original_text', '最初识别的文字（旧作品没有保存时同 spoken_text）', TEXT, (s) => caption(s).originalText),
    field(E.caption, 'script_text', '参考稿里对应的原文（按读音对齐；稿子里没有这段时为空）', TEXT, (s) => caption(s).scriptText),
    field(E.caption, 'script_match', '与参考稿是否一致（只比文字，不比标点与空格）', { kind: 'enum', values: [['same', '与稿子一致'], ['different', '与稿子不同'], ['not_in_script', '稿子里没有']].map(([value, label]) => ({ value, label })) }, (s) => caption(s).scriptMatch),
    field(E.caption, 'start_ms', '在剪后成品里的开始时间（毫秒）', INT, (s) => caption(s).startMs),
    field(E.caption, 'end_ms', '在剪后成品里的结束时间（毫秒；与下一条间隔短于 0.5 秒时已接到下一条开始）', INT, (s) => caption(s).endMs),
    field(E.caption, 'block_ids', '组成这段的词块 ID（按顺序；在最后一个的 caption_break_after 上调整分段）', objectValue('audio_edit.caption_blocks'), (s) => json(caption(s).blockIds)),
  ],
  [E.suggestion]: [
    field(E.suggestion, 'document_id', '所属口播（口播文档 ID）', TEXT, (s) => s.document.id),
    field(E.suggestion, 'title', '线索标题', TEXT, (s) => suggestion(s).title),
    field(E.suggestion, 'detail', '检测线索（非审批，不限制助手基于全文自行判断）', TEXT, (s) => suggestion(s).kind === 'filler' ? '关键词匹配，不代表必须删除；结合全文判断是否影响语义、语气或节奏。' : suggestion(s).detail),
    field(E.suggestion, 'current_state', '当前实际状态（排除已删除、已静音、失效或锁定的线索）', { kind: 'enum', values: [ ['available', '可参考'], ['removed', '声音已处理'], ['dismissed', '已隐藏'], ['locked', '已锁定'], ['stale', '线索已失效'] ].map(([value, label]) => ({ value, label })) }, (s) => audioEditSuggestionState(s.document, suggestion(s))),
    field(E.suggestion, 'status', '线索标记（不代表当前声音状态，也不是需要用户审批的队列）', { kind: 'enum', values: [ ['pending', '候选线索'], ['applied', '曾应用'], ['dismissed', '已隐藏'] ].map(([value, label]) => ({ value, label })) }, (s) => suggestion(s).status, (s, v) => {
      const item = suggestion(s)
      if (v === 'applied') { const next = applyAudioEditSuggestion(s.document, item.id); if (next === s.document) throw new Error('建议已处理、失效或受锁定保护'); s.document = next }
      else if (v === 'dismissed') { const next = dismissAudioEditSuggestion(s.document, item.id); if (next === s.document) throw new Error('这条线索已处理、隐藏、失效或受锁定保护'); s.document = next }
      else throw new Error('该建议不能重复应用或直接恢复状态，请撤销剪辑。')
    }, ['applySuggestion', 'dismissSuggestion'], '口播剪辑线索标记。重念线索优先写 chosen_option（keep_later 等于整条接受，keep_both 等于驳回，还能选留前一遍或换个切点）；这里写 applied / dismissed 是等价的简写，语气词、长停顿线索只能用这里。'),
    field(E.suggestion, 'kind', '线索类型：retake 重念（同一内容念了几遍）、filler 语气词、long_silence 长停顿', { kind: 'enum', values: [['retake', '重念'], ['filler', '语气词'], ['long_silence', '长停顿']].map(([value, label]) => ({ value, label })) }, (s) => suggestion(s).kind),
    field(E.suggestion, 'confidence', '本地算法的把握：high 大、medium 中、low 小（低的先看）', { kind: 'enum', values: [['high', '把握大'], ['medium', '把握中'], ['low', '把握小']].map(([value, label]) => ({ value, label })) }, (s) => suggestion(s).confidence),
    field(E.suggestion, 'start_frame', '线索开始采样帧（原素材时间，除以 sample_rate 得秒）', INT, (s) => suggestion(s).startFrame),
    field(E.suggestion, 'end_frame', '线索结束采样帧（原素材时间）', INT, (s) => suggestion(s).endFrame),
    field(E.suggestion, 'sample_rate', '时间戳采样率（每秒采样帧数）', INT, (s) => s.document.source.sampleRate),
    field(E.suggestion, 'block_ids', '这条线索建议删掉的词块 ID（按顺序，长停顿线索为空）；整条接受写 status=applied（删词并补接缝停顿剪切），只删其中一部分才逐个改 audio_edit.transcript_block.included', objectValue('audio_edit.suggestion_blocks'), (s) => json(suggestion(s).blockIds)),
    field(E.suggestion, 'removed_text', '建议删掉的那段文字（block_ids 原样拼接）', TEXT, (s) => suggestionTexts(s).removed),
    field(E.suggestion, 'kept_text', '紧接在这段之后、还保留着的文字（重念时通常就是重来的那一遍；取到句读为止，至少与被删段一样长）', TEXT, (s) => suggestionTexts(s).kept),
    field(E.suggestion, 'before_text', '前文：这段之前还保留着的一句（取到上一处句读）', TEXT, (s) => suggestionTexts(s).before),
    field(E.suggestion, 'after_text', '后文：kept_text 之后还保留着的一句', TEXT, (s) => suggestionTexts(s).after),
    omitFromDefaultRead(field(E.suggestion, 'options', '这处重念除“都留着”以外可以怎么剪（只有重念线索有）；把选中的 id 写进 chosen_option', objectValue('audio_edit.suggestion_options'), suggestionOptions, undefined, [],
      '每项 { id, current（只在当前做法上出现）, removed_text 这种做法删掉的文字（长的只给头尾）, reads_as 删完后接缝两侧连起来读的样子，“｜”是接缝 }。id：keep_later 留后一遍（删前一遍）、keep_earlier 留前一遍（删后一遍里重复的那一截）、splice_ 开头的是换个切点拼接；另有 keep_both 都留着（不是重念），总是可选，不在列表里。整段上下文看线索自己的 removed_text、kept_text、before_text、after_text。只对需要裁决的线索读它（attention=decide 或 check）。')),
    field(E.suggestion, 'attention', '要不要助手看：decide 待确认、必须裁决；check 已自动删但把握不高，值得抽看；none 其余', { kind: 'enum', values: [['decide', '待确认，必须裁决'], ['check', '已自动删，值得抽看'], ['none', '不用看']].map(([value, label]) => ({ value, label })) }, suggestionAttention, undefined, [],
      '读重念线索时按它筛选（where 里写 attention），只给筛出来的线索点名读 options：本地有把握自动删掉的几百处不必逐条带着做法读一遍。check 指已自动删、把握 score 低于 0.7 或原因是口吃的。'),
    field(E.suggestion, 'chosen_option', '当前做法（options 里的 id，还没处理时为空）；写入一个 id 即改用这种做法', { kind: 'string', maxLength: 40 }, chosenOption, (s, v) => {
      const blocker = audioEditSuggestionOptionBlocker(s.document, suggestion(s))
      if (blocker) throw new Error(blocker)
      const next = chooseAudioEditSuggestionOption(s.document, suggestion(s).id, string(v))
      if (next === s.document) throw new Error('没有这种做法，或它要删的词已经都不在了；先读 options 核对 id。')
      s.document = next
    }, ['applySuggestion', 'dismissSuggestion'], '写入时先恢复这条线索已删的词与停顿，再按新做法删词并补接缝处的停顿剪切。已经自动删掉的重念也可以这样改判（改留前一遍、都留着）；待确认的写 keep_later 等同 status=applied，写 keep_both 等同 status=dismissed。待确认线索要删的内容已被删掉、或已删内容被手动恢复过一部分时不能写。'),
    field(E.suggestion, 'reason', '本地算法凭什么判成重念，或为什么拿不准', { kind: 'enum', values: [
      ['repeated', '两遍几乎相同'], ['script', '对照参考稿，这里往回重念了'], ['marker', '“哎”之后从前一句开头重来'], ['stutter', '口吃（待确认时：也可能是叠词或强调）'], ['loop', '同一截话连着重复很多遍（待确认时：也可能是有意叠说）'],
      ['reworded', '换了说法、没有参考稿佐证，可能本来就是两句'], ['short_repeat', '很短的原样重复，像强调或叠句'], ['parallel', '开头相同的两句，像排比、列举或对比'], ['unsaid', '前一遍里有后一遍没再说的内容'],
      ['complete_clause', '要删的是说完的一整句'], ['joined', '两遍之间没有停顿，不像念坏重来'], ['inside_unsure', '所在的整段重复还没确定'], ['residual', '去重念之后前后两段开头仍相同'], ['none', '没有记录'],
    ].map(([value, label]) => ({ value, label })) }, (s) => s.document.suggestionHandoff?.[suggestion(s).id]?.reason ?? 'none'),
    field(E.suggestion, 'score', '本地算法估的“像念坏重来”的程度（0–1，越大越像；只用来排先后，没有记录时为 0）', { kind: 'number', hardRange: { min: 0, max: 1 } }, (s) => s.document.suggestionHandoff?.[suggestion(s).id]?.score ?? 0),
    field(E.suggestion, 'audience', '这条线索等谁来定：assistant 助手先判断（默认）；user 助手定不了、需要用户试听', { kind: 'enum', values: [['assistant', '助手先判断'], ['user', '需要用户试听']].map(([value, label]) => ({ value, label })) }, (s) => s.document.suggestionHandoff?.[suggestion(s).id]?.audience ?? 'assistant', (s, v) => {
      if (v !== 'assistant' && v !== 'user') throw new Error('audience 只能写 assistant 或 user。')
      const id = suggestion(s).id
      const { audience: _audience, ...rest } = s.document.suggestionHandoff?.[id] ?? {}
      setDocument(s, 'suggestionHandoff', { ...s.document.suggestionHandoff, [id]: v === 'user' ? { ...rest, audience: 'user' } : rest })
    }),
  ],
  [E.breath]: [
    field(E.breath, 'document_id', '所属口播（口播文档 ID，分页读取时可按此筛选）', TEXT, (s) => s.document.id),
    field(E.breath, 'start_frame', '开始采样帧（原素材时间，除以 sample_rate 得秒）', INT, (s) => breath(s).startFrame),
    field(E.breath, 'end_frame', '结束采样帧（原素材时间）', INT, (s) => breath(s).endFrame),
    field(E.breath, 'sample_rate', '时间戳采样率（每秒采样帧数）', INT, (s) => s.document.source.sampleRate),
    field(E.breath, 'confidence', '检测置信度（0–100，模型给出的最高呼吸概率）', INT, (s) => Math.round(breath(s).peak * 100)),
    field(E.breath, 'context', '所在位置', { kind: 'enum', values: [['sentence', '句与句之间'], ['clause', '句中（逗号处或没有标点）'], ['edge', '开头或结尾'], ['touching', '和字连在一起（识别的词时间盖住了大半口气）'], ['removed', '所在声音已被剪掉']].map(([value, label]) => ({ value, label })) }, (s) => breath(s).context),
    field(E.breath, 'before', '前面保留的文字（最多 8 字）', TEXT, (s) => breath(s).before),
    field(E.breath, 'after', '后面保留的文字（最多 8 字）', TEXT, (s) => breath(s).after),
    field(E.breath, 'gap_ms', '剪完后前后两个词之间实际听到的空当（毫秒，含这口气还保留的部分）', INT, (s) => breath(s).gapMs),
    field(E.breath, 'handling', '当前处理：deleted 删掉（两侧原有的安静保留）、attenuated 减弱 18 dB、muted 静音（保留时长）、kept 保留（之后批量处理也不再动）；removed 表示所在声音已被剪掉，不能写', { kind: 'enum', values: [['deleted', '删掉'], ['attenuated', '减弱'], ['muted', '静音'], ['kept', '保留'], ['removed', '已随剪辑去掉']].map(([value, label]) => ({ value, label })) }, (s) => breath(s).handling, (s, v) => {
      if (v !== 'deleted' && v !== 'attenuated' && v !== 'muted' && v !== 'kept') throw new Error('handling 只能写 deleted、attenuated、muted 或 kept。')
      s.document = setAudioEditBreathHandling(s.document, s.breaths?.raw ?? [], breath(s).id, v)
    }),
  ],
  [E.processorChain]: [
    field(E.processorChain, 'available_processors', '可用的第三方插件及参数', objectValue('audio_edit.processors'), (s) => json(s.availableProcessors ?? [])),
  ],
  [E.render]: [
    field(E.render, 'output_duration_frames', '剪后时长帧数', INT, (s) => editedDurationFrames(buildProjectAudioEditTimeline(s.document))),
    field(E.render, 'removed_block_count', '删除词块数量', INT, (s) => s.document.transcript.filter((b) => !b.included).length),
  ],
}
export const AUDIO_EDIT_SOURCE_PATH_PROPERTY = `${E.project}.source_path`
export function audioEditWriterTable(entityType: AudioEditEntityType) { return fieldWriterTable(AUDIO_EDIT_FIELDS[entityType]) }

const audioEditValueSchemas: Record<string, z.ZodType> = {
  'audio_edit.batch_settings': audioEditSettingsSchema,
  'audio_edit.cuts': audioEditCutsSchema,
  'audio_edit.clue_counts': z.object({ decide: z.number().int(), check: z.number().int(), auto: z.number().int(), hint: z.number().int() }).strict(),
  'audio_edit.gain_regions': audioEditGainRegionsSchema,
  'audio_edit.repairs': audioEditRepairsSchema,
  'audio_edit.view_settings': audioEditViewSettingsSchema,
  'audio_edit.frame_rate': audioEditFrameRateSchema,
  'audio_edit.effect_chain': audioEditEffectChainSchema,
  'audio_edit.caption_blocks': z.array(z.string()),
  'audio_edit.suggestion_blocks': z.array(z.string()),
  'audio_edit.suggestion_options': z.array(z.object({ id: z.string(), current: z.boolean().optional(), removed_text: z.string(), reads_as: z.string() })),
  'audio_edit.output': audioEditOutputSchema,
  // 只读描述来自宿主处理器目录，形状与 AudioEditProcessorDescriptor 一致。
  'audio_edit.processors': z.array(z.object({
    id: z.string(), name: z.string(), vendor: z.string(), version: z.string(), available: z.boolean(),
    semanticRole: z.enum(['mouth_declick', 'voice_denoise', 'breath_control']).optional(),
    latencyFrames: z.number().optional(), reason: z.string().optional(),
    parameters: z.array(z.object({ id: z.number(), name: z.string(), normalizedValue: z.number(), displayValue: z.string() })).optional(),
  })),
}
export function audioEditSchemaDocuments(entityType: AudioEditEntityType) {
  return AUDIO_EDIT_FIELDS[entityType].flatMap(({ descriptor }) => descriptor.value.kind === 'json' ? [{
    ref: descriptor.value.schemaRef,
    value: z.toJSONSchema(audioEditValueSchemas[descriptor.value.schemaRef.id], { io: 'input' }) as JsonValue,
  }] : [])
}

