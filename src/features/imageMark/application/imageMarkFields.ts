import {
  type ApplicationFieldDefinition,
  type ApplicationPropertyDescriptor,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'
import { sanitizeMarkItem, type ImageMarkDoc, type MarkItem, type MarkRotation } from '@/core/imageEdit'

export const IMAGE_MARK_ENTITY_TYPES = {
  document: 'image_mark.document',
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

const ROTATE_VALUES = ['0', '90', '180', '270'].map((value) => ({ value, label: `${value}°` }))

function parseRotate(value: JsonValue | undefined): MarkRotation {
  if (typeof value !== 'string' || !ROTATE_VALUES.some((entry) => entry.value === value)) {
    throw new Error('INVALID_INPUT：orientation_rotate 只能是 0/90/180/270。')
  }
  return Number(value) as MarkRotation
}

/*
 * 文档级三条属性（旋转、镜像、裁剪矩形），全部读写同一份 ImageMarkDoc——写入表驱动的
 * draft 就是文档快照本身（fieldDefinition.ts 里"直写型"的先例），执行器把它克隆一份，
 * 依次跑完这批 writer 后整体提交，不需要单独的 patch 类型。
 *
 * 三条字段的 storeActions 都写 commitDocument：这是 imageEditSessionStore（6.1）里唯一的
 * "整份文档提交"原语，也是 image_mark.annotation 集合写入落地的同一条原语——账本里
 * commitDocument 选择归到这三条属性，annotation 那侧的集合写入覆盖由它自己的
 * collectionWrite 声明与执行器独立审计，见 imageMarkStoreLedger.ts 的说明。
 */
export const IMAGE_MARK_DOCUMENT_FIELDS: ApplicationFieldDefinition<ImageMarkDoc, ImageMarkDoc>[] = [
  {
    propertyId: `${IMAGE_MARK_ENTITY_TYPES.document}.orientation_rotate`,
    descriptor: property(IMAGE_MARK_ENTITY_TYPES.document, 'orientation_rotate', '旋转角度', { kind: 'enum', values: ROTATE_VALUES }),
    read: (doc) => String(doc.orientation.rotate) as JsonValue,
    writer: {
      write(doc, mutation) {
        doc.orientation = { ...doc.orientation, rotate: parseRotate(mutation.value) }
      },
    },
    storeActions: ['commitDocument'],
  },
  {
    propertyId: `${IMAGE_MARK_ENTITY_TYPES.document}.orientation_mirrored`,
    descriptor: property(IMAGE_MARK_ENTITY_TYPES.document, 'orientation_mirrored', '水平镜像', { kind: 'boolean' }),
    read: (doc) => doc.orientation.mirrored,
    writer: {
      write(doc, mutation) {
        if (typeof mutation.value !== 'boolean') throw new Error('INVALID_INPUT：orientation_mirrored 必须是布尔值。')
        doc.orientation = { ...doc.orientation, mirrored: mutation.value }
      },
    },
    storeActions: ['commitDocument'],
  },
  {
    propertyId: `${IMAGE_MARK_ENTITY_TYPES.document}.crop_rect`,
    descriptor: {
      ...property(IMAGE_MARK_ENTITY_TYPES.document, 'crop_rect', '裁剪矩形', { kind: 'json', schemaRef: schemaRef(`${IMAGE_MARK_ENTITY_TYPES.document}.crop_rect.value`) }),
      nullable: true,
    },
    read: (doc) => (doc.crop as unknown as JsonValue) ?? null,
    writer: {
      write(doc, mutation) {
        if (mutation.value === null) {
          doc.crop = null
          return
        }
        const rect = mutation.value as Record<string, unknown> | null
        if (
          !rect || typeof rect !== 'object' || Array.isArray(rect)
          || typeof rect.x !== 'number' || typeof rect.y !== 'number'
          || typeof rect.width !== 'number' || typeof rect.height !== 'number'
          || rect.width <= 0 || rect.height <= 0
        ) {
          throw new Error('INVALID_INPUT：crop_rect 必须是 {x,y,width,height} 或 null，且 width/height 为正数。')
        }
        doc.crop = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      },
    },
    storeActions: ['commitDocument'],
  },
]

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
    storeActions: ['commitDocument'],
  },
]
