import { createHash } from 'node:crypto'
import type { PrivacyBox } from '../../../../../src/core/screenRecording/privacy'
import type { PixelCrop } from './recognition'

export interface CursorSample { monoUs: number; point: [number, number] | null }
const TILE = 64
/** Compare complete pixels, not sparse probes (a single changed glyph must not disappear between probes). */
export function changedTiles(previous: Uint8Array | undefined, rgb: Uint8Array, width: number, height: number, cursors: readonly (readonly [number, number])[] = [], options: { noiseTolerance?: number; cursorScale?: number } = {}): PrivacyBox[] {
  if (!previous) return [[0, 0, 1, 1]]
  // Native comparisons skip equal rows without visiting 8.3 million pixels in JS on every 4K frame.
  // They preserve exact equality: no sampling or color threshold can hide a changed glyph.
  const before = Buffer.from(previous.buffer, previous.byteOffset, previous.byteLength)
  const current = Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength)
  if (before.equals(current)) return []
  const dirtyRows = new Uint8Array(height), stride = width * 3
  for (let y = 0; y < height; y++) {
    const start = y * stride, end = start + stride
    dirtyRows[y] = Number(before.compare(current, start, end, start, end) !== 0)
  }
  const changed: PrivacyBox[] = []
  const tolerance = options.noiseTolerance ?? 0, scale = options.cursorScale ?? 1
  for (let top = 0; top < height; top += TILE) for (let left = 0; left < width; left += TILE) {
    const right = Math.min(width, left + TILE), bottom = Math.min(height, top + TILE)
    let dirty = false
    for (let y = top; y < bottom && !dirty; y++) {
      if (!dirtyRows[y]) continue
      for (let x = left; x < right; x++) {
        const i = (y * width + x) * 3
        if (rgb[i] === previous[i] && rgb[i + 1] === previous[i + 1] && rgb[i + 2] === previous[i + 2]) continue
        if (tolerance && Math.abs(rgb[i] - previous[i]) <= tolerance && Math.abs(rgb[i + 1] - previous[i + 1]) <= tolerance && Math.abs(rgb[i + 2] - previous[i + 2]) <= tolerance) continue
        // The capture log is in encoded pixels. Mask only the cursor footprint, never its entire tile.
        if (cursors.some(p => x >= p[0] - 8 * scale && x < p[0] + 48 * scale && y >= p[1] - 8 * scale && y < p[1] + 48 * scale)) continue
        dirty = true; break
      }
    }
    if (dirty) changed.push([left / width, top / height, (right - left) / width, (bottom - top) / height])
  }
  return changed
}
export function intersects(a: PrivacyBox, b: PrivacyBox): boolean {
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1]
}
/** Job-local, bounded cache keys include dimensions but not position, allowing identical crops after scrolling. */
export function cropHash(rgb: Uint8Array, width: number, crop: PixelCrop): string {
  const hash = createHash('sha256').update(`${crop.width}x${crop.height}:`)
  for (let y = crop.y; y < crop.y + crop.height; y++) {
    const start = (y * width + crop.x) * 3
    hash.update(rgb.subarray(start, start + crop.width * 3))
  }
  return hash.digest('hex')
}
