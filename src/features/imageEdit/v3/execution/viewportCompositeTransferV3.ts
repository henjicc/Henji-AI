import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorPreviewBrushResourceRequestV3 } from './previewDocumentV3'
import type { ImageEditorViewportFrameV3 } from './viewportTileSchedulerV3'

export function imageEditorViewportSourceTransferBytesV3(
  frame: ImageEditorViewportFrameV3,
): number {
  let bytes = 0
  for (const tiles of frame.resourceTiles.values()) {
    for (const tile of tiles) bytes += tile.pixels.byteLength
  }
  if (!Number.isSafeInteger(bytes)) throw new Error('视口源瓦片传输字节数超出安全范围')
  return bytes
}

export function imageEditorViewportBrushTransferBytesV3(
  requests: readonly ImageEditorPreviewBrushResourceRequestV3[],
): number {
  const bytes = requests.reduce(
    (total, request) => total + request.width * request.height
      * (request.storage === 'rgba-float32' ? 4 : 1)
      * Float32Array.BYTES_PER_ELEMENT,
    0,
  )
  if (!Number.isSafeInteger(bytes)) throw new Error('视口画笔瓦片传输字节数超出安全范围')
  return bytes
}

export function cloneImageEditorViewportSourceTilesV3(
  frame: ImageEditorViewportFrameV3,
): ImageEditorV3SourceTile[] {
  const output: ImageEditorV3SourceTile[] = []
  for (const tiles of frame.resourceTiles.values()) {
    for (const tile of tiles) output.push({ ...tile, pixels: tile.pixels.slice(0) })
  }
  return output
}
