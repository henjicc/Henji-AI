import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'

/** Paths in drag payloads are hints. Only the formal asset service owns them. */
export async function resolveVideoEditAssetReference(assetId: string): Promise<AssetRecord> {
  const asset = await assetApplicationService.inspect(assetId)
  if (asset.id !== assetId || asset.inspectionStatus !== 'ready') throw new Error('此素材库素材尚不可用，请先恢复源文件后重新引用。')
  if (!['image', 'video', 'audio'].includes(asset.mediaType)) throw new Error('此资产不能作为音视频源文件引用。')
  if (!asset.filePath || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes! < 0 || asset.fileModifiedAt === null || !Number.isFinite(asset.fileModifiedAt) || asset.fileModifiedAt < 0) throw new Error('素材库文件信息不完整，请先重新检查素材。')
  if (!asset.contentIdentity || !/^[a-f0-9]{64}$/.test(asset.contentIdentity)) throw new Error('素材库文件尚未完成内容检查，请重新检查素材。')
  return structuredClone(asset)
}

/** Renaming, tags and last-used time do not change the referenced file. */
export function sameVideoEditAssetContent(left: AssetRecord, right: AssetRecord): boolean {
  return left.id === right.id && left.filePath === right.filePath && left.mediaType === right.mediaType && left.sizeBytes === right.sizeBytes && left.fileModifiedAt === right.fileModifiedAt && left.contentIdentity === right.contentIdentity
}

export function videoEditAssetContentSnapshot(asset: AssetRecord): { sizeBytes: number; fileModifiedAt: number; contentIdentity: string } {
  if (asset.sizeBytes === null || asset.fileModifiedAt === null || !asset.contentIdentity) throw new Error('素材库文件缺少已检查的内容信息。')
  return { sizeBytes: asset.sizeBytes, fileModifiedAt: asset.fileModifiedAt, contentIdentity: asset.contentIdentity }
}
