import {
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import { assetApplicationService } from './assetApplicationService'

export const ASSET_ENTITY_TYPES = {
  catalog: 'asset.catalog',
  asset: 'asset',
  library: 'asset.library',
} as const

type AssetEntityType = typeof ASSET_ENTITY_TYPES[keyof typeof ASSET_ENTITY_TYPES]

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
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

function property(entityType: AssetEntityType, suffix: string, title: string, value: ApplicationPropertyDescriptor['value'], readOnlyReason?: string): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: `素材库${title}。`,
    value,
    nullable: false,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['assets:read'], write: readOnlyReason ? [] : ['assets:write'] },
    revisionScopes: ['assets'],
    schemaRef: {
      catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
      kind: 'property',
      id,
      version: 1,
      digest: digest(`property:${id}`),
    },
    ...(readOnlyReason ? { readOnlyReason } : {}),
  }
}

const READ_ONLY = '该属性由素材文件检查或正式语义操作维护。'
const ASSET_TAGS_VALUE_SCHEMA_REF = schemaRef('property', 'asset.tags.value')
const properties: Record<AssetEntityType, ApplicationPropertyDescriptor[]> = {
  [ASSET_ENTITY_TYPES.catalog]: [
    property(ASSET_ENTITY_TYPES.catalog, 'library_count', '集合数量', { kind: 'integer', hardRange: { min: 0 } }, READ_ONLY),
  ],
  [ASSET_ENTITY_TYPES.asset]: [
    property(ASSET_ENTITY_TYPES.asset, 'display_name', '显示名称', { kind: 'string', minLength: 1, maxLength: 200 }),
    property(ASSET_ENTITY_TYPES.asset, 'media_type', '媒体类型', { kind: 'enum', values: ['image', 'video', 'audio'].map((value) => ({ value, label: value })) }, READ_ONLY),
    property(ASSET_ENTITY_TYPES.asset, 'tags', '标签', { kind: 'json', schemaRef: ASSET_TAGS_VALUE_SCHEMA_REF }),
    // 集合归属用 append / remove 两个属性修改操作表达，对应服务的 addToLibrary / removeFromLibrary。
    // 这类「成员关系」不需要独立的集合执行器：ref_list 属性本身就支持增删语义。
    property(ASSET_ENTITY_TYPES.asset, 'library_refs', '所属集合', { kind: 'ref_list', refKinds: [ASSET_ENTITY_TYPES.library] }),
    property(ASSET_ENTITY_TYPES.asset, 'inspection_status', '检查状态', { kind: 'string', maxLength: 40 }, READ_ONLY),
    property(ASSET_ENTITY_TYPES.asset, 'media_ref', '媒体引用', { kind: 'string', maxLength: 4096 }, READ_ONLY),
  ],
  [ASSET_ENTITY_TYPES.library]: [
    property(ASSET_ENTITY_TYPES.library, 'name', '集合名称', { kind: 'string', minLength: 1, maxLength: 200 }),
  ],
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

class AssetReflectionProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: AssetEntityType) {}

  async listEntities(request: { cursor?: string; limit: number }) {
    const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
    if (this.entityType === ASSET_ENTITY_TYPES.catalog) {
      const libraries = await assetApplicationService.listLibraries()
      return {
        refs: offset === 0 && request.limit > 0
          ? [{ kind: this.entityType, id: 'default', label: '素材库' }]
          : [],
        nextCursor: null,
        revisions: { assets: Math.max(0, ...libraries.map((item) => Number(item.updatedAt) || 0)) },
      }
    }
    if (this.entityType === ASSET_ENTITY_TYPES.library) {
      const libraries = await assetApplicationService.listLibraries()
      const page = libraries.slice(offset, offset + request.limit)
      return {
        refs: page.map((library) => ({ kind: this.entityType, id: String(library.id), label: String(library.name) })),
        nextCursor: offset + page.length < libraries.length ? String(offset + page.length) : null,
        revisions: { assets: Math.max(0, ...libraries.map((item) => Number(item.updatedAt) || 0)) },
      }
    }
    const pageNumber = Math.floor(offset / request.limit) + 1
    const result = await assetApplicationService.query({ page: pageNumber, pageSize: request.limit, sort: 'created' })
    const items = Array.isArray(result.items) ? result.items : []
    const total = Number(result.total) || items.length
    return {
      refs: items.map((item) => {
        const asset = item as Record<string, unknown>
        return { kind: this.entityType, id: String(asset.id), label: String(asset.displayName) }
      }),
      nextCursor: offset + items.length < total ? String(offset + items.length) : null,
      revisions: { assets: Math.max(0, ...items.map((item) => Number((item as Record<string, unknown>).updatedAt) || 0)) },
    }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    const values = this.entityType === ASSET_ENTITY_TYPES.asset
      ? await this.readAsset(ref.id)
      : this.entityType === ASSET_ENTITY_TYPES.library
        ? await this.readLibrary(ref.id)
        : await this.readCatalog(ref.id)
    const revisionKey = `${this.entityType}.updated_at`
    const visible = Object.fromEntries(Object.entries(values).filter(([id]) => id !== revisionKey))
    const selected = request.propertyIds
      ? Object.fromEntries(Object.entries(visible).filter(([id]) => request.propertyIds?.includes(id)))
      : visible
    return {
      ref,
      entityType: this.entityType,
      revisions: { assets: Number(values[revisionKey] ?? 0) },
      properties: selected,
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    await this.readEntity(ref, {})
    const descriptors = new Map(properties[this.entityType].map((item) => [item.id, item]))
    return propertyIds.map((propertyId) => {
      const descriptor = descriptors.get(propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return {
        propertyId,
        readable: true,
        writable: !descriptor.readOnlyReason,
        reasons: descriptor.readOnlyReason ? [descriptor.readOnlyReason] : [],
        requiredPermissions: ['assets:read'],
        revisions: { assets: 0 },
      }
    })
  }

  private async readAsset(assetId: string): Promise<Record<string, JsonValue>> {
    const asset = await assetApplicationService.read(assetId)
    return {
      'asset.display_name': String(asset.displayName),
      'asset.media_type': String(asset.mediaType),
      'asset.tags': asJson(asset.tags ?? []),
      'asset.library_refs': asJson((Array.isArray(asset.libraryIds) ? asset.libraryIds : []).map((id) => ({ kind: ASSET_ENTITY_TYPES.library, id }))),
      'asset.inspection_status': String(asset.inspectionStatus),
      'asset.media_ref': String(asset.displayUrl ?? ''),
      'asset.updated_at': Number(asset.updatedAt) || 0,
    }
  }

  private async readLibrary(libraryId: string): Promise<Record<string, JsonValue>> {
    const library = (await assetApplicationService.listLibraries()).find((item) => item.id === libraryId)
    if (!library) throw new Error('NOT_FOUND')
    return {
      'asset.library.name': String(library.name),
      'asset.library.updated_at': Number(library.updatedAt) || 0,
    }
  }

  private async readCatalog(catalogId: string): Promise<Record<string, JsonValue>> {
    if (catalogId !== 'default') throw new Error('NOT_FOUND')
    const libraries = await assetApplicationService.listLibraries()
    return {
      'asset.catalog.library_count': libraries.length,
      'asset.catalog.updated_at': Math.max(0, ...libraries.map((item) => Number(item.updatedAt) || 0)),
    }
  }
}

export function createAssetReflectionRegistrations(): ApplicationEntityRegistration[] {
  return (Object.values(ASSET_ENTITY_TYPES) as AssetEntityType[]).map((entityType) => ({
    entity: {
      id: entityType,
      version: 1,
      domain: 'assets',
      title: entityType === ASSET_ENTITY_TYPES.asset
        ? '素材'
        : entityType === ASSET_ENTITY_TYPES.library ? '素材集合' : '素材库根目录',
      description: '素材库中的稳定实体引用。',
      refKind: entityType,
      dataClass: 'C1',
      exposures: ['ui', 'assistant', 'local_adapter'],
      parentTypes: entityType === ASSET_ENTITY_TYPES.library ? [ASSET_ENTITY_TYPES.catalog] : [],
      revisionScopes: ['assets'],
      queryCapabilityIds: [entityType === ASSET_ENTITY_TYPES.asset ? 'get_asset' : 'list_asset_libraries'],
      schemaRef: schemaRef('entity', entityType),
      ...(entityType === ASSET_ENTITY_TYPES.library ? {
        collectionWrite: {
          creatable: true,
          removable: true,
          requiredPropertyIds: ['asset.library.name'],
          maxItemsPerChange: 32,
        },
      } : {}),
      ...(entityType === ASSET_ENTITY_TYPES.catalog ? {
        writeExclusion: {
          reason: '素材库根目录是固定容器；其子集合由 asset.library 集合写入执行器创建、删除和恢复。',
        },
      } : {}),
    },
    properties: properties[entityType],
    provider: new AssetReflectionProvider(entityType),
    schemaDocuments: entityType === ASSET_ENTITY_TYPES.asset ? [{
      ref: ASSET_TAGS_VALUE_SCHEMA_REF,
      value: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 80 } },
    }] : [],
  }))
}
