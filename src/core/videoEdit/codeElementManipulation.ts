import type { CodeElementBounds } from './codeMaterial/geometry'
import { codePoint } from './codeMaterial/geometry'
import { codeInverseMatrix, type CodeElementOverrideValues } from './codeElementOverrides'
import { videoEditClipToFrame, type VideoEditClipPlacement, type VideoEditSize } from './clipGeometry'

export interface CodeEditPoint { x: number; y: number }
export function codeElementOrientedPolygon(element: CodeElementBounds, placement: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize): CodeEditPoint[] {
  return element.author.corners.map(([x, y]) => videoEditClipToFrame(placement, picture, frame, x / picture.width, y / picture.height))
}
export function codeElementMoveDelta(_element: CodeElementBounds, from: CodeEditPoint, to: CodeEditPoint): CodeEditPoint {
  return { x: to.x - from.x, y: to.y - from.y }
}
export function resizeCodeElement(element: CodeElementBounds, values: CodeElementOverrideValues, corner: number, point: CodeEditPoint, uniform: boolean): CodeElementOverrideValues {
  const bounds = element.author.bounds
  const box = { x: bounds[0], y: bounds[1], width: bounds[2] - bounds[0], height: bounds[3] - bounds[1] }
  const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]]
  const opposite = corners[(corner + 2) % 4]; const moving = corners[corner]; const at = codePoint(codeInverseMatrix(element.matrix), point.x, point.y)
  const vx = moving[0] - opposite[0]; const vy = moving[1] - opposite[1]
  const ratio = Math.max(.001, ((at[0] - opposite[0]) * vx + (at[1] - opposite[1]) * vy) / Math.max(1e-12, vx * vx + vy * vy))
  const rx = uniform ? ratio : Math.max(.001, (at[0] - opposite[0]) / (vx || 1)); const ry = uniform ? ratio : Math.max(.001, (at[1] - opposite[1]) / (vy || 1))
  const scaleX = Math.min(1024, (values.scaleX ?? 1) * rx), scaleY = Math.min(1024, (values.scaleY ?? 1) * ry)
  const dx = (opposite[0] - box.x - box.width / 2) * (1 - scaleX / (values.scaleX ?? 1))
  const dy = (opposite[1] - box.y - box.height / 2) * (1 - scaleY / (values.scaleY ?? 1))
  return { scaleX, scaleY, dx: (values.dx ?? 0) + element.matrix[0] * dx + element.matrix[2] * dy, dy: (values.dy ?? 0) + element.matrix[1] * dx + element.matrix[3] * dy }
}
export function rotateCodeElement(element: CodeElementBounds, values: CodeElementOverrideValues, from: CodeEditPoint, to: CodeEditPoint, snap: boolean): number {
  const inverse = codeInverseMatrix(element.author.baseMatrix ?? element.matrix)
  const bounds = element.author.bounds
  const center = codePoint(element.matrix, (bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2)
  const vector = (point: CodeEditPoint): number => Math.atan2(inverse[1] * (point.x - center[0]) + inverse[3] * (point.y - center[1]), inverse[0] * (point.x - center[0]) + inverse[2] * (point.y - center[1]))
  let delta = (vector(to) - vector(from)) * 180 / Math.PI
  if (delta > 180) delta -= 360; if (delta < -180) delta += 360
  const rotation = (values.rotation ?? 0) + delta
  return snap ? Math.round(rotation / 15) * 15 : rotation
}
export function snapCodeElementMove(polygon: readonly CodeEditPoint[], delta: CodeEditPoint, targets: { x: number[]; y: number[] }, threshold: CodeEditPoint): { delta: CodeEditPoint; guides: { x?: number; y?: number } } {
  const axis = (values: number[], travel: number, guides: number[], threshold: number): { offset: number; guide?: number } => {
    const min = Math.min(...values); const max = Math.max(...values); const anchors = [min, (min + max) / 2, max]
    let best = threshold; let offset = 0; let guide: number | undefined
    for (const target of guides) for (const anchor of anchors) { const distance = target - anchor - travel; if (Math.abs(distance) <= best) { best = Math.abs(distance); offset = distance; guide = target } }
    return { offset, guide }
  }
  const x = axis(polygon.map(point => point.x), delta.x, targets.x, threshold.x); const y = axis(polygon.map(point => point.y), delta.y, targets.y, threshold.y)
  return { delta: { x: delta.x + x.offset, y: delta.y + y.offset }, guides: { x: x.guide, y: y.guide } }
}
