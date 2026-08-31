import type { MarkItem } from '@/core/imageEdit/types'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type {
  ImageEditAnnotationLayerV3,
  ImageEditLayerV3,
  ImageEditTransformV3,
} from '@/core/imageEdit/v3/layerTypes'
import type { AnnotationMatrixV3 } from './annotationGeometryV3'
import { resolveAnnotationLayerToOutputMatrixV3 } from './annotationGeometryV3'

export interface EditableAnnotationLayerV3 {
  layer: ImageEditAnnotationLayerV3
  matrix: AnnotationMatrixV3
  locked: boolean
}

export interface AnnotationSelectionV3 {
  layerId: string
  annotationId: string
}

export function collectEditableAnnotationLayersV3(
  document: ImageEditDocumentV3,
): EditableAnnotationLayerV3[] {
  const output: EditableAnnotationLayerV3[] = []
  const visit = (
    layers: readonly ImageEditLayerV3[],
    transforms: readonly ImageEditTransformV3[],
    ancestorVisible: boolean,
    ancestorLocked: boolean,
  ): void => {
    for (const layer of layers) {
      const visible = ancestorVisible && layer.visible
      const locked = ancestorLocked || layer.locked
      const nextTransforms = [layer.transform, ...transforms]
      if (layer.type === 'annotation' && visible) {
        output.push({
          layer,
          matrix: resolveAnnotationLayerToOutputMatrixV3(document, nextTransforms),
          locked,
        })
      } else if (layer.type === 'group' && visible) {
        visit(layer.children, nextTransforms, visible, locked)
      }
    }
  }
  visit(document.layers, [], true, false)
  return output
}

export function findSelectedAnnotationV3(
  layers: readonly EditableAnnotationLayerV3[],
  selection: AnnotationSelectionV3 | null,
): { entry: EditableAnnotationLayerV3; annotation: MarkItem } | null {
  if (!selection) return null
  const entry = layers.find(({ layer }) => layer.id === selection.layerId)
  const annotation = entry?.layer.annotations.find(({ id }) => id === selection.annotationId)
  return entry && annotation ? { entry, annotation } : null
}

export function moveAnnotationV3(
  annotation: MarkItem,
  deltaX: number,
  deltaY: number,
): MarkItem {
  if (annotation.type === 'arrow') {
    const [x1, y1, x2, y2] = annotation.points
    return {
      ...annotation,
      points: [x1 + deltaX, y1 + deltaY, x2 + deltaX, y2 + deltaY],
      curveControl: annotation.curveControl
        ? [annotation.curveControl[0] + deltaX, annotation.curveControl[1] + deltaY]
        : undefined,
    }
  }
  if (annotation.type === 'pen') {
    return {
      ...annotation,
      points: annotation.points.map((value, index) => value + (index % 2 === 0 ? deltaX : deltaY)),
    }
  }
  return { ...annotation, x: annotation.x + deltaX, y: annotation.y + deltaY }
}

export interface AnnotationBoundsV3 {
  x: number
  y: number
  width: number
  height: number
}

export function getAnnotationBoundsV3(annotation: MarkItem): AnnotationBoundsV3 {
  if (annotation.type === 'rect' || annotation.type === 'ellipse' || annotation.type === 'mosaic') {
    return {
      x: Math.min(annotation.x, annotation.x + annotation.width),
      y: Math.min(annotation.y, annotation.y + annotation.height),
      width: Math.abs(annotation.width),
      height: Math.abs(annotation.height),
    }
  }
  if (annotation.type === 'arrow') {
    const xs = [annotation.points[0], annotation.points[2]]
    const ys = [annotation.points[1], annotation.points[3]]
    if (annotation.curveControl) {
      xs.push(annotation.curveControl[0])
      ys.push(annotation.curveControl[1])
    }
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  }
  if (annotation.type === 'pen') {
    const xs = annotation.points.filter((_, index) => index % 2 === 0)
    const ys = annotation.points.filter((_, index) => index % 2 === 1)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  }
  const size = annotation.fontSize
  const width = annotation.type === 'text'
    ? Math.max(size, annotation.text.length * size * 0.62)
    : size
  return { x: annotation.x, y: annotation.y - size, width, height: size * 1.25 }
}

function pointSegmentDistance(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1])
  const projection = Math.max(0, Math.min(1, (
    (point[0] - start[0]) * dx + (point[1] - start[1]) * dy
  ) / (dx * dx + dy * dy)))
  return Math.hypot(
    point[0] - (start[0] + projection * dx),
    point[1] - (start[1] + projection * dy),
  )
}

/** 笔画结束时才执行简化；进行中由调用方维护可变点缓冲，不逐点复制历史数组。 */
export function simplifyAnnotationPenPointsV3(
  points: readonly number[],
  tolerance: number,
): number[] {
  const pairs: Array<readonly [number, number]> = []
  for (let index = 0; index + 1 < points.length; index += 2) {
    pairs.push([points[index], points[index + 1]])
  }
  if (pairs.length <= 2) return [...points]
  const keep = new Set([0, pairs.length - 1])
  const pending: Array<readonly [number, number]> = [[0, pairs.length - 1]]
  while (pending.length > 0) {
    const [startIndex, endIndex] = pending.pop() as readonly [number, number]
    let farthestIndex = -1
    let farthestDistance = tolerance
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = pointSegmentDistance(pairs[index], pairs[startIndex], pairs[endIndex])
      if (distance > farthestDistance) {
        farthestDistance = distance
        farthestIndex = index
      }
    }
    if (farthestIndex >= 0) {
      keep.add(farthestIndex)
      pending.push([startIndex, farthestIndex], [farthestIndex, endIndex])
    }
  }
  return [...keep]
    .sort((left, right) => left - right)
    .flatMap((index) => [pairs[index][0], pairs[index][1]])
}
