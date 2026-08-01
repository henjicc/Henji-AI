import { z } from 'zod'

import {
  APPLICATION_CAPABILITY_CATALOG_VERSION,
} from '@/core/assistant/applicationCapabilities'
import {
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationPropertyDescriptor,
  type ApplicationPropertyValue,
  type ApplicationRef,
} from '@/core/application-control'

import {
  getSettingsRegistryRevision,
  listApplicationSettingDefinitions,
  type ApplicationSettingDefinition,
} from './settingsRegistry'

const SETTINGS_ENTITY_TYPE = 'settings.registry'
const SETTINGS_REF = { kind: SETTINGS_ENTITY_TYPE, id: 'singleton', label: '应用设置' } as const
const ENTITY_SCHEMA_DIGEST = 'sha256:c2e0e7dde1d76e45dc9b677a28bfbe26d6dede8cda21f3331d56f685bfb82118'
const PROPERTY_SCHEMA_DIGEST = 'sha256:d485e2d1d841de1f3d0cfaa52b66119fb6dd9c936fb648335b95ef1c4f73e0c1'

function settingValueDescriptor(definition: ApplicationSettingDefinition): ApplicationPropertyValue {
  if (definition.schema instanceof z.ZodBoolean) return { kind: 'boolean' }
  if (definition.schema instanceof z.ZodNumber) {
    return definition.schema.isInt ? { kind: 'integer' } : { kind: 'number' }
  }
  if (definition.schema instanceof z.ZodEnum) {
    return {
      kind: 'enum',
      values: definition.schema.options
        .filter((value): value is string => typeof value === 'string')
        .map((value) => ({ value, label: value })),
    }
  }
  return { kind: 'string' }
}

function propertySchemaRef(id: string): ApplicationPropertyDescriptor['schemaRef'] {
  return {
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    kind: 'property',
    id,
    version: 1,
    digest: PROPERTY_SCHEMA_DIGEST,
  }
}

function settingProperty(definition: ApplicationSettingDefinition): ApplicationPropertyDescriptor {
  return {
    id: definition.id,
    entityType: SETTINGS_ENTITY_TYPE,
    version: 1,
    title: definition.title,
    description: definition.description,
    value: settingValueDescriptor(definition),
    nullable: false,
    defaultValue: definition.defaultValue,
    dataClass: definition.sensitive ? 'C2' : 'C1',
    exposures: definition.sensitive ? ['ui'] : ['ui', 'assistant'],
    requiredPermissions: {
      read: ['settings:read'],
      write: ['settings:write'],
    },
    revisionScopes: ['settings'],
    schemaRef: propertySchemaRef(definition.id),
  }
}

class SettingsReflectionProvider implements ApplicationEntityProvider {
  readonly entityType = SETTINGS_ENTITY_TYPE

  async listEntities(): Promise<{
    refs: Array<typeof SETTINGS_REF>
    nextCursor: null
    revisions: Record<string, number>
  }> {
    return {
      refs: [SETTINGS_REF],
      nextCursor: null,
      revisions: { settings: getSettingsRegistryRevision() },
    }
  }

  async readEntity(
    ref: ApplicationRef,
    request: { propertyIds?: string[] }
  ): Promise<{
    ref: typeof SETTINGS_REF
    entityType: string
    revisions: Record<string, number>
    properties: Record<string, string | number | boolean>
    capturedAt: string
  }> {
    if (ref.kind !== SETTINGS_ENTITY_TYPE || ref.id !== SETTINGS_REF.id) throw new Error('NOT_FOUND')
    const requested = request.propertyIds ? new Set(request.propertyIds) : undefined
    const definitions = listApplicationSettingDefinitions()
      .filter((definition) => !definition.sensitive)
      .filter((definition) => !requested || requested.has(definition.id))
    return {
      ref: SETTINGS_REF,
      entityType: SETTINGS_ENTITY_TYPE,
      revisions: { settings: getSettingsRegistryRevision() },
      properties: Object.fromEntries(definitions.map((definition) => [definition.id, definition.read()])),
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(
    ref: ApplicationRef,
    propertyIds: string[]
  ): Promise<Array<{
    propertyId: string
    readable: boolean
    writable: boolean
    reasons: string[]
    requiredPermissions: string[]
    revisions: Record<string, number>
  }>> {
    if (ref.kind !== SETTINGS_ENTITY_TYPE || ref.id !== SETTINGS_REF.id) throw new Error('NOT_FOUND')
    const definitions = new Map(listApplicationSettingDefinitions().map((definition) => [definition.id, definition]))
    return propertyIds.map((propertyId) => {
      const definition = definitions.get(propertyId)
      if (!definition) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return {
        propertyId,
        readable: !definition.sensitive,
        writable: !definition.sensitive,
        reasons: definition.sensitive ? ['敏感设置值不进入内部观察结果'] : [],
        requiredPermissions: ['settings:read'],
        revisions: { settings: getSettingsRegistryRevision() },
      }
    })
  }
}

export function createSettingsReflectionRegistration(): ApplicationEntityRegistration {
  return {
    entity: {
      id: SETTINGS_ENTITY_TYPE,
      domain: 'settings',
      version: 1,
      title: '应用设置',
      description: 'Henji-AI 的可查询、可计划修改设置集合。',
      refKind: SETTINGS_ENTITY_TYPE,
      dataClass: 'C1',
      exposures: ['ui', 'assistant'],
      parentTypes: [],
      revisionScopes: ['settings'],
      queryCapabilityIds: ['get_application_settings'],
      schemaRef: {
        catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
        kind: 'entity',
        id: SETTINGS_ENTITY_TYPE,
        version: 1,
        digest: ENTITY_SCHEMA_DIGEST,
      },
    },
    properties: listApplicationSettingDefinitions().map(settingProperty),
    provider: new SettingsReflectionProvider(),
  }
}
