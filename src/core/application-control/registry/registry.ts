import {
  applicationSchemaRefSchema,
  jsonValueSchema,
  type ApplicationRef,
  type ApplicationSchemaRef,
  type JsonValue,
} from '../identifiers'
import {
  applicationEntitySnapshotSchema,
  applicationEntityTypeDescriptorSchema,
  applicationPropertyAvailabilitySchema,
  applicationPropertyDescriptorSchema,
  type ApplicationEntitySnapshot,
  type ApplicationEntityTypeDescriptor,
  type ApplicationPropertyAvailability,
  type ApplicationPropertyDescriptor,
} from '../reflection'

import type {
  ApplicationControlAccessContext,
  ApplicationEntityListRequest,
  ApplicationEntityListResult,
  ApplicationEntityProvider,
  ApplicationEntityRegistration,
  ApplicationRegistryDescription,
  ApplicationRegistryQuery,
  ApplicationSchemaDocument,
} from './types'
import { normalizeApplicationPropertyValue } from './valueValidation'

const DATA_CLASS_RANK = { C0: 0, C1: 1, C2: 2, C3: 3 } as const

function schemaKey(ref: ApplicationSchemaRef): string {
  return `${ref.catalogVersion}:${ref.kind}:${ref.id}@${ref.version}`
}

function canAccessDataClass(
  dataClass: ApplicationPropertyDescriptor['dataClass'],
  context: ApplicationControlAccessContext
): boolean {
  if (!context.acceptedDataClasses.has(dataClass)) return false
  return context.exposure !== 'assistant' || DATA_CLASS_RANK[dataClass] < DATA_CLASS_RANK.C3
}

function hasAllPermissions(required: string[], context: ApplicationControlAccessContext): boolean {
  return required.every((permission) => context.permissions.has(permission))
}

export class ApplicationReflectionRegistry {
  private readonly entities = new Map<string, ApplicationEntityTypeDescriptor>()
  private readonly properties = new Map<string, ApplicationPropertyDescriptor>()
  private readonly propertiesByEntity = new Map<string, Map<string, ApplicationPropertyDescriptor>>()
  private readonly providers = new Map<string, ApplicationEntityProvider>()
  private readonly schemaDocuments = new Map<string, ApplicationSchemaDocument>()

  constructor(readonly catalogVersion: string) {
    if (!/^application-capabilities\/v[1-9][0-9]*$/.test(catalogVersion)) {
      throw new Error(`应用控制目录版本无效：${catalogVersion}`)
    }
  }

  register(registration: ApplicationEntityRegistration): void {
    const entity = applicationEntityTypeDescriptorSchema.parse(registration.entity)
    if (entity.schemaRef.catalogVersion !== this.catalogVersion) {
      throw new Error(`实体 schemaRef 目录版本不一致：${entity.id}`)
    }
    const current = this.entities.get(entity.id)
    if (current) {
      const reason = current.version === entity.version ? '重复 ID' : '版本冲突'
      throw new Error(`应用实体${reason}：${entity.id}@${current.version}/${entity.version}`)
    }
    if (registration.provider && registration.provider.entityType !== entity.id) {
      throw new Error(`领域提供者实体类型不一致：${registration.provider.entityType}/${entity.id}`)
    }

    const parsedProperties = registration.properties.map((input) => {
      const property = applicationPropertyDescriptorSchema.parse(input)
      if (property.entityType !== entity.id) {
        throw new Error(`属性实体类型不一致：${property.id}/${property.entityType}`)
      }
      if (property.schemaRef.catalogVersion !== this.catalogVersion) {
        throw new Error(`属性 schemaRef 目录版本不一致：${property.id}`)
      }
      const existing = this.properties.get(property.id)
      if (existing) {
        const reason = existing.version === property.version ? '重复 ID' : '版本冲突'
        throw new Error(`应用属性${reason}：${property.id}@${existing.version}/${property.version}`)
      }
      return property
    })
    const localIds = new Set<string>()
    for (const property of parsedProperties) {
      if (localIds.has(property.id)) throw new Error(`应用属性重复 ID：${property.id}`)
      localIds.add(property.id)
    }

    const documents: ApplicationSchemaDocument[] = [
      { ref: entity.schemaRef, value: entity as unknown as JsonValue },
      ...parsedProperties.map((property) => ({
        ref: property.schemaRef,
        value: property as unknown as JsonValue,
      })),
      ...(registration.schemaDocuments ?? []),
    ]
    const documentKeys = new Set<string>()
    for (const document of documents) {
      this.assertSchemaDocumentAvailable(document)
      const key = schemaKey(document.ref)
      if (documentKeys.has(key)) throw new Error(`SCHEMA_REF_DUPLICATE:${document.ref.id}`)
      documentKeys.add(key)
    }

    this.entities.set(entity.id, entity)
    const entityProperties = new Map<string, ApplicationPropertyDescriptor>()
    for (const property of parsedProperties) {
      this.properties.set(property.id, property)
      entityProperties.set(property.id, property)
    }
    this.propertiesByEntity.set(entity.id, entityProperties)
    if (registration.provider) this.providers.set(entity.id, registration.provider)
    for (const document of documents) {
      this.schemaDocuments.set(schemaKey(document.ref), {
        ref: applicationSchemaRefSchema.parse(document.ref),
        value: jsonValueSchema.parse(document.value),
      })
    }
  }

  describe(
    query: ApplicationRegistryQuery,
    context: ApplicationControlAccessContext
  ): ApplicationRegistryDescription {
    const domains = new Set(query.domains ?? [])
    const entityTypes = new Set(query.entityTypes ?? [])
    const propertyIds = new Set(query.propertyIds ?? [])
    const entities = [...this.entities.values()].filter((entity) => (
      (domains.size === 0 || domains.has(entity.domain))
      && (entityTypes.size === 0 || entityTypes.has(entity.id))
      && entity.exposures.includes(context.exposure)
      && context.acceptedDataClasses.has(entity.dataClass)
      && (context.exposure !== 'assistant' || entity.dataClass !== 'C3')
    ))
    const visibleEntityTypes = new Set(entities.map((entity) => entity.id))
    const properties = [...this.properties.values()].filter((property) => (
      visibleEntityTypes.has(property.entityType)
      && (propertyIds.size === 0 || propertyIds.has(property.id))
      && this.canReadProperty(property, context)
    ))
    return { catalogVersion: this.catalogVersion, entities, properties }
  }

  getEntity(entityType: string): ApplicationEntityTypeDescriptor | undefined {
    return this.entities.get(entityType)
  }

  getProperty(propertyId: string): ApplicationPropertyDescriptor | undefined {
    return this.properties.get(propertyId)
  }

  listProperties(entityType: string): ApplicationPropertyDescriptor[] {
    return [...(this.propertiesByEntity.get(entityType)?.values() ?? [])]
  }

  getProvider(entityType: string): ApplicationEntityProvider | undefined {
    return this.providers.get(entityType)
  }

  resolveSchema(ref: ApplicationSchemaRef, context: ApplicationControlAccessContext): JsonValue {
    const parsedRef = applicationSchemaRefSchema.parse(ref)
    if (parsedRef.catalogVersion !== this.catalogVersion) throw new Error('SCHEMA_VERSION_MISMATCH')
    const document = this.schemaDocuments.get(schemaKey(parsedRef))
    if (!document) throw new Error('SCHEMA_NOT_FOUND')
    if (parsedRef.kind === 'entity') {
      const descriptor = this.entities.get(parsedRef.id)
      if (!descriptor || !descriptor.exposures.includes(context.exposure)) throw new Error('SCHEMA_NOT_FOUND')
      if (!context.acceptedDataClasses.has(descriptor.dataClass)) throw new Error('PERMISSION_DENIED')
    }
    if (parsedRef.kind === 'property') {
      const descriptor = this.properties.get(parsedRef.id)
      if (!descriptor || !this.canReadProperty(descriptor, context)) throw new Error('PERMISSION_DENIED')
    }
    return document.value
  }

  normalizePropertyValue(
    entityType: string,
    propertyId: string,
    value: JsonValue,
    context: ApplicationControlAccessContext
  ): JsonValue {
    const property = this.requireProperty(entityType, propertyId)
    if (!this.canWriteProperty(property, context)) throw new Error(`PERMISSION_DENIED:${propertyId}`)
    if (property.readOnlyReason) throw new Error(`PROPERTY_READ_ONLY:${propertyId}`)
    return normalizeApplicationPropertyValue(property, value)
  }

  async listEntities(
    entityType: string,
    request: ApplicationEntityListRequest,
    context: ApplicationControlAccessContext
  ): Promise<ApplicationEntityListResult> {
    const entity = this.requireEntity(entityType)
    if (!entity.exposures.includes(context.exposure)) throw new Error('PERMISSION_DENIED')
    const result = await this.requireProvider(entityType).listEntities(request)
    for (const ref of result.refs) {
      if (ref.kind !== entity.refKind) throw new Error(`INVALID_ENTITY_REF:${ref.kind}`)
    }
    return result
  }

  async readEntity(
    ref: ApplicationRef,
    propertyIds: string[] | undefined,
    context: ApplicationControlAccessContext
  ): Promise<ApplicationEntitySnapshot> {
    const entity = this.requireEntity(ref.kind)
    const requested = propertyIds ?? this.listProperties(entity.id).map((property) => property.id)
    const allowed = requested.filter((propertyId) => this.canReadProperty(
      this.requireProperty(entity.id, propertyId),
      context
    ))
    const snapshot = applicationEntitySnapshotSchema.parse(
      await this.requireProvider(entity.id).readEntity(ref, { propertyIds: allowed })
    )
    if (snapshot.entityType !== entity.id || snapshot.ref.kind !== entity.refKind) {
      throw new Error(`INVALID_ENTITY_SNAPSHOT:${entity.id}`)
    }
    return {
      ...snapshot,
      properties: Object.fromEntries(Object.entries(snapshot.properties).filter(([propertyId]) => (
        allowed.includes(propertyId)
      ))),
    }
  }

  async getPropertyAvailability(
    ref: ApplicationRef,
    propertyIds: string[],
    context: ApplicationControlAccessContext
  ): Promise<ApplicationPropertyAvailability[]> {
    const entity = this.requireEntity(ref.kind)
    const descriptors = propertyIds.map((propertyId) => this.requireProperty(entity.id, propertyId))
    const dynamic = new Map((await this.requireProvider(entity.id)
      .getPropertyAvailability(ref, propertyIds))
      .map((item) => {
        const parsed = applicationPropertyAvailabilitySchema.parse(item)
        return [parsed.propertyId, parsed]
      }))
    return descriptors.map((descriptor) => {
      const availability = dynamic.get(descriptor.id)
      if (!availability) throw new Error(`PROPERTY_AVAILABILITY_MISSING:${descriptor.id}`)
      const canRead = this.canReadProperty(descriptor, context)
        && hasAllPermissions(availability.requiredPermissions, context)
      const canWrite = canRead
        && this.canWriteProperty(descriptor, context)
        && !descriptor.readOnlyReason
        && availability.writable
      return {
        ...availability,
        readable: availability.readable && canRead,
        writable: canWrite,
        reasons: [
          ...availability.reasons,
          ...(!canRead ? ['当前调用方无权读取该属性'] : []),
          ...(canRead && !canWrite && descriptor.readOnlyReason ? [descriptor.readOnlyReason] : []),
        ],
      }
    })
  }

  private canReadProperty(
    property: ApplicationPropertyDescriptor,
    context: ApplicationControlAccessContext
  ): boolean {
    return property.exposures.includes(context.exposure)
      && canAccessDataClass(property.dataClass, context)
      && hasAllPermissions(property.requiredPermissions.read, context)
  }

  private canWriteProperty(
    property: ApplicationPropertyDescriptor,
    context: ApplicationControlAccessContext
  ): boolean {
    return this.canReadProperty(property, context)
      && hasAllPermissions(property.requiredPermissions.write, context)
  }

  private requireEntity(entityType: string): ApplicationEntityTypeDescriptor {
    const entity = this.entities.get(entityType)
    if (!entity) throw new Error(`ENTITY_TYPE_NOT_FOUND:${entityType}`)
    return entity
  }

  private requireProperty(entityType: string, propertyId: string): ApplicationPropertyDescriptor {
    const property = this.propertiesByEntity.get(entityType)?.get(propertyId)
    if (!property) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
    return property
  }

  private requireProvider(entityType: string): ApplicationEntityProvider {
    const provider = this.providers.get(entityType)
    if (!provider) throw new Error(`ENTITY_PROVIDER_NOT_FOUND:${entityType}`)
    return provider
  }

  private assertSchemaDocumentAvailable(document: ApplicationSchemaDocument): void {
    // schema ref 的校验失败要带上实际的 kind 与 id 再抛。裸 ZodError 只说"某个 id 不匹配
    // 正则"，在有上百条注册项的情况下等于没有信息——实测排查时就卡在这里。
    const parsedRef = applicationSchemaRefSchema.safeParse(document.ref)
    if (!parsedRef.success) {
      const raw = document.ref as { kind?: unknown; id?: unknown } | null
      throw new Error(
        `SCHEMA_REF_INVALID:kind=${String(raw?.kind)},id=${String(raw?.id)} —— ${parsedRef.error.message}`
      )
    }
    const ref = parsedRef.data
    jsonValueSchema.parse(document.value)
    if (ref.catalogVersion !== this.catalogVersion) throw new Error('SCHEMA_VERSION_MISMATCH')
    if (this.schemaDocuments.has(schemaKey(ref))) throw new Error(`SCHEMA_REF_DUPLICATE:${ref.id}`)
  }
}
