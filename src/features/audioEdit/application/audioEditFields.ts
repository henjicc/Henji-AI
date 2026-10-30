import { audioEditGainRegionsSchema, audioEditRepairsSchema } from '@/core/audioEdit/regions'
import { audioEditEffectChainSchema, audioEditOutputSchema } from '@/core/audioEdit/effects'
import { z } from 'zod'
import { type ApplicationFieldDefinition, type ApplicationPropertyDescriptor, type JsonValue, fieldWriterTable } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import type { AudioEditProjectDocument, AudioEditProcessorDescriptor } from '@/core/audioEdit/types'
import { applyAudioEditSuggestion, audioEditSuggestionState, dismissAudioEditSuggestion, setAudioEditBlocks } from '@/core/audioEdit/edits'
import { audioEditCutsSchema, audioEditSettingsSchema, audioEditFrameRateSchema, audioEditViewSettingsSchema } from '@/core/audioEdit/schema'
import { DEFAULT_AUDIO_EDIT_VIEW_SETTINGS } from '@/core/audioEdit/edits'
import { hasAudioEditModifications } from '@/core/audioEdit/baseline'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'
import { setAudioEditBreathHandling, type AudioEditBreathView } from '@/core/audioEdit/breaths'
import { describeAudioEditCaptions, setAudioEditCaptionText } from '@/core/audioEdit/captionReview'
import type { AudioBreath } from '@/core/audioAnalysis/breath/respiro'

export const AUDIO_EDIT_ENTITY_TYPES = { project: 'audio_edit.document', transcriptBlock: 'audio_edit.transcript_block', caption: 'audio_edit.caption', suggestion: 'audio_edit.suggestion', breath: 'audio_edit.breath', processorChain: 'audio_edit.processor_chain', render: 'audio_edit.render' } as const
export type AudioEditEntityType = typeof AUDIO_EDIT_ENTITY_TYPES[keyof typeof AUDIO_EDIT_ENTITY_TYPES]
export interface AudioEditFieldSource { document: AudioEditProjectDocument; childId: string; availableProcessors?: AudioEditProcessorDescriptor[]; breaths?: { views: AudioEditBreathView[]; raw: AudioBreath[] } }
export function audioEditSchemaRef(kind: 'entity' | 'property', id: string) {
  const version = id === AUDIO_EDIT_ENTITY_TYPES.transcriptBlock || id.startsWith(`${AUDIO_EDIT_ENTITY_TYPES.transcriptBlock}.`) ? 2 : 1
  const value = [...(version === 1 ? id : `${id}:v${version}`)].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version, digest: `sha256:${value.padEnd(64, value).slice(0, 64)}` } as const
}
function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue }
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('INVALID_VALUE'); return value }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('INVALID_VALUE'); return value }
function block(source: AudioEditFieldSource) { const found = source.document.transcript.find((item) => item.id === source.childId); if (!found) throw new Error('NOT_FOUND'); return found }
function breath(source: AudioEditFieldSource) { const found = source.breaths?.views.find((item) => item.id === source.childId); if (!found) throw new Error('NOT_FOUND'); return found }
function caption(source: AudioEditFieldSource) { const found = describeAudioEditCaptions(source.document).find((item) => item.id === source.childId); if (!found) throw new Error('NOT_FOUND'); return found }
function suggestion(source: AudioEditFieldSource) { const found = source.document.suggestions.find((item) => item.id === source.childId); if (!found) throw new Error('NOT_FOUND'); return found }
function field(entityType: AudioEditEntityType, suffix: string, title: string, value: ApplicationPropertyDescriptor['value'], read: (source: AudioEditFieldSource) => JsonValue, write?: (source: AudioEditFieldSource, value: JsonValue | undefined) => void, storeActions: string[] = [], description = `口播剪辑${title}。`): ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource> {
  const id = `${entityType}.${suffix}`
  return { propertyId: id, descriptor: { id, entityType, version: audioEditSchemaRef('property', id).version, title, description, value, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['audio_edit:read'], write: write ? ['audio_edit:write'] : [] }, revisionScopes: ['audio_edit'], schemaRef: audioEditSchemaRef('property', id), ...(!write ? { readOnlyReason: '由源媒体、识别结果或剪辑时间线计算。' } : {}) }, read, ...(write ? { writer: { write: (draft, mutation) => write(draft, mutation.value) } } : {}), storeActions }
}
function readOnly(definition: ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource>, reason: string): ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource> {
  return { ...definition, descriptor: { ...definition.descriptor, readOnlyReason: reason } }
}
const TEXT = { kind: 'string', maxLength: 20000 } as const
const BOOL = { kind: 'boolean' } as const
const INT = { kind: 'integer', hardRange: { min: 0 } } as const
const objectValue = (id: string): ApplicationPropertyDescriptor['value'] => ({ kind: 'json', schemaRef: audioEditSchemaRef('property', id) })
const E = AUDIO_EDIT_ENTITY_TYPES
export const AUDIO_EDIT_FIELDS: Record<AudioEditEntityType, ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource>[]> = {
  [E.project]: [
    // 口播名就是文件名（3.3）：只读，改名走通用文档属性 documents.document.name
    readOnly(field(E.project, 'name', '口播名（文件名）', { kind: 'string', minLength: 1, maxLength: 200 }, (s) => s.document.name), '口播名就是文件名，请改 documents.document.name（同一文档 ID）。'),
    field(E.project, 'reference_script', '参考逐字稿', TEXT, (s) => s.document.referenceScript, (s, v) => { s.document.referenceScript = string(v) }, ['setReferenceScript']),
    field(E.project, 'batch_settings', '批量剪辑设置', objectValue('audio_edit.batch_settings'), (s) => json(s.document.batchSettings ?? {}), (s, v) => { s.document.batchSettings = audioEditSettingsSchema.parse(v) }),
    field(E.project, 'cuts', '声音编辑区间（mode 为 delete 删除或 mute 静音，省略时删除）', objectValue('audio_edit.cuts'), (s) => json(s.document.cuts ?? []), (s, v) => { s.document.cuts = audioEditCutsSchema.parse(v) }),
    field(E.project, 'gain_regions', '音量区域（采样帧、分贝与淡入淡出采样帧）', objectValue('audio_edit.gain_regions'), s => json(s.document.gainRegions ?? []), (s, v) => { s.document.gainRegions = audioEditGainRegionsSchema.parse(v) }),
    field(E.project, 'repairs', '声音修复区域（源采样帧、Hz、强度、启用与归一化画笔）', objectValue('audio_edit.repairs'), s => json(s.document.repairs ?? []), (s, v) => { s.document.repairs = audioEditRepairsSchema.parse(v) }),
    field(E.project, 'effect_chain', '效果控件（有顺序的效果链）', objectValue('audio_edit.effect_chain'), s => json(s.document.effectChain ?? []), (s, v) => { s.document.effectChain = audioEditEffectChainSchema.parse(v) }, [],
      '效果控件：从上到下依次处理录音本身（源时间，剪辑区间只决定播放哪些部分；效果从不改变时长）。每项 { id, kind, enabled, … }：'
      + 'builtin（name、amount 0–1 效果强度、builtin { id 音频内置效果 ID, params 参数同剪辑的音频效果 }）；essential 基本声音（settings 同剪辑片段的基本声音，不含 loudness / volume）；'
      + 'mouth_declick 去除口水音（sensitivity 0–100、analyzed、clicks 要修掉的源采样帧范围、skipped 用户关掉不处理的范围；检测用 detect_audio_edit_mouth_clicks，某处听着不对就把它从 clicks 挪到 skipped）；breath 呼吸声（mode attenuate 减弱 / mute 静音、reductionDb、breaths 源采样帧范围）；'
      + 'separation（mode isolate 人声分离 / dereverb 去混响、amount 0–1）；plugin 第三方插件（name、pluginId 取自 audio_edit.processor_chain 的 available_processors、parameters 参数名到 0–1）。最多 32 项。'),
    field(E.project, 'chain_bypassed', '效果控件整体关闭', BOOL, s => s.document.chainBypassed ?? false, (s, v) => { s.document.chainBypassed = boolean(v) }, [],
      '为 true 时试听与导出都不经过效果链（对比处理前后）；输出一节照常。'),
    field(E.project, 'output', '输出（作用在剪好的整条声音上）', objectValue('audio_edit.output'), s => json(s.document.output ?? { volumeDb: 0 }), (s, v) => { s.document.output = audioEditOutputSchema.parse(v) }, [],
      '输出：volumeDb 音量 -24–24 dB；loudness 自动匹配响度 { enabled, targetLufs 目标积分响度, gainDb 补偿 }，打开时末尾限幅 -1 dB；gainDb 由 match_audio_edit_loudness 测量后写入。'),
    field(E.project, 'view_settings', '文字大小、左右留白与时间轴字幕', objectValue('audio_edit.view_settings'), (s) => json(s.document.viewSettings ?? DEFAULT_AUDIO_EDIT_VIEW_SETTINGS), (s, v) => { s.document.viewSettings = audioEditViewSettingsSchema.parse(v) }),
    field(E.project, 'xml_frame_rate', '音频 XML 帧率', objectValue('audio_edit.frame_rate'), (s) => json(s.document.xmlFrameRate ?? { numerator: 25, denominator: 1 }), (s, v) => { s.document.xmlFrameRate = audioEditFrameRateSchema.parse(v) }),
    field(E.project, 'selected_asr_model_id', '语音识别模型', TEXT, (s) => s.document.selectedAsrModelId ?? ''),
    field(E.project, 'duration_frames', '源时长帧数', INT, (s) => s.document.source.durationFrames),
    field(E.project, 'sample_rate', '采样率', INT, (s) => s.document.source.sampleRate),
    field(E.project, 'has_modifications', '是否存在可全部撤销的修改', BOOL, (s) => hasAudioEditModifications(s.document)),
    field(E.project, 'original_text_available', '是否保留原始识别文本（旧口播为否，不能恢复过去的文字纠正）', BOOL, (s) => s.document.editBaseline?.kind === 'original'),
  ],
  [E.transcriptBlock]: [
    field(E.transcriptBlock, 'document_id', '所属口播（口播文档 ID，分页读取时可按此筛选）', TEXT, (s) => s.document.id),
    field(E.transcriptBlock, 'original_text', '保留的初始文本（旧口播为升级时的文字）', TEXT, (s) => s.document.editBaseline?.transcript.find((item) => item.id === s.childId)?.text ?? block(s).text),
    field(E.transcriptBlock, 'text', '校正文本', TEXT, (s) => block(s).text, (s, v) => { const item = block(s); if (item.locked) throw new Error('词块已锁定'); item.text = string(v) }),
    field(E.transcriptBlock, 'caption_break_after', '此词之后结束字幕段（不改变声音或时间戳）', BOOL, (s) => block(s).captionBreakAfter ?? false, (s, v) => { const item = block(s); if (item.locked) throw new Error('词块已锁定'); item.captionBreakAfter = boolean(v) }),
    field(E.transcriptBlock, 'start_frame', '开始采样帧（除以 sample_rate 得秒，非视频帧）', INT, (s) => block(s).startFrame),
    field(E.transcriptBlock, 'end_frame', '结束采样帧（除以 sample_rate 得秒，非视频帧）', INT, (s) => block(s).endFrame),
    field(E.transcriptBlock, 'sample_rate', '时间戳采样率（每秒采样帧数）', INT, (s) => s.document.source.sampleRate),
    field(E.transcriptBlock, 'included', '是否保留', BOOL, (s) => block(s).included, (s, v) => { if (block(s).locked) throw new Error('词块已锁定'); s.document = setAudioEditBlocks(s.document, [s.childId], boolean(v)) }, ['toggleBlock', 'setBlocksIncluded']),
    field(E.transcriptBlock, 'locked', '是否锁定', BOOL, (s) => block(s).locked, (s, v) => { block(s).locked = boolean(v) }),
    field(E.transcriptBlock, 'granularity', '时间戳粒度', { kind: 'enum', values: [{ value: 'word', label: '逐词' }, { value: 'segment', label: '句段' }] }, (s) => block(s).granularity),
  ],
  [E.caption]: [
    field(E.caption, 'document_id', '所属音频作品（文档 ID，分页读取时可按此筛选）', TEXT, (s) => s.document.id),
    field(E.caption, 'text', '成片字幕文字', TEXT, (s) => caption(s).text, (s, v) => { s.document = setAudioEditCaptionText(s.document, s.childId, string(v)) }, [],
      '成片字幕显示的文字（排版后：中文与英文、数字之间有空格，行尾逗号句号已去掉，单独的“哎”“嗯”等叹词不显示）。'
      + '改写时逐字比对写回这段的词块文字（保留的字留在原词块，删掉的去掉，新加的归前一个字所在的词块），词时间与声音不变；音频编辑里的文字与导出的 SRT 共用；字幕段只供首次放进剪辑时参考，剪辑字幕在剪辑里定稿，不随此处更新。'
      + '校对原则：既不完全照稿也不完全照识别——实际念的与稿子不同（改词、加词、少念）按实际念的写；同音错字、专有名词、英文大小写、数字按稿子写；拿不准时保留识别。只改字，分段用 audio_edit.transcript_block.caption_break_after。'),
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
    }, ['applySuggestion', 'dismissSuggestion']),
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
export function audioEditWriterTable(entityType: AudioEditEntityType) { return fieldWriterTable(AUDIO_EDIT_FIELDS[entityType]) }

const audioEditValueSchemas: Record<string, z.ZodType> = {
  'audio_edit.batch_settings': audioEditSettingsSchema,
  'audio_edit.cuts': audioEditCutsSchema,
  'audio_edit.gain_regions': audioEditGainRegionsSchema,
  'audio_edit.repairs': audioEditRepairsSchema,
  'audio_edit.view_settings': audioEditViewSettingsSchema,
  'audio_edit.frame_rate': audioEditFrameRateSchema,
  'audio_edit.effect_chain': audioEditEffectChainSchema,
  'audio_edit.caption_blocks': z.array(z.string()),
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

