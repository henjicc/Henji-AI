export interface CaptureRect { x: number; y: number; width: number; height: number }
/** Desktop DIP bounds and encoded pixel size are explicit; mixed-DPI displays never share a global scale. */
export interface CaptureGeometry { bounds: CaptureRect; pixels: { width: number; height: number } }
export function capturePoint(point: { x: number; y: number }, source: CaptureGeometry): [number, number] | null {
  const { bounds: b, pixels: p } = source
  if (![point.x, point.y, b.x, b.y, b.width, b.height, p.width, p.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0 || p.width <= 0 || p.height <= 0) throw new Error('采集坐标范围无效')
  if (point.x < b.x || point.y < b.y || point.x >= b.x + b.width || point.y >= b.y + b.height) return null
  return [(point.x - b.x) * p.width / b.width, (point.y - b.y) * p.height / b.height]
}
export function captureBounds(rect: CaptureRect, source: CaptureGeometry): CaptureRect | null {
  const b = source.bounds
  const x = Math.max(rect.x, b.x); const y = Math.max(rect.y, b.y)
  const width = Math.min(rect.x + rect.width, b.x + b.width) - x
  const height = Math.min(rect.y + rect.height, b.y + b.height) - y
  if (width <= 0 || height <= 0) return null
  return { x: (x - b.x) * source.pixels.width / b.width, y: (y - b.y) * source.pixels.height / b.height, width: width * source.pixels.width / b.width, height: height * source.pixels.height / b.height }
}
