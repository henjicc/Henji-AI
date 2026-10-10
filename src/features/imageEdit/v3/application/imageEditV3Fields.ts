import { deformationSchema } from '@/core/imaging/transforms';
import { imageEditTransformSchemaV3, imageEditMaskAttachmentSchemaV3, imageEditLayerFiltersSchemaV3, imageEditSparseMaskSchemaV3 } from '@/core/imageEdit/v3/layerModel/semantics'
import { z } from 'zod'
import type { ImageEditCanvasGeometryV3 } from '@/core/imageEdit/v3/documentTypes'
import type {
  ApplicationFieldDefinition,
  ApplicationPropertyDescriptor,
  ApplicationRef,
  JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import type { ImageEditLayerCommonPatchV3 } from '@/core/imageEdit/v3/commandTypes'
import {
  collectImageEditMaskResourceIdsV3,
  type ImageEditLayerV3,
  type ImageEditLayerFilterV3,
} from '@/core/imageEdit/v3/layerTypes'

import { imageEditV3FilterRef, imageEditV3DocumentRef, imageEditV3GroupRef, imageEditV3LayerRef, imageEditV3MaskRef, imageEditV3ResourceRef, type ImageEditLiveLayerLocationV3 } from './imageEditDocumentRefs'

export const IMAGE_EDIT_V3_ENTITY_TYPES = {
  group: 'image_edit.group',
  mask: 'image_edit.mask',
  resource: 'image_edit.resource',
} as const

export interface ImageEditV3LayerFieldSource {
  documentId: string
  location: ImageEditLiveLayerLocationV3
}

export interface ImageEditV3LayerMutationDraft {
  commonPatch: ImageEditLayerCommonPatchV3
  params?: Record<string, JsonValue>
  isolated?: boolean
  parentRef?: ApplicationRef
  index?: number
}

export interface ImageEditV3MaskFieldSource {
  documentId: string
  location: ImageEditLiveLayerLocationV3
}

export interface ImageEditV3MaskMutationDraft {
  inverted?: boolean
}

function digest(seed: string): string {
  const value = [...seed]
    .reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381)
    .toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

export function imageEditV3SchemaRef(kind: 'entity' | 'property', id: string) {
  return {
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    kind,
    id,
    version: 1,
    digest: digest(`${kind}:${id}`),
  } as const
}

function property(
  entityType: string,
  suffix: string,
  title: string,
  value: ApplicationPropertyDescriptor['value'],
  options: { nullable?: boolean; readOnlyReason?: string } = {},
): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: `图片编辑 V3 ${title}。`,
    value,
    nullable: options.nullable ?? false,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: {
      read: ['image_edit:read'],
      write: options.readOnlyReason ? [] : ['image_edit:write'],
    },
    revisionScopes: ['image_edit'],
    schemaRef: imageEditV3SchemaRef('property', id),
    ...(options.readOnlyReason ? { readOnlyReason: options.readOnlyReason } : {}),
  }
}

const READ_ONLY_IDENTITY = '由当前打开的 V3 图片文档和图层树维护。'
const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft-light']
  .map((value) => ({ value, label: value }))
const LAYER_TYPES = ['raster', 'annotation', 'effect', 'adjustment']
  .map((value) => ({ value, label: value }))
const PARAMS_SCHEMA_REF = imageEditV3SchemaRef('property', 'image_edit.layer.params.value')

function parentRef(source: ImageEditV3LayerFieldSource): ApplicationRef {
  return source.location.parentId
    ? imageEditV3GroupRef(source.documentId, source.location.parentId)
    : imageEditV3DocumentRef(source.documentId)
}

function layerType(layer: ImageEditLayerV3): JsonValue {
  return layer.type
}

function definitionId(layer: ImageEditLayerV3): JsonValue {
  if (layer.type === 'effect') return layer.effectId
  if (layer.type === 'adjustment') return layer.adjustmentId
  return null
}

function params(layer: ImageEditLayerV3): JsonValue {
  if (layer.type === 'effect' || layer.type === 'adjustment') return layer.params as JsonValue
  return null
}

function createCommonFields(
  entityType: 'image_edit.layer' | 'image_edit.group',
): ApplicationFieldDefinition<ImageEditV3LayerFieldSource, ImageEditV3LayerMutationDraft>[] {
  return [
  { propertyId: `${entityType}.transform`, descriptor: property(entityType, 'transform', '对象到父级的可逆仿射矩阵，顺序 a,b,c,d,x,y；移动、缩放、旋转与错切共用该值。', { kind: 'json', schemaRef: imageEditV3SchemaRef('property', `${entityType}.transform.value`) }), read: source => [...source.location.layer.transform], writer: { write(draft, mutation) { draft.commonPatch.transform = imageEditTransformSchemaV3.parse(mutation.value); } }, storeActions: [] },
    {
      propertyId: `${entityType}.document_ref`,
      descriptor: property(entityType, 'document_ref', '所属文档', {
        kind: 'ref', refKinds: ['image_edit.document'],
      }, { readOnlyReason: READ_ONLY_IDENTITY }),
      read: (source) => imageEditV3DocumentRef(source.documentId),
      storeActions: [],
    },
    {
      propertyId: `${entityType}.parent_ref`,
      descriptor: property(entityType, 'parent_ref', '父级', {
        kind: 'ref', refKinds: ['image_edit.document', 'image_edit.group'],
      }),
      read: parentRef,
      writer: {
        write(draft, mutation) {
          const value = mutation.value
          if (
            !value
            || typeof value !== 'object'
            || Array.isArray(value)
            || (value.kind !== 'image_edit.document' && value.kind !== 'image_edit.group')
            || typeof value.id !== 'string'
            || value.id.length === 0
          ) {
            throw new Error('INVALID_INPUT：parent_ref 必须是图片文档或图层组引用。')
          }
          draft.parentRef = {
            kind: value.kind,
            id: value.id,
            ...(typeof value.revision === 'number' ? { revision: value.revision } : {}),
          }
        },
      },
      storeActions: [],
    },
    {
      propertyId: `${entityType}.index`,
      descriptor: property(entityType, 'index', '同级顺序', {
        kind: 'integer', hardRange: { min: 0 }, softRange: { min: 0, max: 64, step: 1 },
      }),
      read: (source) => source.location.index,
      writer: {
        write(draft, mutation) {
          if (!Number.isSafeInteger(mutation.value) || (mutation.value as number) < 0) {
            throw new Error('INVALID_INPUT：index 必须是非负整数。')
          }
          draft.index = mutation.value as number
        },
      },
      storeActions: [],
    },
    {
      propertyId: `${entityType}.name`,
      descriptor: property(entityType, 'name', '名称', { kind: 'string', minLength: 1, maxLength: 120 }),
      read: (source) => source.location.layer.name,
      writer: {
        write(draft, mutation) {
          if (typeof mutation.value !== 'string' || mutation.value.trim().length === 0) {
            throw new Error('INVALID_INPUT：图层名称不能为空。')
          }
          draft.commonPatch.name = mutation.value.trim()
        },
      },
      storeActions: [],
    },
    {
      propertyId: `${entityType}.visible`,
      descriptor: property(entityType, 'visible', '可见状态', { kind: 'boolean' }),
      read: (source) => source.location.layer.visible,
      writer: {
        write(draft, mutation) {
          if (typeof mutation.value !== 'boolean') throw new Error('INVALID_INPUT：visible 必须是布尔值。')
          draft.commonPatch.visible = mutation.value
        },
      },
      storeActions: [],
    },
    {
      propertyId: `${entityType}.locked`,
      descriptor: property(entityType, 'locked', '锁定状态', { kind: 'boolean' }),
      read: (source) => source.location.layer.locked,
      writer: {
        write(draft, mutation) {
          if (typeof mutation.value !== 'boolean') throw new Error('INVALID_INPUT：locked 必须是布尔值。')
          draft.commonPatch.locked = mutation.value
        },
      },
      storeActions: [],
    },
    {
      propertyId: `${entityType}.opacity`,
      descriptor: property(entityType, 'opacity', '不透明度', {
        kind: 'number', hardRange: { min: 0, max: 1 }, softRange: { min: 0, max: 1, step: 0.01 },
      }),
      read: (source) => source.location.layer.opacity,
      writer: {
        write(draft, mutation) {
          if (typeof mutation.value !== 'number' || !Number.isFinite(mutation.value)) {
            throw new Error('INVALID_INPUT：opacity 必须是 0～1 的数字。')
          }
          draft.commonPatch.opacity = mutation.value
        },
      },
      storeActions: [],
    },
    {
      propertyId: `${entityType}.fill_opacity`,
      descriptor: property(entityType, 'fill_opacity', '内容填充', {
        kind: 'number', hardRange: { min: 0, max: 1 }, softRange: { min: 0, max: 1, step: 0.01 },
      }),
      read: source => source.location.layer.fillOpacity,
      writer: { write(draft, mutation) {
        if (typeof mutation.value !== 'number' || !Number.isFinite(mutation.value)) throw new Error('INVALID_INPUT：填充必须是 0～1 的数字');
        draft.commonPatch.fillOpacity = mutation.value;
      } }, storeActions: [],
    },
    {
      propertyId: `${entityType}.clipping`,
      descriptor: property(entityType, 'clipping', '剪贴到同组下方内容基底', { kind: 'boolean' }),
      read: source => source.location.layer.clipping,
      writer: { write(draft, mutation) {
        if (typeof mutation.value !== 'boolean') throw new Error('INVALID_INPUT：剪贴必须是布尔值');
        draft.commonPatch.clipping = mutation.value;
      } }, storeActions: [],
    },
    {
      propertyId: `${entityType}.mask_attachment`,
      descriptor: property(entityType, 'mask_attachment', '蒙版启用、链接、密度与变换', {
        kind: 'json', schemaRef: imageEditV3SchemaRef('property', `${entityType}.mask_attachment.value`),
      }),
      read: source => source.location.layer.maskAttachment as unknown as JsonValue,
      writer: { write(draft, mutation) {
        draft.commonPatch.maskAttachment = imageEditMaskAttachmentSchemaV3.parse(mutation.value);
      } }, storeActions: [],
    },
    {
      propertyId: `${entityType}.filter_refs`,
      descriptor: property(entityType, 'filter_refs', '按执行顺序排列的图层滤镜引用', { kind: 'ref_list', refKinds: ['image_edit.layer_filter'] }, { readOnlyReason: '通过图层滤镜集合增删，或修改滤镜顺序。' }),
      read: source => source.location.layer.filters.map(filter => imageEditV3FilterRef(source.documentId, source.location.layer.id, filter.id)),
      storeActions: [],
    },
    {
      propertyId: `${entityType}.filters`,
      descriptor: property(entityType, 'filters', '有序图层滤镜与局部区域快照', {
        kind: 'json', schemaRef: imageEditV3SchemaRef('property', `${entityType}.filters.value`),
      }),
      read: source => source.location.layer.filters as unknown as JsonValue,
      writer: { write(draft, mutation) {
        draft.commonPatch.filters = imageEditLayerFiltersSchemaV3.parse(mutation.value);
      } }, storeActions: [],
    },
    {
      propertyId: `${entityType}.blend_mode`,
      descriptor: property(entityType, 'blend_mode', '混合模式', { kind: 'enum', values: BLEND_MODES }),
      read: (source) => source.location.layer.blendMode,
      writer: {
        write(draft, mutation) {
          if (typeof mutation.value !== 'string' || !BLEND_MODES.some(({ value }) => value === mutation.value)) {
            throw new Error('INVALID_INPUT：blend_mode 不受支持。')
          }
          draft.commonPatch.blendMode = mutation.value as ImageEditLayerCommonPatchV3['blendMode']
        },
      },
      storeActions: [],
    },
    {
      propertyId: `${entityType}.mask_ref`,
      descriptor: property(entityType, 'mask_ref', '蒙版引用', {
        kind: 'ref', refKinds: ['image_edit.mask'],
      }, { nullable: true, readOnlyReason: '蒙版资源由蒙版编辑与图层蒙版命令维护。' }),
      read: (source) => source.location.layer.mask
        ? imageEditV3MaskRef(source.documentId, source.location.layer.id)
        : null,
      storeActions: [],
    },
  ]
}

export const IMAGE_EDIT_V3_LAYER_FIELDS: ApplicationFieldDefinition<
  ImageEditV3LayerFieldSource,
  ImageEditV3LayerMutationDraft
>[] = [
  ...createCommonFields('image_edit.layer'),
  { propertyId: 'image_edit.layer.deformation', descriptor: property('image_edit.layer', 'deformation', '非破坏透视或网格；控制点为对象空间比例，四角顺时针或网格逐行。清空恢复原像素。', { kind: 'json', schemaRef: imageEditV3SchemaRef('property', 'image_edit.layer.deformation.value') }, { nullable: true }), read: source => source.location.layer.deformation as JsonValue ?? null, writer: { write(draft, mutation) { draft.commonPatch.deformation = deformationSchema.nullable().parse(mutation.value); } }, storeActions: [] },
  {
    propertyId: 'image_edit.layer.type',
    descriptor: property('image_edit.layer', 'type', '类型', { kind: 'enum', values: LAYER_TYPES }, {
      readOnlyReason: '图层类型创建后固定；改类型请删除并新建图层。',
    }),
    read: (source) => layerType(source.location.layer),
    storeActions: [],
  },
  {
    propertyId: 'image_edit.layer.definition_id',
    descriptor: property('image_edit.layer', 'definition_id', '效果或调整定义', {
      kind: 'string', maxLength: 120,
    }, { nullable: true, readOnlyReason: '效果或调整定义在图层创建时固定。' }),
    read: (source) => definitionId(source.location.layer),
    storeActions: [],
  },
  {
    propertyId: 'image_edit.layer.params',
    descriptor: property('image_edit.layer', 'params', '效果或调整参数', {
      kind: 'json', schemaRef: PARAMS_SCHEMA_REF,
    }, { nullable: true }),
    read: (source) => params(source.location.layer),
    writer: {
      write(draft, mutation) {
        if (!mutation.value || typeof mutation.value !== 'object' || Array.isArray(mutation.value)) {
          throw new Error('INVALID_INPUT：params 必须是 JSON 对象。')
        }
        draft.params = structuredClone(mutation.value) as Record<string, JsonValue>
      },
    },
    storeActions: [],
  },
]

export const IMAGE_EDIT_V3_GROUP_FIELDS: ApplicationFieldDefinition<
  ImageEditV3LayerFieldSource,
  ImageEditV3LayerMutationDraft
>[] = [
  ...createCommonFields('image_edit.group'),
  {
    propertyId: 'image_edit.group.child_refs',
    descriptor: property('image_edit.group', 'child_refs', '子图层', {
      kind: 'ref_list', refKinds: ['image_edit.layer', 'image_edit.group'],
    }, { readOnlyReason: '子图层顺序由图层树命令维护。' }),
    read: (source) => source.location.layer.type === 'group'
      ? source.location.layer.children.map((child) => child.type === 'group'
        ? imageEditV3GroupRef(source.documentId, child.id)
        : imageEditV3LayerRef(source.documentId, child.id))
      : [],
    storeActions: [],
  },
  {
    propertyId: 'image_edit.group.isolated',
    descriptor: property('image_edit.group', 'isolated', '隔离合成', { kind: 'boolean' }),
    read: (source) => source.location.layer.type === 'group' && source.location.layer.isolated,
    writer: {
      write(draft, mutation) {
        if (typeof mutation.value !== 'boolean') throw new Error('INVALID_INPUT：isolated 必须是布尔值。')
        draft.isolated = mutation.value
      },
    },
    storeActions: [],
  },
]

export const IMAGE_EDIT_V3_MASK_FIELDS: ApplicationFieldDefinition<
  ImageEditV3MaskFieldSource,
  ImageEditV3MaskMutationDraft
>[] = [
  {
    propertyId: 'image_edit.mask.document_ref',
    descriptor: property('image_edit.mask', 'document_ref', '所属文档', {
      kind: 'ref', refKinds: ['image_edit.document'],
    }, { readOnlyReason: READ_ONLY_IDENTITY }),
    read: (source) => imageEditV3DocumentRef(source.documentId),
    storeActions: [],
  },
  {
    propertyId: 'image_edit.mask.layer_ref',
    descriptor: property('image_edit.mask', 'layer_ref', '所属图层', {
      kind: 'ref', refKinds: ['image_edit.layer', 'image_edit.group'],
    }, { readOnlyReason: READ_ONLY_IDENTITY }),
    read: (source) => source.location.layer.type === 'group'
      ? imageEditV3GroupRef(source.documentId, source.location.layer.id)
      : imageEditV3LayerRef(source.documentId, source.location.layer.id),
    storeActions: [],
  },
  {
    propertyId: 'image_edit.mask.resource_refs',
    descriptor: property('image_edit.mask', 'resource_refs', '像素资源引用', {
      kind: 'ref_list', refKinds: ['image_edit.resource'],
    }, { readOnlyReason: '蒙版像素由蒙版编辑工具维护。' }),
    read: (source) => source.location.layer.mask
      ? collectImageEditMaskResourceIdsV3(source.location.layer.mask)
        .map((resourceId) => imageEditV3ResourceRef(source.documentId, resourceId))
      : [],
    storeActions: [],
  },
  {
    propertyId: 'image_edit.mask.inverted',
    descriptor: property('image_edit.mask', 'inverted', '反相状态', { kind: 'boolean' }),
    read: (source) => source.location.layer.mask?.inverted ?? false,
    writer: {
      write(draft, mutation) {
        if (typeof mutation.value !== 'boolean') throw new Error('INVALID_INPUT：inverted 必须是布尔值。')
        draft.inverted = mutation.value
      },
    },
    storeActions: [],
  },
]

export const IMAGE_EDIT_V3_PARAMS_SCHEMA_REF = PARAMS_SCHEMA_REF

/** 文档输出几何与界面裁剪使用同一 V3 命令校验。 */
export const IMAGE_EDIT_V3_DOCUMENT_FIELDS: ApplicationFieldDefinition<ImageEditCanvasGeometryV3, ImageEditCanvasGeometryV3>[] = [
  { propertyId: 'image_edit.document.orientation_rotate', descriptor: property('image_edit.document', 'orientation_rotate', '旋转角度', { kind: 'enum', values: ['0', '90', '180', '270'].map(value => ({ value, label: value })) }),
    read: geometry => String(geometry.orientation.rotate), writer: { write(geometry, mutation) {
      const rotate = z.enum(['0', '90', '180', '270']).parse(mutation.value)
      geometry.orientation = { ...geometry.orientation, rotate: Number(rotate) as 0 | 90 | 180 | 270 }
    } }, storeActions: [] },
  { propertyId: 'image_edit.document.orientation_mirrored', descriptor: property('image_edit.document', 'orientation_mirrored', '水平镜像', { kind: 'boolean' }),
    read: geometry => geometry.orientation.mirrored, writer: { write(geometry, mutation) {
      geometry.orientation = { ...geometry.orientation, mirrored: z.boolean().parse(mutation.value) }
    } }, storeActions: [] },
  { propertyId: 'image_edit.document.crop_rect', descriptor: property('image_edit.document', 'crop_rect', '裁剪区域', { kind: 'json', schemaRef: imageEditV3SchemaRef('property', 'image_edit.document.crop_rect.value') }, { nullable: true }),
    read: geometry => geometry.crop as unknown as JsonValue, writer: { write(geometry, mutation) {
      geometry.crop = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).strict().nullable().parse(mutation.value)
    } }, storeActions: [] },
]

export interface ImageEditV3FilterFieldSource {
  documentId: string
  location: ImageEditLiveLayerLocationV3
  filter: ImageEditLayerFilterV3
  index: number
}
export interface ImageEditV3FilterMutationDraft { filter: ImageEditLayerFilterV3; index: number }

export const IMAGE_EDIT_V3_FILTER_FIELDS: ApplicationFieldDefinition<ImageEditV3FilterFieldSource, ImageEditV3FilterMutationDraft>[] = [
  { propertyId: 'image_edit.layer_filter.layer_ref', descriptor: property('image_edit.layer_filter', 'layer_ref', '所属图层', { kind: 'ref', refKinds: ['image_edit.layer', 'image_edit.group'] }, { readOnlyReason: READ_ONLY_IDENTITY }),
    read: source => source.location.layer.type === 'group' ? imageEditV3GroupRef(source.documentId, source.location.layer.id) : imageEditV3LayerRef(source.documentId, source.location.layer.id), storeActions: [] },
  ...(['operation_type', 'effect_id'] as const).map(suffix => ({
    propertyId: `image_edit.layer_filter.${suffix}`,
    descriptor: property('image_edit.layer_filter', suffix, suffix === 'effect_id' ? '滤镜定义' : '滤镜种类', suffix === 'effect_id' ? { kind: 'string' } : { kind: 'enum', values: ['effect', 'adjustment'].map(value => ({ value, label: value })) }, { readOnlyReason: '滤镜定义在创建时确定；更换定义请删除后重新添加。' }),
    read: (source: ImageEditV3FilterFieldSource) => suffix === 'effect_id' ? source.filter.effectId : source.filter.operationType, storeActions: [],
  })),
  { propertyId: 'image_edit.layer_filter.index', descriptor: property('image_edit.layer_filter', 'index', '图层内滤镜顺序', { kind: 'integer', hardRange: { min: 0 } }),
    read: source => source.index, writer: { write(draft, mutation) { draft.index = z.number().int().nonnegative().parse(mutation.value) } }, storeActions: [] },
  { propertyId: 'image_edit.layer_filter.enabled', descriptor: property('image_edit.layer_filter', 'enabled', '滤镜开关', { kind: 'boolean' }),
    read: source => source.filter.enabled, writer: { write(draft, mutation) { draft.filter.enabled = z.boolean().parse(mutation.value) } }, storeActions: [] },
  { propertyId: 'image_edit.layer_filter.opacity', descriptor: property('image_edit.layer_filter', 'opacity', '滤镜强度', { kind: 'number', hardRange: { min: 0, max: 1 } }),
    read: source => source.filter.opacity, writer: { write(draft, mutation) { draft.filter.opacity = z.number().min(0).max(1).parse(mutation.value) } }, storeActions: [] },
  { propertyId: 'image_edit.layer_filter.blend_mode', descriptor: property('image_edit.layer_filter', 'blend_mode', '滤镜混合模式', { kind: 'enum', values: BLEND_MODES }),
    read: source => source.filter.blendMode, writer: { write(draft, mutation) { draft.filter.blendMode = z.enum(['normal', 'multiply', 'screen', 'overlay', 'soft-light']).parse(mutation.value) } }, storeActions: [] },
  { propertyId: 'image_edit.layer_filter.params', descriptor: property('image_edit.layer_filter', 'params', '滤镜参数', { kind: 'json', schemaRef: PARAMS_SCHEMA_REF }),
    read: source => source.filter.params as JsonValue, writer: { write(draft, mutation) { draft.filter.params = z.record(z.string(), z.json()).parse(mutation.value) } }, storeActions: [] },
  { propertyId: 'image_edit.layer_filter.mask', descriptor: property('image_edit.layer_filter', 'mask', '滤镜局部区域快照', { kind: 'json', schemaRef: imageEditV3SchemaRef('property', 'image_edit.layer_filter.mask.value') }, { nullable: true }),
    read: source => source.filter.mask as unknown as JsonValue, writer: { write(draft, mutation) { draft.filter.mask = imageEditSparseMaskSchemaV3.nullable().parse(mutation.value) } }, storeActions: [] },
]
