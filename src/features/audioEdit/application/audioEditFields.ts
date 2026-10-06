import { type ApplicationFieldDefinition, type ApplicationPropertyDescriptor, type JsonValue, fieldWriterTable } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import type { AudioEditProjectDocument, AudioEditProcessorDescriptor } from '@/core/audioEdit/types'
import { applyAudioEditSuggestion, audioEditSuggestionState, dismissAudioEditSuggestion, setAudioEditBlocks } from '@/core/audioEdit/edits'
import { audioEditCutsSchema, audioEditSettingsSchema, audioEditFrameRateSchema, audioEditProcessorChainSchema, audioEditViewSettingsSchema } from '@/core/audioEdit/schema'
import { DEFAULT_AUDIO_EDIT_VIEW_SETTINGS } from '@/core/audioEdit/edits'
import { hasAudioEditModifications } from '@/core/audioEdit/baseline'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'

export const AUDIO_EDIT_ENTITY_TYPES = { project: 'audio_edit.document', transcriptBlock: 'audio_edit.transcript_block', suggestion: 'audio_edit.suggestion', processorChain: 'audio_edit.processor_chain', render: 'audio_edit.render' } as const
export type AudioEditEntityType = typeof AUDIO_EDIT_ENTITY_TYPES[keyof typeof AUDIO_EDIT_ENTITY_TYPES]
export interface AudioEditFieldSource { document: AudioEditProjectDocument; childId: string; availableProcessors?: AudioEditProcessorDescriptor[] }
export function audioEditSchemaRef(kind: 'entity' | 'property', id: string) {
  const value = [...id].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${value.padEnd(64, value).slice(0, 64)}` } as const
}
function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue }
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('INVALID_VALUE'); return value }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('INVALID_VALUE'); return value }
function block(source: AudioEditFieldSource) { const found = source.document.transcript.find((item) => item.id === source.childId); if (!found) throw new Error('NOT_FOUND'); return found }
function suggestion(source: AudioEditFieldSource) { const found = source.document.suggestions.find((item) => item.id === source.childId); if (!found) throw new Error('NOT_FOUND'); return found }
function field(entityType: AudioEditEntityType, suffix: string, title: string, value: ApplicationPropertyDescriptor['value'], read: (source: AudioEditFieldSource) => JsonValue, write?: (source: AudioEditFieldSource, value: JsonValue | undefined) => void, storeActions: string[] = []): ApplicationFieldDefinition<AudioEditFieldSource, AudioEditFieldSource> {
  const id = `${entityType}.${suffix}`
  return { propertyId: id, descriptor: { id, entityType, version: 1, title, description: `口播剪辑${title}。`, value, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['audio_edit:read'], write: write ? ['audio_edit:write'] : [] }, revisionScopes: ['audio_edit'], schemaRef: audioEditSchemaRef('property', id), ...(!write ? { readOnlyReason: '由源媒体、识别结果或剪辑时间线计算。' } : {}) }, read, ...(write ? { writer: { write: (draft, mutation) => write(draft, mutation.value) } } : {}), storeActions }
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
    field(E.transcriptBlock, 'start_frame', '开始帧', INT, (s) => block(s).startFrame),
    field(E.transcriptBlock, 'end_frame', '结束帧', INT, (s) => block(s).endFrame),
    field(E.transcriptBlock, 'included', '是否保留', BOOL, (s) => block(s).included, (s, v) => { if (block(s).locked) throw new Error('词块已锁定'); s.document = setAudioEditBlocks(s.document, [s.childId], boolean(v)) }, ['toggleBlock', 'setBlocksIncluded']),
    field(E.transcriptBlock, 'locked', '是否锁定', BOOL, (s) => block(s).locked, (s, v) => { block(s).locked = boolean(v) }),
    field(E.transcriptBlock, 'granularity', '时间戳粒度', { kind: 'enum', values: [{ value: 'word', label: '逐词' }, { value: 'segment', label: '句段' }] }, (s) => block(s).granularity),
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
  [E.processorChain]: [
    field(E.processorChain, 'vst_enabled', '声音处理试听', BOOL, (s) => s.document.vstEnabled, (s, v) => { s.document.vstEnabled = boolean(v) }, ['setVstEnabled']),
    field(E.processorChain, 'available_processors', '可用声音处理器及参数', objectValue('audio_edit.processors'), (s) => json(s.availableProcessors ?? [])),
    field(E.processorChain, 'recipe', '声音处理配方', objectValue('audio_edit.recipe'), (s) => json(s.document.processorChain ?? []), (s, v) => { s.document.processorChain = audioEditProcessorChainSchema.parse(v); s.document.vstEnabled = false }),
  ],
  [E.render]: [
    field(E.render, 'output_duration_frames', '剪后时长帧数', INT, (s) => editedDurationFrames(buildProjectAudioEditTimeline(s.document))),
    field(E.render, 'removed_block_count', '删除词块数量', INT, (s) => s.document.transcript.filter((b) => !b.included).length),
  ],
}
export function audioEditWriterTable(entityType: AudioEditEntityType) { return fieldWriterTable(AUDIO_EDIT_FIELDS[entityType]) }

