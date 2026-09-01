import type { MarkItem } from '@/core/imageEdit/types'

export interface AnnotationStylePatchV3 {
  color?: string
  lineWidth?: number
  fontSize?: number
  calloutShape?: 'rect' | 'ellipse'
}

export interface AnnotationStyleSnapshotV3 {
  color: string | null
  lineWidth: number | null
  fontSize: number | null
  calloutShape: 'rect' | 'ellipse' | null
}

export function annotationHasStrokeV3(annotation: MarkItem): boolean {
  return 'stroke' in annotation
}

export function annotationHasFontSizeV3(annotation: MarkItem): boolean {
  return 'fontSize' in annotation || ('label' in annotation && annotation.label !== undefined)
}

export function isAnnotationCalloutV3(
  annotation: MarkItem,
): annotation is Extract<MarkItem, { type: 'rect' | 'ellipse' }> {
  return (annotation.type === 'rect' || annotation.type === 'ellipse') && 'label' in annotation
}

export function readAnnotationStyleV3(annotation: MarkItem): AnnotationStyleSnapshotV3 {
  return {
    color: 'stroke' in annotation
      ? annotation.stroke
      : 'color' in annotation ? annotation.color : null,
    lineWidth: 'lineWidth' in annotation ? annotation.lineWidth : null,
    fontSize: 'fontSize' in annotation
      ? annotation.fontSize
      : 'label' in annotation ? annotation.labelFontSize ?? null : null,
    calloutShape: isAnnotationCalloutV3(annotation) ? annotation.type : null,
  }
}

/** 与旧版一致：同一份样式修改既能作为下次绘制的预设，也能直接作用于当前选中标注。 */
export function patchAnnotationStyleV3(
  annotation: MarkItem,
  patch: AnnotationStylePatchV3,
): MarkItem {
  if (annotation.type === 'text') {
    return {
      ...annotation,
      color: patch.color ?? annotation.color,
      fontSize: patch.fontSize ?? annotation.fontSize,
    }
  }
  if (annotation.type === 'number') {
    return {
      ...annotation,
      color: patch.color ?? annotation.color,
      fontSize: patch.fontSize ?? annotation.fontSize,
    }
  }
  if (annotation.type === 'mosaic') return annotation

  const styled = {
    ...annotation,
    stroke: patch.color ?? annotation.stroke,
    lineWidth: patch.lineWidth ?? annotation.lineWidth,
    ...('label' in annotation && annotation.label !== undefined && patch.fontSize !== undefined
      ? { labelFontSize: patch.fontSize }
      : {}),
  }
  if (patch.calloutShape && isAnnotationCalloutV3(styled)) {
    return { ...styled, type: patch.calloutShape } as MarkItem
  }
  return styled
}
