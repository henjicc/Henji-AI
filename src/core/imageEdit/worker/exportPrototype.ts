export const IMAGE_EDIT_PREVIEW_MAX_PIXELS = 2_000_000
export const IMAGE_EDIT_EXPORT_TILE_SIZE = 1536
export const IMAGE_EDIT_EXPORT_HALO = 64
export const IMAGE_EDIT_GLOBAL_SCATTER_MAX_DIMENSION = 2048

export interface ImageEditExportTile {
  index: number
  x: number
  y: number
  width: number
  height: number
  expandedX: number
  expandedY: number
  expandedWidth: number
  expandedHeight: number
  cropX: number
  cropY: number
}

export interface ImageEditExportPlan {
  width: number
  height: number
  tileSize: number
  halo: number
  totalTiles: number
  globalScatterWidth: number
  globalScatterHeight: number
  tiles: ImageEditExportTile[]
}

export function fitWithinPixelBudget(
  width: number,
  height: number,
  maxPixels = IMAGE_EDIT_PREVIEW_MAX_PIXELS
): { width: number; height: number } {
  assertPositiveInteger(width, 'width')
  assertPositiveInteger(height, 'height')
  assertPositiveInteger(maxPixels, 'maxPixels')
  const pixelCount = width * height
  if (pixelCount <= maxPixels) return { width, height }
  const scale = Math.sqrt(maxPixels / pixelCount)
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }
}

export function createImageEditExportPlan(
  width: number,
  height: number,
  options: {
    tileSize?: number
    halo?: number
    globalScatterMaxDimension?: number
  } = {}
): ImageEditExportPlan {
  assertPositiveInteger(width, 'width')
  assertPositiveInteger(height, 'height')
  const tileSize = options.tileSize ?? IMAGE_EDIT_EXPORT_TILE_SIZE
  const halo = options.halo ?? IMAGE_EDIT_EXPORT_HALO
  const globalScatterMaxDimension =
    options.globalScatterMaxDimension ?? IMAGE_EDIT_GLOBAL_SCATTER_MAX_DIMENSION
  assertPositiveInteger(tileSize, 'tileSize')
  assertNonNegativeInteger(halo, 'halo')
  assertPositiveInteger(globalScatterMaxDimension, 'globalScatterMaxDimension')

  const columns = Math.ceil(width / tileSize)
  const rows = Math.ceil(height / tileSize)
  const tiles: ImageEditExportTile[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * tileSize
      const y = row * tileSize
      const tileWidth = Math.min(tileSize, width - x)
      const tileHeight = Math.min(tileSize, height - y)
      const expandedX = Math.max(0, x - halo)
      const expandedY = Math.max(0, y - halo)
      const expandedRight = Math.min(width, x + tileWidth + halo)
      const expandedBottom = Math.min(height, y + tileHeight + halo)
      tiles.push({
        index: tiles.length,
        x,
        y,
        width: tileWidth,
        height: tileHeight,
        expandedX,
        expandedY,
        expandedWidth: expandedRight - expandedX,
        expandedHeight: expandedBottom - expandedY,
        cropX: x - expandedX,
        cropY: y - expandedY,
      })
    }
  }

  const scatterScale = Math.min(
    1,
    globalScatterMaxDimension / Math.max(width, height)
  )
  return {
    width,
    height,
    tileSize,
    halo,
    totalTiles: tiles.length,
    globalScatterWidth: Math.max(1, Math.round(width * scatterScale)),
    globalScatterHeight: Math.max(1, Math.round(height * scatterScale)),
    tiles,
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`)
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数`)
  }
}
