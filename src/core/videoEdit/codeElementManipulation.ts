import type { CodeElementBounds } from './codeMaterial/geometry'
import { codeLocalBounds, codeMultiply, codePoint, codeTransform } from './codeMaterial/geometry'
import { codeElementCorrection, codeElementParentMatrix, codeInverseMatrix, type CodeElementOverrideValues } from './codeElementOverrides'
import { videoEditClipToFrame, type VideoEditClipPlacement, type VideoEditSize } from './clipGeometry'

export interface CodeEditPoint { x: number; y: number }
export function codeElementOrientedPolygon(element: CodeElementBounds, placement: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize): CodeEditPoint[] {
  if (element.author) return element.author.corners.map(([x, y]) => videoEditClipToFrame(placement, picture, frame, x / picture.width, y / picture.height))
  const box = codeLocalBounds(element.command)
  return [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]].map(([x, y]) => { const at = codePoint(element.matrix, x, y); return videoEditClipToFrame(placement, picture, frame, at[0] / picture.width, at[1] / picture.height) })
}
export function codeElementMoveDelta(element: CodeElementBounds, from: CodeEditPoint, to: CodeEditPoint): CodeEditPoint {
  if (element.author) return { x: to.x - from.x, y: to.y - from.y }
  const inverse = codeInverseMatrix(codeElementParentMatrix(element))
  return { x: inverse[0] * (to.x - from.x) + inverse[2] * (to.y - from.y), y: inverse[1] * (to.x - from.x) + inverse[3] * (to.y - from.y) }
}
export function resizeCodeElement(element: CodeElementBounds, values: CodeElementOverrideValues, corner: number, point: CodeEditPoint, uniform: boolean): CodeElementOverrideValues {
  const box = element.author ? { x: element.author.bounds[0], y: element.author.bounds[1], width: element.author.bounds[2] - element.author.bounds[0], height: element.author.bounds[3] - element.author.bounds[1] } : codeLocalBounds(element.command); const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]]
  const opposite = corners[(corner + 2) % 4]; const moving = corners[corner]; const at = codePoint(codeInverseMatrix(element.matrix), point.x, point.y)
  const vx = moving[0] - opposite[0]; const vy = moving[1] - opposite[1]
  const ratio = Math.max(.001, ((at[0] - opposite[0]) * vx + (at[1] - opposite[1]) * vy) / Math.max(1e-12, vx * vx + vy * vy))
  const rx = uniform ? ratio : Math.max(.001, (at[0] - opposite[0]) / (vx || 1)); const ry = uniform ? ratio : Math.max(.001, (at[1] - opposite[1]) / (vy || 1))
  const next = { ...values, scaleX: Math.min(1024, (values.scaleX ?? 1) * rx), scaleY: Math.min(1024, (values.scaleY ?? 1) * ry) }
  if (element.author) {
    const dx = (opposite[0] - box.x - box.width / 2) * (1 - next.scaleX / (values.scaleX ?? 1))
    const dy = (opposite[1] - box.y - box.height / 2) * (1 - next.scaleY / (values.scaleY ?? 1))
    return { scaleX: next.scaleX, scaleY: next.scaleY, dx: (values.dx ?? 0) + element.matrix[0] * dx + element.matrix[2] * dy, dy: (values.dy ?? 0) + element.matrix[1] * dx + element.matrix[3] * dy }
  }
  const command = { ...element.command, elementTransform: undefined }
  const before = codePoint(codeMultiply(codeElementCorrection(command, values), codeTransform(command)), opposite[0], opposite[1])
  const after = codePoint(codeMultiply(codeElementCorrection(command, next), codeTransform(command)), opposite[0], opposite[1])
  return { scaleX: next.scaleX, scaleY: next.scaleY, dx: (values.dx ?? 0) + before[0] - after[0], dy: (values.dy ?? 0) + before[1] - after[1] }
}
export function rotateCodeElement(element: CodeElementBounds, values: CodeElementOverrideValues, from: CodeEditPoint, to: CodeEditPoint, snap: boolean): number {
  if (element.author) {
    const inverse = codeInverseMatrix(element.author.baseMatrix ?? element.matrix)
    const bounds = element.author.bounds
    const center = codePoint(element.matrix, (bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2)
    const vector = (point: CodeEditPoint): number => Math.atan2(inverse[1] * (point.x - center[0]) + inverse[3] * (point.y - center[1]), inverse[0] * (point.x - center[0]) + inverse[2] * (point.y - center[1]))
    let delta = (vector(to) - vector(from)) * 180 / Math.PI
    if (delta > 180) delta -= 360; if (delta < -180) delta += 360
    const rotation = (values.rotation ?? 0) + delta
    return snap ? Math.round(rotation / 15) * 15 : rotation
  }
  const base = codeTransform({ ...element.command, elementTransform: undefined })
  const inverse = codeInverseMatrix(codeMultiply(codeElementParentMatrix(element), base)); const box = codeLocalBounds(element.command)
  const x = element.command.authorAnchor ? (element.command.anchorX ?? 0) + (element.command.kind !== 'group' && 'x' in element.command ? element.command.x : 0) : box.x + box.width / 2
  const y = element.command.authorAnchor ? (element.command.anchorY ?? 0) + (element.command.kind !== 'group' && 'y' in element.command ? element.command.y : 0) : box.y + box.height / 2
  const center = codePoint(codeMultiply(inverse, element.matrix), x, y)
  const a = codePoint(inverse, from.x, from.y); const b = codePoint(inverse, to.x, to.y)
  let delta = (Math.atan2(b[1] - center[1], b[0] - center[0]) - Math.atan2(a[1] - center[1], a[0] - center[0])) * 180 / Math.PI
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
