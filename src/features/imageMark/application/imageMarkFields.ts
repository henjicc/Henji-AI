import {
  type ApplicationFieldDefinition,
  type ApplicationPropertyDescriptor,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { sanitizeMarkItem, type MarkItem } from '@/core/imageEdit'

export const IMAGE_MARK_ENTITY_TYPES = {
  annotation: 'image_mark.annotation',
} as const

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function schemaRef(id: string) {
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind: 'property' as const, id, version: 1, digest: digest(`property:${id}`) }
}

function property(
  entityType: string,
  suffix: string,
  title: string,
  value: ApplicationPropertyDescriptor['value'],
  readOnlyReason?: string,
): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: `标注${title}。`,
    value,
    nullable: false,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['image_mark:read'], write: readOnlyReason ? [] : ['image_mark:write'] },
    revisionScopes: ['image_mark'],
    schemaRef: schemaRef(id),
    ...(readOnlyReason ? { readOnlyReason } : {}),
  }
}

const ANNOTATION_TYPE_VALUES = ['rect', 'ellipse', 'arrow', 'pen', 'text', 'number', 'mosaic']
  .map((value) => ({ value, label: value }))

/*
 * type 只读——创建后不可变（6.2 任务文档的既定结论：改类型等于删了重建，助手能通过
 * 集合写入的 remove+create 达到同样效果，不需要一条"改类型"的写入路径）。
 *
 * data 是唯一可写属性，装的是该 MarkItem 变体除 id/type 外的全部字段（geometry 与 style
 * 混在一起，不再按 rect/arrow/text 各开一批属性）——7 种标注类型形状差异很大（arrow 用
 * points 元组、text 用 text+color+fontSize、mosaic 用 strengthPercent+mode……），拆成
 * 十几条各自 nullable 的属性只会让大多数标注类型上一半属性永远是 null，不如比照
 * generation.draft 的 uploaded_images 先例——折成一条 json，写入校验交给已有的
 * sanitizeMarkItem（@/core/imageEdit/markCodec.ts），不重新发明一套逐字段校验。
 */
export const IMAGE_MARK_ANNOTATION_FIELDS: ApplicationFieldDefinition<MarkItem, MarkItem>[] = [
  {
    propertyId: `${IMAGE_MARK_ENTITY_TYPES.annotation}.type`,
    descriptor: property(IMAGE_MARK_ENTITY_TYPES.annotation, 'type', '标注类型', { kind: 'enum', values: ANNOTATION_TYPE_VALUES }, '创建后不可变；改类型请删除后按新类型重新创建。'),
    read: (item) => item.type,
    storeActions: [],
  },
  {
    propertyId: `${IMAGE_MARK_ENTITY_TYPES.annotation}.data`,
    descriptor: property(IMAGE_MARK_ENTITY_TYPES.annotation, 'data', '标注内容', { kind: 'json', schemaRef: schemaRef(`${IMAGE_MARK_ENTITY_TYPES.annotation}.data.value`) }),
    read: (item) => {
      const { id: _id, type: _type, ...rest } = item as unknown as Record<string, JsonValue>
      return rest
    },
    writer: {
      write(item, mutation) {
        if (typeof mutation.value !== 'object' || mutation.value === null || Array.isArray(mutation.value)) {
          throw new Error('INVALID_INPUT：data 必须是对象。')
        }
        const sanitized = sanitizeMarkItem({ ...item, ...mutation.value, id: item.id, type: item.type })
        if (!sanitized) throw new Error('INVALID_INPUT：data 与当前标注类型不匹配或缺少必填字段。')
        // 整体替换而不是合并：sanitizeMarkItem 只在存在有效 label 时才带出 label* 字段，
        // Object.assign 不会清掉 item 上的旧 label——先清空再赋值，避免残留字段。
        for (const key of Object.keys(item)) delete (item as unknown as Record<string, unknown>)[key]
        Object.assign(item, sanitized)
      },
    },
    storeActions: [],
  },
]
