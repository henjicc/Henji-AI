import type { AudioEditRepair } from './regions'

/** Rasterized off the main thread. Rows run from low to high frequency. */
export function rasterAudioRepairMask(strokes: NonNullable<AudioEditRepair['strokes']>, width: number, height: number): Uint8Array {
  if (!Number.isSafeInteger(width * height) || width < 1 || height < 1 || width * height > 16 * 1024 * 1024) throw new Error('修复画笔范围过大，请缩小选区')
  const result = new Uint8Array(width * height)
  for (const stroke of strokes) {
    for (let p = 0; p < stroke.points.length; p++) {
      // Ellipse brush: scale y so the radii become equal, then measure distance to the segment.
      const a = stroke.points[Math.max(0, p - 1)], b = stroke.points[p], r = stroke.radius, ry = stroke.radiusY ?? r, k = r / ry
      const dx = b.x - a.x, dy = (b.y - a.y) * k, length = dx * dx + dy * dy
      const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r) * width)), x1 = Math.min(width - 1, Math.ceil((Math.max(a.x, b.x) + r) * width))
      const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - ry) * height)), y1 = Math.min(height - 1, Math.ceil((Math.max(a.y, b.y) + ry) * height))
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const u = (x + .5) / width, v = ((y + .5) / height - a.y) * k
        const t = length ? Math.max(0, Math.min(1, ((u - a.x) * dx + v * dy) / length)) : 0
        if ((u - a.x - t * dx) ** 2 + (v - t * dy) ** 2 <= r * r) result[y * width + x] = 255
      }
    }
  }
  return result
}
