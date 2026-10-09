import type { CpuRegionWorkerOutputV3 } from './cpuRegionWorkerProtocol'
import type { ImageEditRect } from '../tileGeometry'
import { resolveImageEditOutputSourceRectV3 } from '../outputGeometry'
import type { ImageEditCpuOutputTileV3 } from './cpuOutputTile'

/** 在同一个调度原子单元里并行求值，输出/源坐标仍由正式几何入口决定。 */
export function splitImageEditCpuOutputV3(output: CpuRegionWorkerOutputV3, concurrency: 1 | 2 | 4) {
  const { rect } = output
  const columns = concurrency > 1 && rect.width >= 32 ? 2 : 1
  const rows = concurrency === 4 && rect.height >= 32 ? 2 : 1
  const parts: Array<{ region: ImageEditRect; output: CpuRegionWorkerOutputV3 }> = []
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const left = Math.floor(rect.width * x / columns)
    const top = Math.floor(rect.height * y / rows)
    const part = { x: rect.x + left, y: rect.y + top,
      width: Math.floor(rect.width * (x + 1) / columns) - left,
      height: Math.floor(rect.height * (y + 1) / rows) - top }
    parts.push({ region: resolveImageEditOutputSourceRectV3(part, output.geometry), output: { ...output, rect: part } })
  }
  return parts
}

export function assembleImageEditCpuOutputV3(parts: readonly ImageEditCpuOutputTileV3[], rect: ImageEditRect,
  bytesPerPixel: number): ImageEditCpuOutputTileV3 {
  if (parts.length === 1) return parts[0]
  const rowStride = rect.width * bytesPerPixel
  const pixels = new Uint8Array(rowStride * rect.height)
  for (const part of parts) {
    for (let y = 0; y < part.height; y++) {
      const offset = ((part.y - rect.y + y) * rect.width + part.x - rect.x) * bytesPerPixel
      pixels.set(part.pixels.subarray(y * part.rowStride, (y + 1) * part.rowStride), offset)
    }
  }
  return { ...rect, rowStride, pixels }
}
