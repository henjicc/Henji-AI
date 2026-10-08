import { rasterizeImageEditSessionRegionV3 } from '@/core/imageEdit/v3/selection/sessionRaster'
import type { ImageEditSelectionSessionV3, ImageEditSelectionRegionV3 } from '@/core/imageEdit/v3/selection/session'

export interface SelectionRasterRequestV3 {
  selection: ImageEditSelectionSessionV3
  size: { width: number; height: number }
  region: ImageEditSelectionRegionV3
  matrix?: readonly [number, number, number, number, number, number]
}

export function rasterizeSelectionRequestV3(request: SelectionRasterRequestV3): Float32Array {
  const { selection, size, region, matrix } = request
  if (!matrix || matrix.every((v, i) => v === [1, 0, 0, 1, 0, 0][i])) return rasterizeImageEditSessionRegionV3(selection, size, region)
  const [a, b, c, d, e, f] = matrix
  const map = (x: number, y: number) => [a * x + c * y + e, b * x + d * y + f]
  const output = new Float32Array(region.width * region.height)
  // 变换可能把单个输出瓦片映射到整幅大图；惰性读取最多八个工作瓦片，控制缓存而不限制作品规模。
  const tiles = new Map<string, { width: number; data: Float32Array }>()
  const sample = (sx: number, sy: number) => {
    if (sx < 0 || sy < 0 || sx >= size.width || sy >= size.height) return 0
    const x = Math.floor(sx / 512) * 512, y = Math.floor(sy / 512) * 512, key = `${x}/${y}`
    let tile = tiles.get(key)
    if (!tile) {
      const width = Math.min(512, size.width - x), height = Math.min(512, size.height - y)
      tile = { width, data: rasterizeImageEditSessionRegionV3(selection, size, { x, y, width, height }) }
      if (tiles.size >= 8) tiles.delete(tiles.keys().next().value!)
      tiles.set(key, tile)
    }
    return tile.data[(sy - y) * tile.width + sx - x]
  }
  for (let py = 0; py < region.height; py++) for (let px = 0; px < region.width; px++) {
    const p = map(region.x + px + 0.5, region.y + py + 0.5)
    const sx = p[0] - 0.5, sy = p[1] - 0.5, ix = Math.floor(sx), iy = Math.floor(sy), tx = sx - ix, ty = sy - iy
    output[py * region.width + px] = (sample(ix, iy) * (1 - tx) + sample(ix + 1, iy) * tx) * (1 - ty) + (sample(ix, iy + 1) * (1 - tx) + sample(ix + 1, iy + 1) * tx) * ty
  }
  return output
}

// 不在主线程导入这个模块；请求可通过终止独占 Worker 立即取消。
if (typeof self !== 'undefined' && typeof document === 'undefined') self.onmessage = (event: MessageEvent<SelectionRasterRequestV3>) => {
  try {
    const coverage = rasterizeSelectionRequestV3(event.data)
    self.postMessage({ coverage }, { transfer: [coverage.buffer] })
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
