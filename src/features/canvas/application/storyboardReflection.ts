import {
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import { getStoryboardProject, listStoryboardProjects } from './storyboardProjectService'

export const STORYBOARD_ENTITY_TYPES = {
  project: 'storyboard.project',
  card: 'storyboard.card',
} as const

type StoryboardEntityType = typeof STORYBOARD_ENTITY_TYPES[keyof typeof STORYBOARD_ENTITY_TYPES]

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function schemaRef(kind: 'entity' | 'property', id: string) {
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: digest(`${kind}:${id}`) } as const
}

function property(entityType: StoryboardEntityType, suffix: string, title: string, value: ApplicationPropertyDescriptor['value']): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: `分镜${title}。`,
    value,
    nullable: false,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['storyboard:read'], write: [] },
    revisionScopes: ['storyboard'],
    schemaRef: schemaRef('property', id),
    readOnlyReason: '当前分镜对象通过画布分镜编辑器与正式画布事务维护。',
  }
}

const properties: Record<StoryboardEntityType, ApplicationPropertyDescriptor[]> = {
  [STORYBOARD_ENTITY_TYPES.project]: [
    property(STORYBOARD_ENTITY_TYPES.project, 'name', '项目名称', { kind: 'string', maxLength: 200 }),
    property(STORYBOARD_ENTITY_TYPES.project, 'card_refs', '分镜卡引用', { kind: 'ref_list', refKinds: [STORYBOARD_ENTITY_TYPES.card], maxItems: 1000 }),
    property(STORYBOARD_ENTITY_TYPES.project, 'edge_count', '关系数量', { kind: 'integer', hardRange: { min: 0 } }),
  ],
  [STORYBOARD_ENTITY_TYPES.card]: [
    property(STORYBOARD_ENTITY_TYPES.card, 'project_ref', '所属项目', { kind: 'ref', refKinds: [STORYBOARD_ENTITY_TYPES.project] }),
    property(STORYBOARD_ENTITY_TYPES.card, 'node_type', '节点类型', { kind: 'string', maxLength: 120 }),
  ],
}

function cardRef(projectId: string, nodeId: string): ApplicationRef {
  return { kind: STORYBOARD_ENTITY_TYPES.card, id: `${projectId}:${nodeId}` }
}

function splitCardRef(ref: ApplicationRef): { projectId: string; nodeId: string } {
  if (ref.kind !== STORYBOARD_ENTITY_TYPES.card) throw new Error('NOT_FOUND')
  const separator = ref.id.indexOf(':')
  if (separator < 1) throw new Error('NOT_FOUND')
  return { projectId: ref.id.slice(0, separator), nodeId: ref.id.slice(separator + 1) }
}

function itemsOf(project: Record<string, unknown>, key: 'nodeSummary' | 'edgeSummary'): Record<string, unknown>[] {
  const summary = project[key]
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return []
  const items = (summary as Record<string, unknown>).items
  return Array.isArray(items) ? items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []
}

class StoryboardReflectionProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: StoryboardEntityType) {}

  async listEntities(request: { cursor?: string; limit: number }) {
    const projects = await listStoryboardProjects()
    const refs = this.entityType === STORYBOARD_ENTITY_TYPES.project
      ? projects.map((project) => ({ kind: this.entityType, id: String(project.id), label: String(project.name) }))
      : (await Promise.all(projects.map(async (project) => {
        const snapshot = await getStoryboardProject(String(project.id))
        return itemsOf(snapshot, 'nodeSummary').map((node) => cardRef(String(project.id), String(node.id)))
      }))).flat()
    const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
    const page = refs.slice(offset, offset + request.limit)
    return {
      refs: page,
      nextCursor: offset + page.length < refs.length ? String(offset + page.length) : null,
      revisions: { storyboard: Math.max(0, ...projects.map((project) => Number(project.updatedAt) || 0)) },
    }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    const projectId = this.entityType === STORYBOARD_ENTITY_TYPES.project ? ref.id : splitCardRef(ref).projectId
    const project = await getStoryboardProject(projectId)
    let values: Record<string, JsonValue>
    if (this.entityType === STORYBOARD_ENTITY_TYPES.project) {
      if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
      const cards = itemsOf(project, 'nodeSummary')
      values = {
        'storyboard.project.name': String(project.name),
        'storyboard.project.card_refs': cards.map((node) => cardRef(projectId, String(node.id))),
        'storyboard.project.edge_count': Number((project.edgeSummary as Record<string, unknown>)?.count) || 0,
      }
    } else {
      const { nodeId } = splitCardRef(ref)
      const node = itemsOf(project, 'nodeSummary').find((item) => item.id === nodeId)
      if (!node) throw new Error('NOT_FOUND')
      values = {
        'storyboard.card.project_ref': { kind: STORYBOARD_ENTITY_TYPES.project, id: projectId },
        'storyboard.card.node_type': String(node.type),
      }
    }
    const selected = request.propertyIds
      ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds?.includes(id)))
      : values
    return {
      ref,
      entityType: this.entityType,
      revisions: { storyboard: Number(project.updatedAt) || 0 },
      properties: selected,
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    const snapshot = await this.readEntity(ref, {})
    const known = new Set(properties[this.entityType].map((item) => item.id))
    return propertyIds.map((propertyId) => {
      if (!known.has(propertyId)) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return {
        propertyId,
        readable: true,
        writable: false,
        reasons: ['当前分镜对象通过画布分镜编辑器与正式画布事务维护。'],
        requiredPermissions: ['storyboard:read'],
        revisions: snapshot.revisions,
      }
    })
  }
}

export function createStoryboardReflectionRegistrations(): ApplicationEntityRegistration[] {
  return (Object.values(STORYBOARD_ENTITY_TYPES) as StoryboardEntityType[]).map((entityType) => ({
    entity: {
      id: entityType,
      domain: 'storyboard',
      version: 1,
      title: entityType === STORYBOARD_ENTITY_TYPES.project ? '分镜项目' : '分镜卡',
      description: '分镜项目及其卡片的稳定只读关系。',
      refKind: entityType,
      dataClass: 'C1',
      exposures: ['ui', 'assistant', 'local_adapter'],
      parentTypes: entityType === STORYBOARD_ENTITY_TYPES.card ? [STORYBOARD_ENTITY_TYPES.project] : [],
      revisionScopes: ['storyboard'],
      queryCapabilityIds: [entityType === STORYBOARD_ENTITY_TYPES.project ? 'get_storyboard_project' : 'get_storyboard_project'],
      schemaRef: schemaRef('entity', entityType),
    },
    properties: properties[entityType],
    provider: new StoryboardReflectionProvider(entityType),
  }))
}
