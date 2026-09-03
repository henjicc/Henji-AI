import type { MarkItem } from '../types'

import { parseImageEditDocumentV3, stringifyImageEditDocumentV3 } from './documentCodec'
import type { ImageEditDocumentV3 } from './documentTypes'
import type {
  ImageEditAnnotationLayerV3,
  ImageEditGroupLayerV3,
  ImageEditLayerV3,
} from './layerTypes'

export type ImageEditExportTargetV3 =
  | { kind: 'raster-layer'; layerId: string }
  | { kind: 'layer-group'; layerId: string }
  | { kind: 'annotation-element'; layerId: string; annotationId: string }

export type ImageEditExportTargetContentStateV3 = 'rendered' | 'hidden' | 'empty'

export interface ImageEditExportTargetViewV3 {
  document: ImageEditDocumentV3
  displayName: string
  layerPath: readonly string[]
  targetId: string
  contentState: ImageEditExportTargetContentStateV3
}

export type ImageEditExportTargetErrorCodeV3 =
  | 'TARGET_NOT_FOUND'
  | 'TARGET_TYPE_MISMATCH'
  | 'UNSUPPORTED_EXPORT_TARGET'

export class ImageEditExportTargetErrorV3 extends Error {
  override readonly name = 'ImageEditExportTargetErrorV3'

  constructor(
    readonly code: ImageEditExportTargetErrorCodeV3,
    message: string,
  ) {
    super(message)
  }
}

interface LayerLocation {
  layer: ImageEditLayerV3
  ancestors: ImageEditGroupLayerV3[]
}

function findLayer(
  layers: readonly ImageEditLayerV3[],
  layerId: string,
  ancestors: ImageEditGroupLayerV3[] = [],
): LayerLocation | null {
  for (const layer of layers) {
    if (layer.id === layerId) return { layer, ancestors }
    if (layer.type === 'group') {
      const nested = findLayer(layer.children, layerId, [...ancestors, layer])
      if (nested) return nested
    }
  }
  return null
}

function annotationDisplayName(layer: ImageEditAnnotationLayerV3, item: MarkItem): string {
  if (item.type === 'text' && item.text.trim()) return item.text.trim().slice(0, 80)
  if ('label' in item && typeof item.label === 'string' && item.label.trim()) {
    return item.label.trim().slice(0, 80)
  }
  return `${layer.name}·${item.type}`
}

function hasRenderableContent(layer: ImageEditLayerV3): boolean {
  if (!layer.visible) return false
  if (layer.type === 'raster') {
    return layer.source.kind === 'resource' || Object.keys(layer.tiles).length > 0
  }
  if (layer.type === 'annotation') return layer.annotations.length > 0
  if (layer.type === 'group') return layer.children.some(hasRenderableContent)
  return false
}

function wrapAncestors(
  leaf: ImageEditLayerV3,
  ancestors: readonly ImageEditGroupLayerV3[],
): ImageEditLayerV3 {
  return [...ancestors].reverse().reduce<ImageEditLayerV3>((child, ancestor) => ({
    ...ancestor,
    children: [child],
  }), leaf)
}

function immutableDocumentView(
  source: ImageEditDocumentV3,
  root: ImageEditLayerV3,
): ImageEditDocumentV3 {
  return parseImageEditDocumentV3(stringifyImageEditDocumentV3({
    ...source,
    layers: [root],
  }))
}

function targetLayerOrThrow(
  document: ImageEditDocumentV3,
  layerId: string,
): LayerLocation {
  const location = findLayer(document.layers, layerId)
  if (!location) {
    throw new ImageEditExportTargetErrorV3(
      'TARGET_NOT_FOUND',
      `找不到待导出图层：${layerId}`,
    )
  }
  return location
}

function contentState(
  layer: ImageEditLayerV3,
  ancestors: readonly ImageEditGroupLayerV3[],
): ImageEditExportTargetContentStateV3 {
  if (!layer.visible || ancestors.some((ancestor) => !ancestor.visible)) return 'hidden'
  return hasRenderableContent(layer) ? 'rendered' : 'empty'
}

/**
 * 从权威文档构造只包含目标及必要祖先组的不可变派生视图。
 * 画布几何与 revision 保持原值，无关兄弟不进入 RenderPlan。
 */
export function createImageEditExportTargetViewV3(
  input: ImageEditDocumentV3,
  target: ImageEditExportTargetV3,
): ImageEditExportTargetViewV3 {
  const document = parseImageEditDocumentV3(stringifyImageEditDocumentV3(input))
  const location = targetLayerOrThrow(document, target.layerId)
  const path = [...location.ancestors.map((ancestor) => ancestor.id), location.layer.id]

  if (target.kind === 'raster-layer') {
    if (location.layer.type === 'effect' || location.layer.type === 'adjustment') {
      throw new ImageEditExportTargetErrorV3(
        'UNSUPPORTED_EXPORT_TARGET',
        location.layer.type === 'effect'
          ? '效果层依赖下方图层上下文，暂不支持单独导出'
          : '调整层依赖下方图层上下文，暂不支持单独导出',
      )
    }
    if (location.layer.type !== 'raster') {
      throw new ImageEditExportTargetErrorV3('TARGET_TYPE_MISMATCH', '导出目标不是栅格图层')
    }
    const root = wrapAncestors(location.layer, location.ancestors)
    return {
      document: immutableDocumentView(document, root),
      displayName: location.layer.name,
      layerPath: path,
      targetId: location.layer.id,
      contentState: contentState(location.layer, location.ancestors),
    }
  }

  if (target.kind === 'layer-group') {
    if (location.layer.type !== 'group') {
      throw new ImageEditExportTargetErrorV3('TARGET_TYPE_MISMATCH', '导出目标不是图层组')
    }
    const root = wrapAncestors(location.layer, location.ancestors)
    return {
      document: immutableDocumentView(document, root),
      displayName: location.layer.name,
      layerPath: path,
      targetId: location.layer.id,
      contentState: contentState(location.layer, location.ancestors),
    }
  }

  if (location.layer.type !== 'annotation') {
    throw new ImageEditExportTargetErrorV3('TARGET_TYPE_MISMATCH', '标注元素不属于标注图层')
  }
  const annotation = location.layer.annotations.find((item) => item.id === target.annotationId)
  if (!annotation) {
    throw new ImageEditExportTargetErrorV3(
      'TARGET_NOT_FOUND',
      `找不到待导出标注：${target.annotationId}`,
    )
  }
  const targetLayer: ImageEditAnnotationLayerV3 = {
    ...location.layer,
    annotations: [annotation],
  }
  const root = wrapAncestors(targetLayer, location.ancestors)
  return {
    document: immutableDocumentView(document, root),
    displayName: annotationDisplayName(location.layer, annotation),
    layerPath: path,
    targetId: annotation.id,
    contentState: contentState(targetLayer, location.ancestors),
  }
}
