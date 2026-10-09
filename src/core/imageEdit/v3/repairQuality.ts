import type { ImageEditRepairBitmapV3 } from './repair'

export interface ImageEditRepairStructureV3 { periodic: boolean; horizontal: number; vertical: number }
/** 已知背景上取亮度边缘投影与周期自相关。64 个采样格是分析预算，不限制原图尺寸。Worker 执行。 */
export function analyzeImageEditRepairStructureV3(bitmap: ImageEditRepairBitmapV3): ImageEditRepairStructureV3 {
  const w = Math.min(64, bitmap.region.width), h = Math.min(64, bitmap.region.height)
  const row = new Float64Array(h), column = new Float64Array(w), rc = new Uint32Array(h), cc = new Uint32Array(w)
  const at = (x: number, y: number): number => {
    const p = Math.min(bitmap.region.height - 1, Math.floor((y + 0.5) * bitmap.region.height / h)) * bitmap.region.width + Math.min(bitmap.region.width - 1, Math.floor((x + 0.5) * bitmap.region.width / w))
    return bitmap.mask[p] || bitmap.rgba[p * 4 + 3] < 128 ? NaN : bitmap.rgba[p * 4] * 0.2126 + bitmap.rgba[p * 4 + 1] * 0.7152 + bitmap.rgba[p * 4 + 2] * 0.0722
  }
  for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
    const value = at(x, y), previousX = at(x - 1, y), previousY = at(x, y - 1)
    if (Number.isFinite(value) && Number.isFinite(previousY)) { row[y] += Math.abs(value - previousY); rc[y]++ }
    if (Number.isFinite(value) && Number.isFinite(previousX)) { column[x] += Math.abs(value - previousX); cc[x]++ }
  }
  const periodicity = (values: Float64Array, counts: Uint32Array): number => {
    let mean = 0, known = 0
    for (let i = 0; i < values.length; i++) if (counts[i]) { values[i] /= counts[i]; mean += values[i]; known++ }
    if (known < 16 || mean / known < 6) return 0
    mean /= known; let best = 0
    for (let lag = 3; lag <= Math.floor(values.length / 3); lag++) {
      let dot = 0, a = 0, b = 0, pairs = 0
      for (let i = lag; i < values.length; i++) if (counts[i] && counts[i - lag]) { const x = values[i] - mean, y = values[i - lag] - mean; dot += x * y; a += x * x; b += y * y; pairs++ }
      if (pairs >= 12 && a > 1 && b > 1) best = Math.max(best, dot / Math.sqrt(a * b))
    }
    return best
  }
  const horizontal = periodicity(row, rc), vertical = periodicity(column, cc)
  return { periodic: Math.max(horizontal, vertical) >= 0.6, horizontal, vertical }
}

export function routeImageEditRepairQualityV3(requested: 'auto' | 'fast' | 'fine', roi: { width: number; height: number }, selectedAreaRatio: number, structure?: ImageEditRepairStructureV3): 'fast' | 'fine' | 'blemish' {
  if (requested === 'fine') return 'fine'
  if (roi.width <= 32 && roi.height <= 32) return 'blemish'
  return requested === 'auto' && (selectedAreaRatio >= 0.08 || structure?.periodic) ? 'fine' : 'fast'
}
/** 遮罩越宽，越需完整干净上下文；不把大洞盲切成没有背景的独立小块。 */
export function imageEditRepairContextV3(roi: { left: number; top: number; width: number; height: number }, size: { width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const padding = Math.max(64, Math.ceil(Math.max(roi.width, roi.height) * 0.5))
  const x = Math.max(0, roi.left - padding), y = Math.max(0, roi.top - padding)
  return { x, y, width: Math.min(size.width, roi.left + roi.width + padding) - x, height: Math.min(size.height, roi.top + roi.height + padding) - y }
}
