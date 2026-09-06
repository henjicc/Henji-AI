import type { ImageEditHistoryResourceReferenceV3 } from '@/core/imageEdit/v3/commandTypes'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { collectImageEditResourceRolesV3 } from '@/core/imageEdit/v3/resourceRoles'
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences'
import type {
  ImageEditorV3ResourceDescriptor,
  ImageEditorV3ResourceRef,
} from '@/platform/contracts/imageEditorV3'

export const IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE = 'application/x-henji-brush-tile-v3'

export function createImageEditorV3ResourceByteSizes(
  descriptors: readonly ImageEditorV3ResourceDescriptor[],
): Readonly<Record<string, number>> {
  return Object.fromEntries(descriptors.map((descriptor) => [
    descriptor.resourceRef,
    descriptor.byteLength,
  ]))
}

/**
 * 持久历史保留集同时包含源图和 brush tile；只有文档权威结构标记为稀疏瓦片的资源
 * 才能补为 brush descriptor，不得用媒体格式或“出现在历史”猜测读取类别。
 */
export function reconcileImageEditorV3ResourceDescriptors(
  document: ImageEditDocumentV3,
  current: readonly ImageEditorV3ResourceDescriptor[],
  retainedResources: readonly ImageEditHistoryResourceReferenceV3[],
): ImageEditorV3ResourceDescriptor[] {
  const retainedById = new Map(retainedResources.map((resource) => [resource.resourceId, resource]))
  const currentBrushResources = collectImageEditResourceRolesV3(document).sparse
  const reachableIds = new Set([
    ...collectImageEditJsonResourceIdsV3(document),
    ...retainedById.keys(),
  ])
  const descriptors = new Map<string, ImageEditorV3ResourceDescriptor>()
  for (const descriptor of current) {
    if (reachableIds.has(descriptor.resourceRef)) descriptors.set(descriptor.resourceRef, descriptor)
  }
  for (const resource of retainedResources) {
    if (resource.byteSize === null) continue
    const existing = descriptors.get(resource.resourceId)
    if (!currentBrushResources.has(resource.resourceId)
      && existing?.mediaType !== IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE) continue
    descriptors.set(resource.resourceId, {
      resourceRef: resource.resourceId as ImageEditorV3ResourceRef,
      byteLength: resource.byteSize,
      mediaType: IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE,
    })
  }
  return [...descriptors.values()]
}
