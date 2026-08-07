import {
  fieldDescriptors,
  fieldReadValues,
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationPropertyDescriptor,
  type ApplicationPropertyValue,
  type ApplicationRef,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes'
import { NODE_FIELDS, PROJECT_FIELDS } from './canvasFields'
import { listCanvasProjects } from './canvasProjectService'
import { readCanvasProjectSnapshot } from './canvasQueryService'

const DOMAIN = 'canvas'
const REVISION_SCOPE = 'canvas'
export const CANVAS_ENTITY_TYPES = {
  project: 'canvas.project',
  node: 'canvas.node',
  edge: 'canvas.edge',
} as const
type CanvasEntityType = typeof CANVAS_ENTITY_TYPES[keyof typeof CANVAS_ENTITY_TYPES]

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381)
    .toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function schemaRef(kind: 'entity' | 'property', id: string) {
  return {
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    kind,
    id,
    version: 1,
    digest: digest(`${kind}:${id}`),
  } as const
}

function property(
  entityType: CanvasEntityType,
  suffix: string,
  title: string,
  value: ApplicationPropertyValue,
  options: { readOnly?: string; relation?: ApplicationPropertyDescriptor['relation'] } = {}
): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: `画布${title}的稳定控制属性。`,
    value,
    nullable: false,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: {
      read: ['canvas:read'],
      write: options.readOnly ? [] : ['canvas:write'],
    },
    revisionScopes: [REVISION_SCOPE],
    schemaRef: schemaRef('property', id),
    ...(options.readOnly ? { readOnlyReason: options.readOnly } : {}),
    ...(options.relation ? { relation: options.relation } : {}),
  }
}

const propertiesByEntity: Record<CanvasEntityType, ApplicationPropertyDescriptor[]> = {
  [CANVAS_ENTITY_TYPES.project]: [
    ...fieldDescriptors(PROJECT_FIELDS),
    property(CANVAS_ENTITY_TYPES.project, 'node_count', '节点数量', { kind: 'integer', hardRange: { min: 0 } }, {
      readOnly: '节点数量由项目内容计算。',
    }),
    property(CANVAS_ENTITY_TYPES.project, 'edge_count', '连线数量', { kind: 'integer', hardRange: { min: 0 } }, {
      readOnly: '连线数量由项目内容计算。',
    }),
  ],
  [CANVAS_ENTITY_TYPES.node]: [
    property(CANVAS_ENTITY_TYPES.node, 'project_ref', '所属项目', { kind: 'ref', refKinds: [CANVAS_ENTITY_TYPES.project] }, {
      readOnly: '节点所属项目不可变更。',
      relation: { targetEntityTypes: [CANVAS_ENTITY_TYPES.project], cardinality: 'one' },
    }),
    property(CANVAS_ENTITY_TYPES.node, 'node_type', '节点类型', { kind: 'string', maxLength: 120 }, {
      readOnly: '节点类型创建后不可变更。',
    }),
    ...fieldDescriptors(NODE_FIELDS),
  ],
  [CANVAS_ENTITY_TYPES.edge]: [
    property(CANVAS_ENTITY_TYPES.edge, 'project_ref', '所属项目', { kind: 'ref', refKinds: [CANVAS_ENTITY_TYPES.project] }, {
      readOnly: '连线所属项目不可变更。',
      relation: { targetEntityTypes: [CANVAS_ENTITY_TYPES.project], cardinality: 'one' },
    }),
    property(CANVAS_ENTITY_TYPES.edge, 'source_ref', '来源节点', { kind: 'ref', refKinds: [CANVAS_ENTITY_TYPES.node] }, {
      readOnly: '端点通过正式连接操作维护。',
      relation: { targetEntityTypes: [CANVAS_ENTITY_TYPES.node], cardinality: 'one' },
    }),
    property(CANVAS_ENTITY_TYPES.edge, 'target_ref', '目标节点', { kind: 'ref', refKinds: [CANVAS_ENTITY_TYPES.node] }, {
      readOnly: '端点通过正式连接操作维护。',
      relation: { targetEntityTypes: [CANVAS_ENTITY_TYPES.node], cardinality: 'one' },
    }),
    property(CANVAS_ENTITY_TYPES.edge, 'source_handle', '来源端口', { kind: 'string', maxLength: 120 }, {
      readOnly: '端口来自节点目录与连接校验。',
    }),
    property(CANVAS_ENTITY_TYPES.edge, 'target_handle', '目标端口', { kind: 'string', maxLength: 120 }, {
      readOnly: '端口来自节点目录与连接校验。',
    }),
  ],
}

function childRef(kind: typeof CANVAS_ENTITY_TYPES.node | typeof CANVAS_ENTITY_TYPES.edge, projectId: string, id: string): ApplicationRef {
  return { kind, id: `${projectId}:${id}` }
}

function splitChildRef(ref: ApplicationRef, expected: CanvasEntityType): { projectId: string; childId: string } {
  if (ref.kind !== expected) throw new Error('NOT_FOUND')
  const separator = ref.id.indexOf(':')
  if (separator < 1) throw new Error('NOT_FOUND')
  return { projectId: ref.id.slice(0, separator), childId: ref.id.slice(separator + 1) }
}

function revisionOf(updatedAt: number): number {
  return Math.max(0, Math.trunc(updatedAt))
}

function filterProperties(properties: Record<string, JsonValue>, requested?: string[]): Record<string, JsonValue> {
  if (!requested) return properties
  const allowed = new Set(requested)
  return Object.fromEntries(Object.entries(properties).filter(([id]) => allowed.has(id)))
}

class CanvasReflectionProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: CanvasEntityType) {}

  async listEntities(request: { cursor?: string; limit: number }) {
    const projects = await listCanvasProjects()
    const refs: ApplicationRef[] = []
    for (const project of projects) {
      if (this.entityType === CANVAS_ENTITY_TYPES.project) {
        refs.push({ kind: this.entityType, id: project.id, label: project.name, revision: revisionOf(project.updatedAt) })
        continue
      }
      const snapshot = await readCanvasProjectSnapshot(project.id)
      const records = this.entityType === CANVAS_ENTITY_TYPES.node ? snapshot.nodes : snapshot.edges
      for (const record of records) refs.push(childRef(this.entityType, project.id, record.id))
    }
    const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
    const page = refs.slice(offset, offset + request.limit)
    return {
      refs: page,
      nextCursor: offset + page.length < refs.length ? String(offset + page.length) : null,
      revisions: { [REVISION_SCOPE]: Math.max(0, ...projects.map((project) => revisionOf(project.updatedAt))) },
    }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    const properties = await this.readProperties(ref)
    const projectId = this.entityType === CANVAS_ENTITY_TYPES.project ? ref.id : splitChildRef(ref, this.entityType).projectId
    const snapshot = await readCanvasProjectSnapshot(projectId)
    return {
      ref,
      entityType: this.entityType,
      revisions: { [REVISION_SCOPE]: revisionOf(snapshot.updatedAt) },
      properties: filterProperties(properties, request.propertyIds),
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    await this.readProperties(ref)
    const descriptors = new Map(propertiesByEntity[this.entityType].map((item) => [item.id, item]))
    return propertyIds.map((propertyId) => {
      const descriptor = descriptors.get(propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return {
        propertyId,
        readable: true,
        writable: !descriptor.readOnlyReason,
        reasons: descriptor.readOnlyReason ? [descriptor.readOnlyReason] : [],
        requiredPermissions: ['canvas:read'],
        revisions: { [REVISION_SCOPE]: 0 },
      }
    })
  }

  private async readProperties(ref: ApplicationRef): Promise<Record<string, JsonValue>> {
    if (this.entityType === CANVAS_ENTITY_TYPES.project) {
      if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
      const project = await readCanvasProjectSnapshot(ref.id)
      return {
        ...fieldReadValues(PROJECT_FIELDS, project),
        [`${this.entityType}.node_count`]: project.nodes.length,
        [`${this.entityType}.edge_count`]: project.edges.length,
      }
    }
    const { projectId, childId } = splitChildRef(ref, this.entityType)
    const project = await readCanvasProjectSnapshot(projectId)
    if (this.entityType === CANVAS_ENTITY_TYPES.node) {
      const node = project.nodes.find((item) => item.id === childId)
      if (!node) throw new Error('NOT_FOUND')
      return this.nodeProperties(projectId, node)
    }
    const edge = project.edges.find((item) => item.id === childId)
    if (!edge) throw new Error('NOT_FOUND')
    return this.edgeProperties(projectId, edge)
  }

  private nodeProperties(projectId: string, node: CanvasNode): Record<string, JsonValue> {
    return {
      [`${CANVAS_ENTITY_TYPES.node}.project_ref`]: { kind: CANVAS_ENTITY_TYPES.project, id: projectId },
      [`${CANVAS_ENTITY_TYPES.node}.node_type`]: node.type,
      ...fieldReadValues(NODE_FIELDS, node),
    }
  }

  private edgeProperties(projectId: string, edge: CanvasEdge): Record<string, JsonValue> {
    return {
      [`${CANVAS_ENTITY_TYPES.edge}.project_ref`]: { kind: CANVAS_ENTITY_TYPES.project, id: projectId },
      [`${CANVAS_ENTITY_TYPES.edge}.source_ref`]: childRef(CANVAS_ENTITY_TYPES.node, projectId, edge.source),
      [`${CANVAS_ENTITY_TYPES.edge}.target_ref`]: childRef(CANVAS_ENTITY_TYPES.node, projectId, edge.target),
      [`${CANVAS_ENTITY_TYPES.edge}.source_handle`]: edge.sourceHandle ?? 'source',
      [`${CANVAS_ENTITY_TYPES.edge}.target_handle`]: edge.targetHandle ?? 'target',
    }
  }
}

const META: Record<CanvasEntityType, { title: string; description: string; parents: CanvasEntityType[]; queryIds: string[] }> = {
  [CANVAS_ENTITY_TYPES.project]: { title: '画布项目', description: '持久化的节点画布项目。', parents: [], queryIds: ['get_canvas_project'] },
  [CANVAS_ENTITY_TYPES.node]: { title: '画布节点', description: '由节点目录约束的数据与位置实体。', parents: [CANVAS_ENTITY_TYPES.project], queryIds: ['get_canvas_node'] },
  [CANVAS_ENTITY_TYPES.edge]: { title: '画布连线', description: '通过节点端口校验建立的有向连接。', parents: [CANVAS_ENTITY_TYPES.project], queryIds: ['get_canvas_project'] },
}

export function createCanvasReflectionRegistrations(): ApplicationEntityRegistration[] {
  return Object.values(CANVAS_ENTITY_TYPES).map((entityType) => ({
    entity: {
      id: entityType,
      domain: DOMAIN,
      version: 1,
      title: META[entityType].title,
      description: META[entityType].description,
      refKind: entityType,
      dataClass: 'C1',
      exposures: ['ui', 'assistant', 'local_adapter'],
      parentTypes: META[entityType].parents,
      revisionScopes: [REVISION_SCOPE],
      queryCapabilityIds: META[entityType].queryIds,
      schemaRef: schemaRef('entity', entityType),
      /**
       * 节点与连线可增删。声明之后助手用通用动词就能建画布，不必为每种「加一个 X」写专用能力。
       *
       * `node_type` 与 `source_ref` / `target_ref` 都是只读属性——「只读」指创建后不可修改，
       * 不妨碍它们作为创建时的必填项。属性可写性与创建必填项在契约上是两件事，引擎分别判定。
       */
      ...(entityType === CANVAS_ENTITY_TYPES.node ? {
        collectionWrite: {
          creatable: true,
          removable: true,
          requiredPropertyIds: [`${CANVAS_ENTITY_TYPES.node}.node_type`],
          maxItemsPerChange: 50,
        },
      } : {}),
      ...(entityType === CANVAS_ENTITY_TYPES.edge ? {
        collectionWrite: {
          creatable: true,
          removable: true,
          requiredPropertyIds: [
            `${CANVAS_ENTITY_TYPES.edge}.source_ref`,
            `${CANVAS_ENTITY_TYPES.edge}.target_ref`,
          ],
          maxItemsPerChange: 50,
        },
      } : {}),
    },
    properties: propertiesByEntity[entityType],
    provider: new CanvasReflectionProvider(entityType),
  }))
}
