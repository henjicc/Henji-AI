import type { MarkItem } from '@/core/imageEdit/types'

export interface AnnotationStylePatchV3 {
  color?: string
  lineWidth?: number
  fontSize?: number
  calloutShape?: 'rect' | 'ellipse'
  textBackgroundEnabled?: boolean
  textBackgroundColor?: string
  mosaicMode?: 'pixel' | 'blur'
  mosaicStrength?: number
}

export interface AnnotationStyleSnapshotV3 {
  color: string | null
  lineWidth: number | null
  fontSize: number | null
  calloutShape: 'rect' | 'ellipse' | null
  textBackgroundEnabled: boolean | null
  textBackgroundColor: string | null
  mosaicMode: 'pixel' | 'blur' | null
  mosaicStrength: number | null
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

export function annotationHasTextBackgroundV3(annotation: MarkItem): boolean {
  return annotation.type === 'text' || isAnnotationCalloutV3(annotation)
}

export function readAnnotationStyleV3(annotation: MarkItem): AnnotationStyleSnapshotV3 {
  const textBackgroundColor = annotation.type === 'text'
    ? annotation.backgroundColor ?? null
    : isAnnotationCalloutV3(annotation) ? annotation.labelBackgroundColor ?? null : null
  return {
    color: 'stroke' in annotation
      ? annotation.stroke
      : 'color' in annotation ? annotation.color : null,
    lineWidth: 'lineWidth' in annotation ? annotation.lineWidth : null,
    fontSize: 'fontSize' in annotation
      ? annotation.fontSize
      : 'label' in annotation ? annotation.labelFontSize ?? null : null,
    calloutShape: isAnnotationCalloutV3(annotation) ? annotation.type : null,
    textBackgroundEnabled: annotationHasTextBackgroundV3(annotation)
      ? textBackgroundColor !== null
      : null,
    textBackgroundColor,
    mosaicMode: annotation.type === 'mosaic' ? annotation.mode ?? 'pixel' : null,
    mosaicStrength: annotation.type === 'mosaic' ? annotation.strengthPercent ?? null : null,
  }
}

/** 与旧版一致：同一份样式修改既能作为下次绘制的预设，也能直接作用于当前选中标注。 */
export function patchAnnotationStyleV3(
  annotation: MarkItem,
  patch: AnnotationStylePatchV3,
): MarkItem {
  if (annotation.type === 'text') {
    const backgroundColor = patch.textBackgroundEnabled === false
      ? undefined
      : patch.textBackgroundEnabled === true || annotation.backgroundColor
        ? patch.textBackgroundColor ?? annotation.backgroundColor
        : undefined
    return {
      ...annotation,
      color: patch.color ?? annotation.color,
      fontSize: patch.fontSize ?? annotation.fontSize,
      backgroundColor,
    }
  }
  if (annotation.type === 'number') {
    return {
      ...annotation,
      color: patch.color ?? annotation.color,
      fontSize: patch.fontSize ?? annotation.fontSize,
    }
  }
  if (annotation.type === 'mosaic') {
    return {
      ...annotation,
      mode: patch.mosaicMode ?? annotation.mode,
      strengthPercent: patch.mosaicStrength ?? annotation.strengthPercent,
    }
  }

  const labelBackgroundColor = isAnnotationCalloutV3(annotation)
    ? patch.textBackgroundEnabled === false
      ? undefined
      : patch.textBackgroundEnabled === true || annotation.labelBackgroundColor
        ? patch.textBackgroundColor ?? annotation.labelBackgroundColor
        : undefined
    : undefined
  const styled = {
    ...annotation,
    stroke: patch.color ?? annotation.stroke,
    lineWidth: patch.lineWidth ?? annotation.lineWidth,
    ...('label' in annotation && annotation.label !== undefined && patch.fontSize !== undefined
      ? { labelFontSize: patch.fontSize }
      : {}),
    ...(isAnnotationCalloutV3(annotation) ? { labelBackgroundColor } : {}),
  }
  if (patch.calloutShape && isAnnotationCalloutV3(styled)) {
    return { ...styled, type: patch.calloutShape } as MarkItem
  }
  return styled
}
