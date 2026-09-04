import type { ImageEditHistoryResourceReferenceV3 } from '@/core/imageEdit/v3/commandTypes'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
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
 * 持久命令返回的已知字节数只来自受管 brush tile 写入；结合当前文档和历史保留集，
 * 可为尚未重新 load snapshot 的本会话补齐受控 descriptor，同时丢弃已不可达项。
 */
export function reconcileImageEditorV3ResourceDescriptors(
  document: ImageEditDocumentV3,
  current: readonly ImageEditorV3ResourceDescriptor[],
  retainedResources: readonly ImageEditHistoryResourceReferenceV3[],
): ImageEditorV3ResourceDescriptor[] {
  const retainedById = new Map(retainedResources.map((resource) => [resource.resourceId, resource]))
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
    // 历史保留集只由受管 brush tile 写入产生；重开会话时它比载入器给出的
    // 通用媒体探测结果更权威，必须原子恢复 brush 类别，不能保留 null/image/*。
    descriptors.set(resource.resourceId, {
      resourceRef: resource.resourceId as ImageEditorV3ResourceRef,
      byteLength: resource.byteSize,
      mediaType: IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE,
    })
  }
  return [...descriptors.values()]
}
