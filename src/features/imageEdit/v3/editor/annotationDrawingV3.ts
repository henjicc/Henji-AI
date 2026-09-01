import type { MarkItem } from '@/core/imageEdit/types'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'

import type { ImageEditorToolIdV3 } from '../application/imageEditorHostProfiles'

export type AnnotationToolV3 = Extract<
  ImageEditorToolIdV3,
  | 'annotation-text'
  | 'annotation-callout'
  | 'annotation-arrow'
  | 'annotation-rect'
  | 'annotation-ellipse'
  | 'annotation-number'
  | 'annotation-pen'
>

export function isAnnotationToolV3(tool: ImageEditorToolIdV3): tool is AnnotationToolV3 {
  return tool === 'annotation-text'
    || tool === 'annotation-callout'
    || tool === 'annotation-arrow'
    || tool === 'annotation-rect'
    || tool === 'annotation-ellipse'
    || tool === 'annotation-number'
    || tool === 'annotation-pen'
}

export function createAnnotationDraftV3(
  tool: AnnotationToolV3,
  point: readonly [number, number],
  strokeWidth: number,
  fontSize: number,
  text: string,
  calloutText: string,
  color: string,
  calloutShape: 'rect' | 'ellipse',
): MarkItem {
  const id = createImageEditIdV3('annotation')
  if (tool === 'annotation-text') {
    return { id, type: 'text', x: point[0], y: point[1], text, color, fontSize }
  }
  if (tool === 'annotation-number') {
    return { id, type: 'number', x: point[0], y: point[1], color, fontSize }
  }
  if (tool === 'annotation-arrow') {
    return {
      id,
      type: 'arrow',
      points: [point[0], point[1], point[0], point[1]],
      stroke: color,
      lineWidth: strokeWidth,
    }
  }
  if (tool === 'annotation-rect' || tool === 'annotation-callout') {
    const shape = tool === 'annotation-callout' ? calloutShape : 'rect'
    return {
      id,
      type: shape,
      x: point[0],
      y: point[1],
      width: 0,
      height: 0,
      stroke: color,
      lineWidth: strokeWidth,
      ...(tool === 'annotation-callout' ? { label: calloutText, labelFontSize: fontSize } : {}),
    }
  }
  if (tool === 'annotation-ellipse') {
    return {
      id,
      type: 'ellipse',
      x: point[0],
      y: point[1],
      width: 0,
      height: 0,
      stroke: color,
      lineWidth: strokeWidth,
    }
  }
  return {
    id,
    type: 'pen',
    points: [point[0], point[1], point[0], point[1]],
    stroke: color,
    lineWidth: strokeWidth,
  }
}

export function updateAnnotationDrawV3(
  annotation: MarkItem,
  start: readonly [number, number],
  point: readonly [number, number],
  shiftKey = false,
): MarkItem {
  if (annotation.type === 'arrow') {
    const dx = point[0] - start[0]
    const dy = point[1] - start[1]
    const length = Math.hypot(dx, dy)
    const angle = shiftKey
      ? Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4
      : Math.atan2(dy, dx)
    const end = shiftKey
      ? [start[0] + Math.cos(angle) * length, start[1] + Math.sin(angle) * length] as const
      : point
    return { ...annotation, points: [start[0], start[1], end[0], end[1]] }
  }
  if (annotation.type === 'rect' || annotation.type === 'ellipse') {
    const dx = point[0] - start[0]
    const dy = point[1] - start[1]
    const size = Math.max(Math.abs(dx), Math.abs(dy))
    const end = shiftKey
      ? [start[0] + Math.sign(dx || 1) * size, start[1] + Math.sign(dy || 1) * size] as const
      : point
    return {
      ...annotation,
      x: Math.min(start[0], end[0]),
      y: Math.min(start[1], end[1]),
      width: Math.abs(end[0] - start[0]),
      height: Math.abs(end[1] - start[1]),
    }
  }
  if (annotation.type === 'pen') {
    annotation.points.push(point[0], point[1])
    return { ...annotation }
  }
  return annotation
}

export function isDrawableAnnotationV3(annotation: MarkItem): boolean {
  if (annotation.type === 'rect' || annotation.type === 'ellipse') {
    return annotation.width >= 1 && annotation.height >= 1
  }
  if (annotation.type === 'arrow') {
    return Math.hypot(
      annotation.points[2] - annotation.points[0],
      annotation.points[3] - annotation.points[1],
    ) >= 1
  }
  if (annotation.type !== 'pen' || annotation.points.length < 4) return annotation.type !== 'pen'
  const startX = annotation.points[0]
  const startY = annotation.points[1]
  return annotation.points.some((value, index) => (
    index >= 2 && index % 2 === 0
      ? Math.hypot(value - startX, annotation.points[index + 1] - startY) >= 1
      : false
  ))
}
