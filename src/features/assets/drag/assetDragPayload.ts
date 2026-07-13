import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import {
  HENJI_DRAG_DATA_MIME,
  readHenjiDragData,
  writeHenjiDragData,
  type HenjiDragTransferData,
} from '@/contexts/dragDataTransfer'

export const ASSET_DRAG_MIME = HENJI_DRAG_DATA_MIME

export type AssetDragPayload = HenjiDragTransferData & {
  sourceType: 'asset'
  assetId: string
  filePath: string
}

export function assetRecordToDragPayload(asset: AssetRecord): AssetDragPayload {
  return {
    type: asset.mediaType,
    imageUrl: asset.displayUrl,
    filePath: asset.filePath,
    thumbnailUrl: asset.thumbnailUrl,
    aspectRatio: asset.width && asset.height ? `${asset.width}:${asset.height}` : undefined,
    durationSeconds: asset.durationSeconds,
    displayName: asset.displayName,
    sourceType: 'asset',
    assetId: asset.id,
  }
}

export function writeAssetDragPayload(dataTransfer: DataTransfer, payload: AssetDragPayload): void {
  writeHenjiDragData(dataTransfer, payload)
  dataTransfer.effectAllowed = 'copy'
}

export function readAssetDragPayload(dataTransfer: DataTransfer): AssetDragPayload | null {
  const payload = readHenjiDragData(dataTransfer)
  return payload?.sourceType === 'asset' && typeof payload.assetId === 'string' && typeof payload.filePath === 'string'
    ? payload as AssetDragPayload
    : null
}
