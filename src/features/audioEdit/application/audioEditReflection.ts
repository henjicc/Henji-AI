import {
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
  type JsonValue,
  unrestrictedCollectionAvailability,
} from '@/core/application-control'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { getPlatform } from '@/platform/runtime'

import { AUDIO_EDIT_ENTITY_TYPES, AUDIO_EDIT_FIELDS, audioEditSchemaRef as schemaRef, type AudioEditEntityType as EntityType } from './audioEditFields'
import { fieldDescriptors, fieldReadValues } from '@/core/application-control'
import { loadAudioEditProject, getAudioEditProjectInstance, getAudioEditRevision } from './audioEditProjectInstances'
export { AUDIO_EDIT_ENTITY_TYPES } from './audioEditFields'
const propertiesByEntity = Object.fromEntries(Object.entries(AUDIO_EDIT_FIELDS).map(([key, fields]) => [key, fieldDescriptors(fields)])) as Record<EntityType, ApplicationPropertyDescriptor[]>

function childRef(kind: EntityType, projectId: string, childId: string, label?: string): ApplicationRef {
  return { kind, id: `${projectId}:${childId}`, ...(label ? { label } : {}) }
}

function splitChild(ref: ApplicationRef): { projectId: string; childId: string } {
  const separator = ref.id.indexOf(':')
  if (separator < 1) throw new Error('NOT_FOUND')
  return { projectId: ref.id.slice(0, separator), childId: ref.id.slice(separator + 1) }
}

async function project(projectId: string): Promise<AudioEditProjectDocument> {
  return (await loadAudioEditProject(projectId)).document
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
    return { refs: page, nextCursor: offset + page.length < refs.length ? String(offset + page.length) : null, revisions: { audio_edit: getAudioEditRevision() } }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    const { values } = await this.readValues(ref)
    const requested = request.propertyIds ? new Set(request.propertyIds) : null
    return {
      ref, entityType: this.entityType, revisions: { audio_edit: getAudioEditRevision() },
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
      const locked = this.entityType === AUDIO_EDIT_ENTITY_TYPES.transcriptBlock && !propertyId.endsWith('.locked') && document.transcript.find((b) => b.id === splitChild(ref).childId)?.locked
      const reason = descriptor.readOnlyReason || (locked ? '词块已锁定' : getAudioEditProjectInstance(document.id)?.busy ? '工程正在处理' : '')
      return { propertyId, readable: true, writable: !reason, reasons: reason ? [reason] : [], requiredPermissions: ['audio_edit:read'], revisions: { audio_edit: getAudioEditRevision() } }
    })
  }

  async getCollectionAvailability(parent: ApplicationRef) {
    const projectId = parent.kind === AUDIO_EDIT_ENTITY_TYPES.project ? parent.id : splitChild(parent).projectId
    await project(projectId)
    return unrestrictedCollectionAvailability(this.entityType, parent, { audio_edit: getAudioEditRevision() }, ['audio_edit:write'])
  }

  private async readValues(ref: ApplicationRef): Promise<{ document: AudioEditProjectDocument; values: Record<string, JsonValue> }> {
    if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    const isProjectScoped = this.entityType === AUDIO_EDIT_ENTITY_TYPES.project || this.entityType === AUDIO_EDIT_ENTITY_TYPES.processorChain || this.entityType === AUDIO_EDIT_ENTITY_TYPES.render
    const ids = isProjectScoped ? { projectId: ref.id, childId: '' } : splitChild(ref)
    const document = await project(ids.projectId)
    const availableProcessors = this.entityType === AUDIO_EDIT_ENTITY_TYPES.processorChain ? await getPlatform().audioEdit.listProcessors() : undefined
    return { document, values: fieldReadValues(AUDIO_EDIT_FIELDS[this.entityType], { document, childId: ids.childId, availableProcessors }) }
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
