import type { ImageEditDocumentV3 } from '../../../../src/core/imageEdit/v3/documentTypes'
import type { ImageEditCommandHistorySnapshotV3 } from '../../../../src/core/imageEdit/v3/commandHistoryCodec'
import { collectImageEditJsonResourceIdsV3 } from '../../../../src/core/imageEdit/v3/resourceReferences'
import { collectImageEditResourceRolesV3 } from '../../../../src/core/imageEdit/v3/resourceRoles'
import type { ImageEditorV3ResourceDescriptor } from '../../../../src/platform/contracts/imageEditorV3'
import type { ResourceDescriptor, ResourceId } from './contracts'
import type { ImageEditBrushTileStoreV3 } from './brush-tile-store'
import { IMAGE_EDIT_BRUSH_TILE_MEDIA_TYPE_V3 } from './brush-tile-codec'
import { collectPersistedImageEditHistoryResourcesV3 } from './history-persistence'

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort!: () => void
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason ?? new DOMException('Image editor snapshot cancelled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([operation, cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}

export async function describeImageEditorV3SnapshotResources(
  resourceRefs: readonly ResourceId[],
  describeResource: (resourceId: ResourceId) => Promise<ResourceDescriptor>,
  signal: AbortSignal,
): Promise<ImageEditorV3ResourceDescriptor[]> {
  if (new Set(resourceRefs).size !== resourceRefs.length) throw new Error('Image editor snapshot contains duplicate resource references')
  const results = new Array<ImageEditorV3ResourceDescriptor>(resourceRefs.length)
  let cursor = 0
  let stopped = false
  const worker = async (): Promise<void> => {
    while (!stopped && cursor < resourceRefs.length) {
      signal.throwIfAborted()
      const index = cursor++
      const resourceRef = resourceRefs[index]
      try {
        const descriptor = await abortable(describeResource(resourceRef), signal)
        if (descriptor.id !== resourceRef || descriptor.sha256 !== resourceRef.slice('sha256:'.length)
          || !Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 0
          || (descriptor.mediaType !== undefined && typeof descriptor.mediaType !== 'string')) {
          throw new Error(`Image editor resource descriptor does not match snapshot reference: ${resourceRef}`)
        }
        results[index] = { resourceRef: descriptor.id, byteLength: descriptor.byteLength, mediaType: descriptor.mediaType ?? null }
      } catch (error) { stopped = true; throw error }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, resourceRefs.length) }, worker))
  signal.throwIfAborted()
  return results
}

/** 每次打开验证受管原件；MIME 不靠临时 putBuffer 返回值，也不为未知资源猜格式。 */
export async function describeImageEditorV3DocumentResources(
  document: ImageEditDocumentV3,
  history: ImageEditCommandHistorySnapshotV3 | undefined,
  resourceRefs: readonly ResourceId[],
  describeResource: (resourceId: ResourceId) => Promise<ResourceDescriptor>,
  brushTiles: Pick<ImageEditBrushTileStoreV3, 'readTile'>,
  signal: AbortSignal,
): Promise<ImageEditorV3ResourceDescriptor[]> {
  const declared = new Set<string>(resourceRefs)
  const roles = collectImageEditResourceRolesV3(document, history)
  const referenced = collectImageEditJsonResourceIdsV3(document, [
    ...collectPersistedImageEditHistoryResourcesV3(history).map((entry) => entry.resourceId),
    ...roles.images, ...roles.sparse.keys(),
  ])
  for (const ref of referenced) {
    if (!declared.has(ref)) throw new Error('图片编辑文档或历史引用未登记在资源清单')
  }
  const descriptors = await describeImageEditorV3SnapshotResources(resourceRefs, describeResource, signal)
  // 稀疏瓦片验证复用有租约、哈希/codec校验及取消的正式读取；串行限制临时解码峰值为一瓦片。
  for (const descriptor of descriptors) {
    const storage = roles.sparse.get(descriptor.resourceRef)
    if (!storage) continue
    signal.throwIfAborted()
    const tile = await brushTiles.readTile({ resourceId: descriptor.resourceRef, byteSize: descriptor.byteLength }, signal)
    signal.throwIfAborted()
    if (tile.storage !== storage) throw new Error('图片编辑稀疏资源存储类型与文档或历史不匹配')
    descriptor.mediaType = IMAGE_EDIT_BRUSH_TILE_MEDIA_TYPE_V3
  }
  return descriptors
}
