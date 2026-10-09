import { ImageEditCommandValidationErrorV3 } from './commandErrors'
import type { ImageEditLayerCommonPatchV3 } from './commandTypes'
import { IMAGE_EDIT_BLEND_MODES_V3 } from './layerTypes'
import { isImageEditTransformInvertibleV3 } from './execution/affineTransform'
import { imageEditMaskAttachmentSchemaV3, imageEditLayerFiltersSchemaV3 } from './layerModel/semantics'

export function normalizeImageEditLayerCommonPatchV3(
  patch: ImageEditLayerCommonPatchV3,
): ImageEditLayerCommonPatchV3 {
  const allowedKeys = new Set(['name', 'visible', 'locked', 'opacity', 'fillOpacity', 'clipping', 'maskAttachment', 'filters', 'blendMode', 'transform'])
  const keys = Object.keys(patch)
  if (keys.length === 0 || keys.some((key) => !allowedKeys.has(key))) {
    throw new ImageEditCommandValidationErrorV3('图层公共属性补丁为空或包含未知字段')
  }
  if (patch.name !== undefined && typeof patch.name !== 'string') {
    throw new ImageEditCommandValidationErrorV3('图层名称无效')
  }
  if (patch.visible !== undefined && typeof patch.visible !== 'boolean') {
    throw new ImageEditCommandValidationErrorV3('图层显隐值无效')
  }
  if (patch.locked !== undefined && typeof patch.locked !== 'boolean') {
    throw new ImageEditCommandValidationErrorV3('图层锁定值无效')
  }
  if (patch.opacity !== undefined && (!Number.isFinite(patch.opacity) || patch.opacity < 0 || patch.opacity > 1)) {
    throw new ImageEditCommandValidationErrorV3('图层不透明度必须在 0～1 之间')
  }
  if (patch.fillOpacity !== undefined && (!Number.isFinite(patch.fillOpacity) || patch.fillOpacity < 0 || patch.fillOpacity > 1)) {
    throw new ImageEditCommandValidationErrorV3('图层填充必须在 0～1 之间')
  }
  if (patch.clipping !== undefined && typeof patch.clipping !== 'boolean') {
    throw new ImageEditCommandValidationErrorV3('剪贴属性必须是布尔值')
  }
  const attachment = patch.maskAttachment === undefined ? undefined : imageEditMaskAttachmentSchemaV3.safeParse(patch.maskAttachment)
  const filters = patch.filters === undefined ? undefined : imageEditLayerFiltersSchemaV3.safeParse(patch.filters)
  if (attachment && !attachment.success) throw new ImageEditCommandValidationErrorV3('蒙版附件无效')
  if (filters && !filters.success) throw new ImageEditCommandValidationErrorV3('图层滤镜列表无效')
  if (patch.blendMode !== undefined && !IMAGE_EDIT_BLEND_MODES_V3.includes(patch.blendMode)) {
    throw new ImageEditCommandValidationErrorV3('图层混合模式无效')
  }
  if (patch.transform !== undefined && !isImageEditTransformInvertibleV3(patch.transform)) {
    throw new ImageEditCommandValidationErrorV3('图层变换必须是可逆的有限仿射矩阵')
  }
  return {
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.visible === undefined ? {} : { visible: patch.visible }),
    ...(patch.locked === undefined ? {} : { locked: patch.locked }),
    ...(patch.opacity === undefined ? {} : { opacity: patch.opacity }),
    ...(patch.fillOpacity === undefined ? {} : { fillOpacity: patch.fillOpacity }),
    ...(patch.clipping === undefined ? {} : { clipping: patch.clipping }),
    ...(attachment?.success ? { maskAttachment: attachment.data } : {}),
    ...(filters?.success ? { filters: filters.data } : {}),
    ...(patch.blendMode === undefined ? {} : { blendMode: patch.blendMode }),
    ...(patch.transform === undefined ? {} : { transform: [...patch.transform] }),
  }
}
