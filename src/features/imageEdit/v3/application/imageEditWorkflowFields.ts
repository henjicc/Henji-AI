import { canvasSizeSchemaV3 } from '@/core/imageEdit/v3/documentGeometry'
import { z } from 'zod'
import type { ApplicationFieldDefinition, ApplicationPropertyDescriptor, JsonValue } from '@/core/application-control'
import { imageEditNamedRegionsSchemaV3, type ImageEditNamedRegionV3 } from '@/core/imageEdit/v3/namedRegions'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditLayersMoveCommandV3 } from '@/core/imageEdit/v3/commandTypes'
import { collectImageEditV3LiveLayers } from './imageEditDocumentRefs'
import { imageEditV3SchemaRef } from './imageEditV3Fields'

export const imageEditLayerMovesSchemaV3 = z.array(z.object({ layerId: z.string().min(1), parentId: z.string().min(1).nullable(), index: z.number().int().nonnegative() }).strict()).min(1)
export interface ImageEditWorkflowDraftV3 { regions?: ImageEditNamedRegionV3[]; moves?: ImageEditLayersMoveCommandV3['moves']; canvasSize?: z.infer<typeof canvasSizeSchemaV3> }
function descriptor(suffix: string, title: string, description: string): ApplicationPropertyDescriptor {
  const id = `image_edit.document.${suffix}`
  return { id, entityType: 'image_edit.document', version: 1, title, description, value: { kind: 'json', schemaRef: imageEditV3SchemaRef('property', `${id}.value`) },
    ...(suffix === 'layer_order' || suffix === 'canvas_size' ? { verificationStrategy: 'execution' as const } : {}),
    nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['image_edit:read'], write: ['image_edit:write'] },
    revisionScopes: ['image_edit'], schemaRef: imageEditV3SchemaRef('property', id) }
}
export const IMAGE_EDIT_WORKFLOW_FIELDS_V3: ApplicationFieldDefinition<ImageEditDocumentV3, ImageEditWorkflowDraftV3>[] = [
  { propertyId: 'image_edit.document.canvas_size', descriptor: descriptor('canvas_size', '画布尺寸与锚点', '读回原始画布的 width/height，anchor 默认 center。写入正整数宽高与 top-left/top/top-right/left/center/right/bottom-left/bottom/bottom-right 锚点；锚点只决定这次边界移动，不是图像重采样。保持原稿像素、路径、蒙版与滤镜，裁掉的画布外内容仍在原稿中。尺寸不变时不创建历史。'),
    read: document => ({ width: document.geometry.width, height: document.geometry.height, anchor: 'center' }),
    writer: { write(draft, mutation) { draft.canvasSize = canvasSizeSchemaV3.parse(mutation.value) } }, storeActions: [] },
  { propertyId: 'image_edit.document.named_regions', descriptor: descriptor('named_regions', '命名选区通道', '按顺序保存独立命名区域，每项 id 唯一、name 非空、selection 与当前选区 region 同语义。坐标为原始画面比例，羽化按短边比例。增删或重命名后写回列表；加载时把所选 selection 写入 image_edit.selection.region，再调用已有选区应用能力。'),
    read: document => structuredClone(document.namedRegions) as unknown as JsonValue,
    writer: { write(draft, mutation) { draft.regions = imageEditNamedRegionsSchemaV3.parse(mutation.value) } }, storeActions: [] },
  { propertyId: 'image_edit.document.layer_order', descriptor: descriptor('layer_order', '图层树位置', '读回各图层的文档内 layerId、父组 parentId 与自下而上 index。写入需要移动的部分，index 是所有移动完成后的最终位置；null 父级为文档根。剪贴层与基底可以一起移动，一个命令整体验证并撤销。不要同时移动组及其后代。'),
    read: document => collectImageEditV3LiveLayers(document).map(({ layer, parentId, index }) => ({ layerId: layer.id, parentId, index })),
    writer: { write(draft, mutation) { draft.moves = imageEditLayerMovesSchemaV3.parse(mutation.value) } }, storeActions: [] },
]
