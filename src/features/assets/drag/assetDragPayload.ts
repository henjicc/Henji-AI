import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import {
  HENJI_DRAG_DATA_MIME,
  readHenjiDragData,
  writeHenjiDragData,
  type HenjiDragTransferData,
} from '@/contexts/dragDataTransfer'

export const ASSET_DRAG_MIME = HENJI_DRAG_DATA_MIME
export const CODE_ASSET_DRAG_MIME = 'application/x-henji-code-asset'

export function writeCodeAssetDrag(dataTransfer: DataTransfer, assetId: string): void {
  dataTransfer.setData(CODE_ASSET_DRAG_MIME, JSON.stringify({ assetId })); dataTransfer.effectAllowed = 'copy'
}
export function readCodeAssetDrag(dataTransfer: DataTransfer): string | null {
  const raw = dataTransfer.getData(CODE_ASSET_DRAG_MIME)
  if (!raw) return null
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || !('assetId' in value) || typeof value.assetId !== 'string' || !value.assetId || value.assetId.length > 100 || Object.keys(value).length !== 1) throw new Error('代码资产拖入引用无效。')
  return value.assetId
}

export type AssetDragPayload = HenjiDragTransferData & {
  sourceType: 'asset'
  assetId: string
  filePath: string
}

export function assetRecordToDragPayload(asset: AssetRecord): AssetDragPayload {
  if (asset.mediaType === 'code') throw new Error('代码资产须使用可编辑代码引用，不能作为图片拖入。')
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
