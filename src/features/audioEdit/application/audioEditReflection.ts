import {
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
  type JsonValue,
  unrestrictedCollectionAvailability,
} from '@/core/application-control'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { audioEditSuggestionState } from '@/core/audioEdit/edits'
import { getPlatform } from '@/platform/runtime'
import { getDocumentOperations } from '@/features/documents/documentOperations'

import { AUDIO_EDIT_ENTITY_TYPES, AUDIO_EDIT_FIELDS, audioEditSchemaDocuments, audioEditSchemaRef as schemaRef, type AudioEditEntityType as EntityType } from './audioEditFields'
import { fieldDescriptors, fieldReadValues } from '@/core/application-control'
import { loadAudioEditProject, getAudioEditProjectInstance, getAudioEditRevision } from './audioEditProjectInstances'
import { loadAudioEditBreaths } from './audioEditBreaths'
import { describeAudioEditBreaths } from '@/core/audioEdit/breaths'
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

/**
 * 口播文档（3.3）：作品索引里已保存、文件还在、已导入素材的口播，加上已打开的草稿。
 * 有素材的草稿也可后台读取；载入会话不打开界面。空文档不列。
 */
async function listAudioEditDocuments(): Promise<Array<{ id: string; name: string }>> {
  const documents = await getDocumentOperations().listDocuments({ kind: 'audio_edit', container: { kind: 'any' }, includeDrafts: true, includeMissing: false })
  return documents
    .filter((document) => document.summary.mediaType !== null)
    .map((document) => ({ id: document.id, name: document.name }))
}

class AudioEditReflectionProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: EntityType) {}

  async listEntities(request: { cursor?: string; limit: number }) {
    const summaries = await listAudioEditDocuments()
    const projectScoped = this.entityType === AUDIO_EDIT_ENTITY_TYPES.project || this.entityType === AUDIO_EDIT_ENTITY_TYPES.processorChain || this.entityType === AUDIO_EDIT_ENTITY_TYPES.render
    // 口播级实体只要名称，不为列出而打开每一份口播；词块与线索才需要读内容
    const loaded: AudioEditProjectDocument[] = []
    if (!projectScoped) for (const summary of summaries) loaded.push(await project(summary.id))
    // 呼吸声在本机检测（按素材内容缓存）；没有转写的口播没有上下文，不列
    const breathViews = this.entityType === AUDIO_EDIT_ENTITY_TYPES.breath
      ? await Promise.all(loaded.map(async (document) => document.transcript.length ? describeAudioEditBreaths(document, await loadAudioEditBreaths(document)) : []))
      : []
    const refs = projectScoped ? summaries.map((summary) => ({ kind: this.entityType, id: summary.id, label: summary.name })) : loaded.flatMap((document, index) => {
      if (this.entityType === AUDIO_EDIT_ENTITY_TYPES.transcriptBlock) return document.transcript.map((block) => childRef(this.entityType, document.id, block.id, block.text))
      if (this.entityType === AUDIO_EDIT_ENTITY_TYPES.breath) return breathViews[index].map((view) => childRef(this.entityType, document.id, view.id, `${view.before}｜${view.after}`))
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
    const clue = this.entityType === AUDIO_EDIT_ENTITY_TYPES.suggestion ? document.suggestions.find((item) => item.id === splitChild(ref).childId) : undefined
    const clueState = clue ? audioEditSuggestionState(document, clue) : undefined
    const descriptors = new Map(propertiesByEntity[this.entityType].map((item) => [item.id, item]))
    return propertyIds.map((propertyId) => {
      const descriptor = descriptors.get(propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      const locked = this.entityType === AUDIO_EDIT_ENTITY_TYPES.transcriptBlock && !propertyId.endsWith('.locked') && document.transcript.find((b) => b.id === splitChild(ref).childId)?.locked
      const reason = descriptor.readOnlyReason || (locked ? '词块已锁定' : getAudioEditProjectInstance(document.id)?.busy ? '口播正在处理' : clueState && clueState !== 'available' ? '这条线索已处理、隐藏、失效或受锁定保护，请以当前口播内容为准。' : '')
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
    const breaths = this.entityType === AUDIO_EDIT_ENTITY_TYPES.breath ? await loadAudioEditBreaths(document) : undefined
    return { document, values: fieldReadValues(AUDIO_EDIT_FIELDS[this.entityType], { document, childId: ids.childId, availableProcessors, ...(breaths ? { breaths: { raw: breaths, views: describeAudioEditBreaths(document, breaths) } } : {}) }) }
  }
}

const entityMeta: Record<EntityType, { title: string; parents: EntityType[] }> = {
  [AUDIO_EDIT_ENTITY_TYPES.project]: { title: '口播（文档内容根，id 即口播文档 ID）', parents: [] },
  [AUDIO_EDIT_ENTITY_TYPES.transcriptBlock]: { title: '转写词块', parents: [AUDIO_EDIT_ENTITY_TYPES.project] },
  [AUDIO_EDIT_ENTITY_TYPES.suggestion]: { title: '剪辑线索（辅助定位，非审批队列）', parents: [AUDIO_EDIT_ENTITY_TYPES.project] },
  [AUDIO_EDIT_ENTITY_TYPES.breath]: { title: '呼吸声（本机模型检测，第一次读取时检测并可能下载约 13 MB 模型；逐处可改处理）', parents: [AUDIO_EDIT_ENTITY_TYPES.project] },
  [AUDIO_EDIT_ENTITY_TYPES.processorChain]: { title: '第三方插件目录', parents: [AUDIO_EDIT_ENTITY_TYPES.project] },
  [AUDIO_EDIT_ENTITY_TYPES.render]: { title: '成片映射', parents: [AUDIO_EDIT_ENTITY_TYPES.project] },
}

export function createAudioEditReflectionRegistrations(): ApplicationEntityRegistration[] {
  return Object.values(AUDIO_EDIT_ENTITY_TYPES).map((entityType) => ({
    entity: {
      id: entityType, domain: 'audio_edit', version: schemaRef('entity', entityType).version, title: entityMeta[entityType].title,
      description: `${entityMeta[entityType].title}的稳定应用实体。`, refKind: entityType,
      dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: entityMeta[entityType].parents,
      revisionScopes: ['audio_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', entityType),
      ...(entityType === AUDIO_EDIT_ENTITY_TYPES.render ? { writeExclusion: { reason: '成片映射由口播剪辑时间线根据词块保留状态实时计算。' } } : {}),
      ...(entityType === AUDIO_EDIT_ENTITY_TYPES.processorChain ? { writeExclusion: { reason: '插件目录由宿主扫描本机插件得到；把插件加进声音处理请写 audio_edit.document.effect_chain（kind=plugin，pluginId 取自这里）。' } } : {}),
    },
    properties: propertiesByEntity[entityType],
    schemaDocuments: audioEditSchemaDocuments(entityType),
    provider: new AudioEditReflectionProvider(entityType),
  }))
}
