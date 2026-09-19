import {
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
  type JsonValue,
  unrestrictedCollectionAvailability,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { buildAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { getPlatform } from '@/platform/runtime'

export const AUDIO_EDIT_ENTITY_TYPES = {
  project: 'audio_edit.project',
  transcriptBlock: 'audio_edit.transcript_block',
  suggestion: 'audio_edit.suggestion',
  processorChain: 'audio_edit.processor_chain',
  render: 'audio_edit.render',
} as const

type EntityType = typeof AUDIO_EDIT_ENTITY_TYPES[keyof typeof AUDIO_EDIT_ENTITY_TYPES]

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function schemaRef(kind: 'entity' | 'property', id: string) {
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: digest(`${kind}:${id}`) } as const
}

function property(entityType: EntityType, suffix: string, title: string, value: ApplicationPropertyDescriptor['value'], readOnly?: string): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id, entityType, version: 1, title, description: `口播剪辑${title}。`, value,
    nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['audio_edit:read'], write: readOnly ? [] : ['audio_edit:write'] },
    revisionScopes: ['audio_edit'], schemaRef: schemaRef('property', id),
    ...(readOnly ? { readOnlyReason: readOnly } : {}),
  }
}

const STRING = { kind: 'string', maxLength: 20_000 } as const
const BOOLEAN = { kind: 'boolean' } as const
const INTEGER = { kind: 'integer', hardRange: { min: 0 } } as const
const STATUS = { kind: 'enum', values: ['pending', 'applied', 'dismissed'].map((value) => ({ value, label: value })) } as const

const propertiesByEntity: Record<EntityType, ApplicationPropertyDescriptor[]> = {
  [AUDIO_EDIT_ENTITY_TYPES.project]: [
    property(AUDIO_EDIT_ENTITY_TYPES.project, 'name', '工程名', { kind: 'string', maxLength: 200 }),
    property(AUDIO_EDIT_ENTITY_TYPES.project, 'reference_script', '参考逐字稿', STRING),
    property(AUDIO_EDIT_ENTITY_TYPES.project, 'selected_asr_model_id', '语音识别模型', { kind: 'string', maxLength: 300 }, '语音识别模型由转写任务选择。'),
    property(AUDIO_EDIT_ENTITY_TYPES.project, 'duration_frames', '源时长帧数', INTEGER, '源媒体时长不可编辑。'),
    property(AUDIO_EDIT_ENTITY_TYPES.project, 'sample_rate', '采样率', INTEGER, '源媒体采样率不可编辑。'),
  ],
  [AUDIO_EDIT_ENTITY_TYPES.transcriptBlock]: [
    property(AUDIO_EDIT_ENTITY_TYPES.transcriptBlock, 'text', '识别文本', STRING, '首版保留原 ASR 文本，删改通过保留状态表达。'),
    property(AUDIO_EDIT_ENTITY_TYPES.transcriptBlock, 'start_frame', '开始帧', INTEGER, '时间戳由语音识别产生。'),
    property(AUDIO_EDIT_ENTITY_TYPES.transcriptBlock, 'end_frame', '结束帧', INTEGER, '时间戳由语音识别产生。'),
    property(AUDIO_EDIT_ENTITY_TYPES.transcriptBlock, 'included', '是否保留', BOOLEAN),
    property(AUDIO_EDIT_ENTITY_TYPES.transcriptBlock, 'locked', '是否锁定', BOOLEAN),
    property(AUDIO_EDIT_ENTITY_TYPES.transcriptBlock, 'granularity', '时间戳粒度', { kind: 'enum', values: [{ value: 'word', label: '逐词' }, { value: 'segment', label: '句段' }] }, '粒度由模型结果决定。'),
  ],
  [AUDIO_EDIT_ENTITY_TYPES.suggestion]: [
    property(AUDIO_EDIT_ENTITY_TYPES.suggestion, 'title', '建议标题', { kind: 'string', maxLength: 500 }, '建议内容由确定性分析或智能助手产生。'),
    property(AUDIO_EDIT_ENTITY_TYPES.suggestion, 'detail', '建议说明', STRING, '建议内容由确定性分析或智能助手产生。'),
    property(AUDIO_EDIT_ENTITY_TYPES.suggestion, 'status', '处理状态', STATUS),
  ],
  [AUDIO_EDIT_ENTITY_TYPES.processorChain]: [
    property(AUDIO_EDIT_ENTITY_TYPES.processorChain, 'vst_enabled', 'VST3 开关', BOOLEAN),
  ],
  [AUDIO_EDIT_ENTITY_TYPES.render]: [
    property(AUDIO_EDIT_ENTITY_TYPES.render, 'output_duration_frames', '成片时长帧数', INTEGER, '成片时长由编辑计划计算。'),
    property(AUDIO_EDIT_ENTITY_TYPES.render, 'removed_block_count', '删除词块数量', INTEGER, '数量由编辑计划计算。'),
  ],
}

function childRef(kind: EntityType, projectId: string, childId: string, label?: string): ApplicationRef {
  return { kind, id: `${projectId}:${childId}`, ...(label ? { label } : {}) }
}

function splitChild(ref: ApplicationRef): { projectId: string; childId: string } {
  const separator = ref.id.indexOf(':')
  if (separator < 1) throw new Error('NOT_FOUND')
  return { projectId: ref.id.slice(0, separator), childId: ref.id.slice(separator + 1) }
}

async function project(projectId: string): Promise<AudioEditProjectDocument> {
  const value = await getPlatform().audioEdit.getProject(projectId)
  if (!value) throw new Error('NOT_FOUND')
  return value
}

class AudioEditReflectionProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: EntityType) {}

  async listEntities(request: { cursor?: string; limit: number }) {
    const summaries = await getPlatform().audioEdit.listProjects()
    const projects = await Promise.all(summaries.map((summary) => project(summary.id)))
    const refs = projects.flatMap((document) => {
      if (this.entityType === AUDIO_EDIT_ENTITY_TYPES.project) return [{ kind: this.entityType, id: document.id, label: document.name }]
      if (this.entityType === AUDIO_EDIT_ENTITY_TYPES.processorChain || this.entityType === AUDIO_EDIT_ENTITY_TYPES.render) return [{ kind: this.entityType, id: document.id, label: document.name }]
      if (this.entityType === AUDIO_EDIT_ENTITY_TYPES.transcriptBlock) return document.transcript.map((block) => childRef(this.entityType, document.id, block.id, block.text))
      return document.suggestions.map((suggestion) => childRef(this.entityType, document.id, suggestion.id, suggestion.title))
    })
    const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
    const page = refs.slice(offset, offset + request.limit)
    return { refs: page, nextCursor: offset + page.length < refs.length ? String(offset + page.length) : null, revisions: { audio_edit: Math.max(0, ...projects.map((item) => item.revision)) } }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    const { document, values } = await this.readValues(ref)
    const requested = request.propertyIds ? new Set(request.propertyIds) : null
    return {
      ref, entityType: this.entityType, revisions: { audio_edit: document.revision },
      properties: requested ? Object.fromEntries(Object.entries(values).filter(([id]) => requested.has(id))) : values,
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    const { document } = await this.readValues(ref)
    const descriptors = new Map(propertiesByEntity[this.entityType].map((item) => [item.id, item]))
    return propertyIds.map((propertyId) => {
      const descriptor = descriptors.get(propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return { propertyId, readable: true, writable: !descriptor.readOnlyReason, reasons: descriptor.readOnlyReason ? [descriptor.readOnlyReason] : [], requiredPermissions: ['audio_edit:read'], revisions: { audio_edit: document.revision } }
    })
  }

  async getCollectionAvailability(parent: ApplicationRef) {
    const projectId = parent.kind === AUDIO_EDIT_ENTITY_TYPES.project ? parent.id : splitChild(parent).projectId
    const document = await project(projectId)
    return unrestrictedCollectionAvailability(this.entityType, parent, { audio_edit: document.revision }, ['audio_edit:write'])
  }

  private async readValues(ref: ApplicationRef): Promise<{ document: AudioEditProjectDocument; values: Record<string, JsonValue> }> {
    if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    const isProjectScoped = this.entityType === AUDIO_EDIT_ENTITY_TYPES.project || this.entityType === AUDIO_EDIT_ENTITY_TYPES.processorChain || this.entityType === AUDIO_EDIT_ENTITY_TYPES.render
    const ids = isProjectScoped ? { projectId: ref.id, childId: '' } : splitChild(ref)
    const document = await project(ids.projectId)
    if (this.entityType === AUDIO_EDIT_ENTITY_TYPES.project) return { document, values: {
      [`${this.entityType}.name`]: document.name,
      [`${this.entityType}.reference_script`]: document.referenceScript,
      [`${this.entityType}.selected_asr_model_id`]: document.selectedAsrModelId ?? '',
      [`${this.entityType}.duration_frames`]: document.source.durationFrames,
      [`${this.entityType}.sample_rate`]: document.source.sampleRate,
    } }
    if (this.entityType === AUDIO_EDIT_ENTITY_TYPES.transcriptBlock) {
      const block = document.transcript.find((item) => item.id === ids.childId)
      if (!block) throw new Error('NOT_FOUND')
      return { document, values: {
        [`${this.entityType}.text`]: block.text, [`${this.entityType}.start_frame`]: block.startFrame,
        [`${this.entityType}.end_frame`]: block.endFrame, [`${this.entityType}.included`]: block.included,
        [`${this.entityType}.locked`]: block.locked, [`${this.entityType}.granularity`]: block.granularity,
      } }
    }
    if (this.entityType === AUDIO_EDIT_ENTITY_TYPES.suggestion) {
      const suggestion = document.suggestions.find((item) => item.id === ids.childId)
      if (!suggestion) throw new Error('NOT_FOUND')
      return { document, values: { [`${this.entityType}.title`]: suggestion.title, [`${this.entityType}.detail`]: suggestion.detail, [`${this.entityType}.status`]: suggestion.status } }
    }
    if (this.entityType === AUDIO_EDIT_ENTITY_TYPES.processorChain) return { document, values: { [`${this.entityType}.vst_enabled`]: document.vstEnabled } }
    const spans = buildAudioEditTimeline(document.source.durationFrames, document.transcript)
    return { document, values: { [`${this.entityType}.output_duration_frames`]: editedDurationFrames(spans), [`${this.entityType}.removed_block_count`]: document.transcript.filter((block) => !block.included).length } }
  }
}

const entityMeta: Record<EntityType, { title: string; parents: EntityType[] }> = {
  [AUDIO_EDIT_ENTITY_TYPES.project]: { title: '口播剪辑工程', parents: [] },
  [AUDIO_EDIT_ENTITY_TYPES.transcriptBlock]: { title: '转写词块', parents: [AUDIO_EDIT_ENTITY_TYPES.project] },
  [AUDIO_EDIT_ENTITY_TYPES.suggestion]: { title: '剪辑建议', parents: [AUDIO_EDIT_ENTITY_TYPES.project] },
  [AUDIO_EDIT_ENTITY_TYPES.processorChain]: { title: '声音处理链', parents: [AUDIO_EDIT_ENTITY_TYPES.project] },
  [AUDIO_EDIT_ENTITY_TYPES.render]: { title: '成片映射', parents: [AUDIO_EDIT_ENTITY_TYPES.project] },
}

export function createAudioEditReflectionRegistrations(): ApplicationEntityRegistration[] {
  return Object.values(AUDIO_EDIT_ENTITY_TYPES).map((entityType) => ({
    entity: {
      id: entityType, domain: 'audio_edit', version: 1, title: entityMeta[entityType].title,
      description: `${entityMeta[entityType].title}的稳定应用实体。`, refKind: entityType,
      dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: entityMeta[entityType].parents,
      revisionScopes: ['audio_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', entityType),
      ...(entityType === AUDIO_EDIT_ENTITY_TYPES.render ? { writeExclusion: { reason: '成片映射由口播剪辑时间线根据词块保留状态实时计算。' } } : {}),
    },
    properties: propertiesByEntity[entityType],
    provider: new AudioEditReflectionProvider(entityType),
  }))
}
