import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import type { AssetFileContent, AssetRecord } from '@/platform/contracts/assetLibrary'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import { addMediaReferenceToLibrary } from '@/features/assets/services/assetCollectionService'
import { listVideoEditInstances, type VideoEditInstance } from './videoEditService'
import { sameVideoEditMediaPath } from './videoEditMedia'

const logger = createLogger('features.videoEdit.outputs')
export interface VideoEditOutputReceipt {
  readonly id: string
  readonly owner: VideoEditInstance
  readonly sequenceId: string
  readonly revision: number
  readonly path: string
  readonly name: string
  readonly kind: 'image' | 'video' | 'code'
  readonly frame?: number
  readonly content: Readonly<AssetFileContent>
}
const collections = new WeakSet<VideoEditOutputReceipt>()

/** Called only after the formal encoder/file writer has published a complete file. */
export async function publishVideoEditOutput(input: Omit<VideoEditOutputReceipt, 'id' | 'content'>): Promise<VideoEditOutputReceipt> {
  const platform = getPlatform()
  await platform.media.allowRoot(await platform.system.paths.dirname(input.path))
  const content = await platform.assetLibrary.inspectFileContent(input.path, input.kind)
  return Object.freeze({ ...input, id: crypto.randomUUID(), content: Object.freeze(content) })
}

function sameContent(left: AssetFileContent, right: AssetFileContent): boolean {
  return left.contentIdentity === right.contentIdentity && left.sizeBytes === right.sizeBytes && left.fileModifiedAt === right.fileModifiedAt
}
export async function verifyVideoEditOutput(output: VideoEditOutputReceipt): Promise<void> {
  if (!sameContent(output.content, await getPlatform().assetLibrary.inspectFileContent(output.path, output.kind))) throw new Error('已发布的输出文件已改变，请重新导出或重新选帧。')
}

/** File publication and collection have separate failure/retry boundaries. */
export async function collectVideoEditOutput(output: VideoEditOutputReceipt, options: { libraryId?: string; displayName?: string } = {}, signal?: AbortSignal): Promise<AssetRecord> {
  if (collections.has(output)) throw new Error('此输出正在加入资产库，请等待完成。')
  collections.add(output)
  logger.info('开始收录剪辑输出', { event: 'video_edit.output.collect.start', context: { outputId: output.id, projectId: output.owner.document.id, sequenceId: output.sequenceId } })
  try {
    signal?.throwIfAborted()
    if (!listVideoEditInstances().includes(output.owner)) throw new Error('原剪辑已关闭，请从已导出的文件引用素材。')
    if (options.libraryId) await assetApplicationService.inspectLibrary(options.libraryId)
    await verifyVideoEditOutput(output)
    signal?.throwIfAborted()
    if (!listVideoEditInstances().includes(output.owner)) throw new Error('原剪辑已关闭，输出不会收录到重新打开的剪辑。')
    // Asset creation commits here. Later cancellation never deletes a completed
    // output or a record that another consumer may already have referenced.
    const created = await addMediaReferenceToLibrary({ filePath: output.path, mediaType: output.kind, source: 'video-edit', displayName: options.displayName ?? output.name, ...(options.libraryId ? { libraryIds: [options.libraryId] } : {}) })
    const asset = await assetApplicationService.inspect(created.id)
    if (asset.inspectionStatus !== 'ready' || !sameVideoEditMediaPath(asset.filePath, output.path) || asset.mediaType !== output.kind || !asset.contentIdentity
      || !sameContent(output.content, { contentIdentity: asset.contentIdentity, sizeBytes: asset.sizeBytes!, fileModifiedAt: asset.fileModifiedAt! })) throw new Error('文件已保留，但收录期间输出内容发生变化，请在资产库重新核验。')
    logger.info('剪辑输出收录完成', { event: 'video_edit.output.collect.completed', context: { outputId: output.id, assetId: asset.id } })
    return asset
  } catch (error) {
    logger.warn('剪辑输出未完成收录，已发布文件保留', { event: 'video_edit.output.collect.failed', error, context: { outputId: output.id } }); throw error
  } finally { collections.delete(output) }
}
