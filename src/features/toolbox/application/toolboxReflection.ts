import {
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
  type JsonValue,
  unrestrictedCollectionAvailability,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import { listToolboxTools } from './toolboxApplicationService'

export const TOOLBOX_TOOL_ENTITY_TYPE = 'toolbox.tool' as const

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function schemaRef(kind: 'entity' | 'property', id: string) {
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: digest(`${kind}:${id}`) } as const
}

function property(suffix: string, title: string, value: ApplicationPropertyDescriptor['value']): ApplicationPropertyDescriptor {
  const id = `${TOOLBOX_TOOL_ENTITY_TYPE}.${suffix}`
  return {
    id,
    entityType: TOOLBOX_TOOL_ENTITY_TYPE,
    version: 1,
    title,
    description: `工具箱${title}。`,
    value,
    nullable: false,
    dataClass: 'C0',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['toolbox:read'], write: [] },
    revisionScopes: ['toolbox'],
    schemaRef: schemaRef('property', id),
    readOnlyReason: '工具目录由正式工具注册表维护。',
  }
}

const CONTROL_KINDS_SCHEMA_REF = schemaRef('property', 'toolbox.tool.control_kinds.value')
const properties = [
  property('name', '工具名称', { kind: 'string', maxLength: 120 }),
  property('operation_id', '操作标识', { kind: 'string', maxLength: 120 }),
  property('control_kinds', '控制动作', { kind: 'json', schemaRef: CONTROL_KINDS_SCHEMA_REF }),
]

class ToolboxReflectionProvider implements ApplicationEntityProvider {
  readonly entityType = TOOLBOX_TOOL_ENTITY_TYPE

  async listEntities(request: { cursor?: string; limit: number }) {
    const tools = listToolboxTools()
    const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
    const page = tools.slice(offset, offset + request.limit)
    return {
      refs: page.map((tool) => ({ kind: this.entityType, id: String(tool.id), label: String(tool.name) })),
      nextCursor: offset + page.length < tools.length ? String(offset + page.length) : null,
      revisions: { toolbox: 1 },
    }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    const tool = listToolboxTools().find((item) => item.id === ref.id)
    if (!tool) throw new Error('NOT_FOUND')
    const values: Record<string, JsonValue> = {
      'toolbox.tool.name': String(tool.name),
      'toolbox.tool.operation_id': String(tool.operationId ?? tool.id),
      'toolbox.tool.control_kinds': JSON.parse(JSON.stringify(tool.controlKinds ?? [])) as JsonValue,
    }
    return {
      ref,
      entityType: this.entityType,
      revisions: { toolbox: 1 },
      properties: request.propertyIds
        ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds?.includes(id)))
        : values,
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    await this.readEntity(ref, {})
    const known = new Set(properties.map((item) => item.id))
    return propertyIds.map((propertyId) => {
      if (!known.has(propertyId)) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return {
        propertyId,
        readable: true,
        writable: false,
        reasons: ['工具目录由正式工具注册表维护。'],
        requiredPermissions: ['toolbox:read'],
        revisions: { toolbox: 1 },
      }
    })
  }

  async getCollectionAvailability(parent: ApplicationRef) {
    return unrestrictedCollectionAvailability(this.entityType, parent, { toolbox: 1 }, ['toolbox:write'])
  }

}

export function createToolboxReflectionRegistration(): ApplicationEntityRegistration {
  return {
    entity: {
      id: TOOLBOX_TOOL_ENTITY_TYPE,
      domain: 'toolbox',
      version: 1,
      title: '工具箱工具',
      description: '从正式工具注册表发现的工具及其控制动作。',
      refKind: TOOLBOX_TOOL_ENTITY_TYPE,
      dataClass: 'C0',
      exposures: ['ui', 'assistant', 'local_adapter'],
      parentTypes: [],
      revisionScopes: ['toolbox'],
      queryCapabilityIds: ['list_toolbox_tools'],
      schemaRef: schemaRef('entity', TOOLBOX_TOOL_ENTITY_TYPE),
      writeExclusion: { reason: '工具由工具箱注册表定义，属于应用结构而非用户数据。' },
    },
    properties,
    provider: new ToolboxReflectionProvider(),
    schemaDocuments: [{
      ref: CONTROL_KINDS_SCHEMA_REF,
      value: { type: 'array', items: { type: 'string' } },
    }],
  }
}
