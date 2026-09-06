import type { Float32PremultipliedRgbaTile } from '../effects/contracts'
import type { ImageEditRect } from '../tileGeometry'
import type { ImageEditSize } from '../tileGeometry'

export interface RasterReplacementV3 {
  readonly base: Float32PremultipliedRgbaTile
  readonly region: ImageEditRect
  readonly scaleX: number
  readonly scaleY: number
  readonly data: Float32Array
  readonly coverage: Float32Array
  readonly rectangles: ImageEditRect[]
  readonly bounds?: ImageEditSize
}

/** 当前输出像素中心在 mip0 中的四点双线性足迹；不对单个存储瓦片 clamp。 */
export function imageEditRasterSamplePointsV3(x: number, y: number, scaleX: number, scaleY = scaleX,
  bounds?: ImageEditSize): Array<{ x: number; y: number; weight: number }> {
  const rawX = (x + 0.5) * scaleX - 0.5, rawY = (y + 0.5) * scaleY - 0.5
  const sx = bounds ? Math.max(0, Math.min(bounds.width - 1, rawX)) : rawX
  const sy = bounds ? Math.max(0, Math.min(bounds.height - 1, rawY)) : rawY
  const left = Math.floor(sx), top = Math.floor(sy)
  const tx = sx - left, ty = sy - top
  return [
    { x: left, y: top, weight: (1 - tx) * (1 - ty) },
    { x: left + 1, y: top, weight: tx * (1 - ty) },
    { x: left, y: top + 1, weight: (1 - tx) * ty },
    { x: left + 1, y: top + 1, weight: tx * ty },
  ].filter((point) => point.weight > 0)
}

export function imageEditRasterRectContainsV3(rect: ImageEditRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
}

/** 仅跨 sparse/source 边界的足迹需要 mip0 底图；普通低 mip 路径不新增读回。 */
export function imageEditRasterBoundaryBasePointsV3(region: ImageEditRect, mip: number, source: ImageEditSize,
  overrides: readonly ImageEditRect[]): Array<{ x: number; y: number }> {
  if (mip < 10 || overrides.length === 0) return []
  const result = new Map<string, { x: number; y: number }>()
  const bounds = { width: Math.max(source.width, ...overrides.map((rect) => rect.x + rect.width)),
    height: Math.max(source.height, ...overrides.map((rect) => rect.y + rect.height)) }
  for (let y = region.y; y < region.y + region.height; y++) for (let x = region.x; x < region.x + region.width; x++) {
    const points = imageEditRasterSamplePointsV3(x, y, 2 ** mip, 2 ** mip, bounds)
    const covered = (point: { x: number; y: number }): boolean => overrides.some((rect) => imageEditRasterRectContainsV3(rect, point.x, point.y))
    if (!points.some(covered)) continue
    for (const point of points) {
      if (!covered(point) && point.x >= 0 && point.y >= 0 && point.x < source.width && point.y < source.height) {
        result.set(`${point.x}:${point.y}`, point)
      }
    }
  }
  return [...result.values()]
}

export function createImageEditRasterReplacementV3(base: Float32PremultipliedRgbaTile, region: ImageEditRect,
  scaleX: number, scaleY = scaleX, bounds?: ImageEditSize): RasterReplacementV3 {
  return { base, region, scaleX, scaleY, data: new Float32Array(base.data.length),
    coverage: new Float32Array(base.width * base.height), rectangles: [], bounds }
}

/** 每一存储块贡献其拥有的采样点；透明像素同样覆盖，不是 source-over。 */
export function addImageEditRasterReplacementV3(state: RasterReplacementV3, tile: Float32PremultipliedRgbaTile,
  originX: number, originY: number, signal?: AbortSignal): void {
  const rect = { x: originX, y: originY, width: tile.width, height: tile.height }
  state.rectangles.push(rect)
  const left = Math.max(state.region.x, Math.floor(originX / state.scaleX))
  const top = Math.max(state.region.y, Math.floor(originY / state.scaleY))
  const right = Math.min(state.region.x + state.region.width, Math.ceil((originX + tile.width) / state.scaleX))
  const bottom = Math.min(state.region.y + state.region.height, Math.ceil((originY + tile.height) / state.scaleY))
  for (let y = top; y < bottom; y++) {
    signal?.throwIfAborted()
    if (state.scaleX === 1 && state.scaleY === 1) {
      const pixel = (y - state.region.y) * state.region.width + left - state.region.x
      const offset = ((y - originY) * tile.width + left - originX) * 4
      state.data.set(tile.data.subarray(offset, offset + (right - left) * 4), pixel * 4)
      state.coverage.fill(1, pixel, pixel + right - left)
      continue
    }
    for (let x = left; x < right; x++) {
      const pixel = (y - state.region.y) * state.region.width + x - state.region.x
      for (const point of imageEditRasterSamplePointsV3(x, y, state.scaleX, state.scaleY, state.bounds)) {
        if (!imageEditRasterRectContainsV3(rect, point.x, point.y)) continue
        const offset = ((point.y - originY) * tile.width + point.x - originX) * 4
        state.coverage[pixel] += point.weight
        for (let c = 0; c < 4; c++) state.data[pixel * 4 + c] += tile.data[offset + c] * point.weight
      }
    }
  }
}

export function missingImageEditRasterBaseSamplesV3(state: RasterReplacementV3): Array<{ x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>()
  for (let pixel = 0; pixel < state.coverage.length; pixel++) {
    if (state.coverage[pixel] === 0 || state.coverage[pixel] === 1) continue
    const x = state.region.x + pixel % state.region.width
    const y = state.region.y + Math.floor(pixel / state.region.width)
    for (const point of imageEditRasterSamplePointsV3(x, y, state.scaleX, state.scaleY, state.bounds)) {
      if (!state.rectangles.some((rect) => imageEditRasterRectContainsV3(rect, point.x, point.y))) {
        result.set(`${point.x}:${point.y}`, point)
      }
    }
  }
  return [...result.values()]
}

export function finishImageEditRasterReplacementV3(state: RasterReplacementV3,
  sampleBase: (x: number, y: number, channel: number) => number): Float32Array {
  for (let pixel = 0; pixel < state.coverage.length; pixel++) {
    const weight = state.coverage[pixel]
    if (weight === 0) {
      for (let c = 0; c < 4; c++) state.data[pixel * 4 + c] = state.base.data[pixel * 4 + c]
    } else if (weight !== 1) {
      const x = state.region.x + pixel % state.region.width
      const y = state.region.y + Math.floor(pixel / state.region.width)
      for (const point of imageEditRasterSamplePointsV3(x, y, state.scaleX, state.scaleY, state.bounds)) {
        if (state.rectangles.some((rect) => imageEditRasterRectContainsV3(rect, point.x, point.y))) continue
        for (let c = 0; c < 4; c++) state.data[pixel * 4 + c] += sampleBase(point.x, point.y, c) * point.weight
      }
    }
  }
  return state.data
}
