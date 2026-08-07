import {
  fieldWriterTable,
  type ApplicationFieldDefinition,
  type ApplicationPropertyDescriptor,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import { assetApplicationService } from './assetApplicationService'

/*
 * 素材（asset 3 + library 1）共 4 条可写属性的统一定义——1.3 迁移。
 *
 * 这个领域的账本（assetStoreLedger.ts）只覆盖 assetLibraryStore 的面板与筛选状态，
 * 素材改名/打标签/进出集合/集合改名走的是反射层直连领域服务，不经过任何 zustand store
 * 动作，因此这 4 条字段的 `storeActions` 全部是空——不像三维/画布那样需要跟账本对齐。
 */

const ASSET_ENTITY_TYPE = 'asset' as const
const LIBRARY_ENTITY_TYPE = 'asset.library' as const
const ASSET_TAGS_SCHEMA_REF_ID = 'asset.tags.value'

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function assetDescriptor(entityType: string, suffix: string, title: string, value: ApplicationPropertyDescriptor['value']): ApplicationPropertyDescriptor {
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
    requiredPermissions: { read: ['assets:read'], write: ['assets:write'] },
    revisionScopes: ['assets'],
    schemaRef: {
      catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
      kind: 'property',
      id,
      version: 1,
      digest: digest(`property:${id}`),
    },
  }
}

/**
 * 写入目标带一个 `applied` 集合：失败时要按「已经写成功的那几条」精确回滚，
 * 不能整体恢复快照（会把本次之外的并发改动一起冲掉）。
 */
export interface AssetWriteDraft {
  readonly assetId: string
  readonly applied: Set<string>
}

function displayName(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('ASSET_DISPLAY_NAME_INVALID：素材名称必须是非空字符串。')
  }
  return value
}

function tagList(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) throw new Error('ASSET_TAGS_INVALID：tags 必须是字符串数组。')
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error(`ASSET_TAGS_INVALID：第 ${index} 个标签必须是非空字符串。`)
    }
    return item
  })
}

function libraryRefId(value: JsonValue | undefined): string {
  const raw = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, JsonValue>).id
      : undefined
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('ASSET_LIBRARY_REF_INVALID：集合引用必须是集合对象引用或集合 id 字符串。')
  }
  return raw
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

/**
 * 素材 3 条：`display_name` / `tags` 走 set，`library_refs` 是全项目唯一不吃 set 的属性
 * （只吃 append/remove，对应 assetApplicationService 的 addToLibrary/removeFromLibrary）。
 * 读取源是反射层已有的 `assetApplicationService.read()` 结果（`Record<string, unknown>`），
 * 与 assetReflection.ts 的 `readAsset()` 保持一致。
 */
export const ASSET_FIELDS: ApplicationFieldDefinition<Record<string, unknown>, AssetWriteDraft>[] = [
  {
    propertyId: `${ASSET_ENTITY_TYPE}.display_name`,
    descriptor: assetDescriptor(ASSET_ENTITY_TYPE, 'display_name', '显示名称', { kind: 'string', minLength: 1, maxLength: 200 }),
    read: (asset) => String(asset.displayName),
    writer: {
      async write(draft, mutation) {
        await assetApplicationService.rename(draft.assetId, displayName(mutation.value))
        draft.applied.add(mutation.propertyId)
      },
    },
    storeActions: [],
  },
  {
    propertyId: `${ASSET_ENTITY_TYPE}.tags`,
    descriptor: assetDescriptor(ASSET_ENTITY_TYPE, 'tags', '标签', {
      kind: 'json',
      schemaRef: {
        catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
        kind: 'property',
        id: ASSET_TAGS_SCHEMA_REF_ID,
        version: 1,
        digest: digest(`property:${ASSET_TAGS_SCHEMA_REF_ID}`),
      },
    }),
    read: (asset) => asJson(asset.tags ?? []),
    writer: {
      async write(draft, mutation) {
        await assetApplicationService.replaceTags(draft.assetId, tagList(mutation.value))
        draft.applied.add(mutation.propertyId)
      },
    },
    storeActions: [],
  },
  {
    propertyId: `${ASSET_ENTITY_TYPE}.library_refs`,
    descriptor: assetDescriptor(ASSET_ENTITY_TYPE, 'library_refs', '所属集合', { kind: 'ref_list', refKinds: [LIBRARY_ENTITY_TYPE] }),
    read: (asset) => asJson((Array.isArray(asset.libraryIds) ? asset.libraryIds : []).map((id) => ({ kind: LIBRARY_ENTITY_TYPE, id }))),
    writer: {
      // 集合归属是全项目唯一不走 set 的属性：整体替换要分别 remove 旧集合、append 新集合。
      // 声明出来之后模型从工具描述里就能看到，不必靠运行时报错才知道。
      operations: ['append', 'remove'],
      async write(draft, mutation) {
        const id = libraryRefId(mutation.value)
        if (mutation.operation === 'append') await assetApplicationService.addToLibrary(id, draft.assetId)
        else await assetApplicationService.removeFromLibrary(id, draft.assetId)
        draft.applied.add(mutation.propertyId)
      },
    },
    storeActions: [],
  },
]

/** 素材集合改名：写入目标只有集合 id，改名直接落到领域服务，没有需要累积的中间态。 */
export const LIBRARY_FIELDS: ApplicationFieldDefinition<Record<string, unknown>, string>[] = [
  {
    propertyId: `${LIBRARY_ENTITY_TYPE}.name`,
    descriptor: assetDescriptor(LIBRARY_ENTITY_TYPE, 'name', '集合名称', { kind: 'string', minLength: 1, maxLength: 200 }),
    read: (library) => String(library.name),
    writer: {
      async write(libraryId, mutation) {
        if (typeof mutation.value !== 'string' || mutation.value.trim() === '') {
          throw new Error('ASSET_LIBRARY_NAME_INVALID：素材集合名称必须是非空字符串。')
        }
        await assetApplicationService.renameLibrary(libraryId, mutation.value)
      },
    },
    storeActions: [],
  },
]

export const ASSET_WRITERS = fieldWriterTable(ASSET_FIELDS)
export const ASSET_LIBRARY_WRITERS = fieldWriterTable(LIBRARY_FIELDS)
