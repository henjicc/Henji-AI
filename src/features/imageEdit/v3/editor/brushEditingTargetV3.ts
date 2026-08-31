import type {
  ImageEditBrushTargetV3,
  ImageEditBrushTileLoaderV3,
  ImageEditBrushToolV3,
} from '@/core/imageEdit/v3/brush/contracts'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { AnnotationMatrixV3 } from './annotationGeometryV3'
import { resolveImageEditorMaskBrushLayerV3 } from './maskBrushLayerV3'
import {
  createImageEditorMaskBrushTargetV3,
  createImageEditorMaskBrushTileLoaderV3,
} from './maskBrushTilesV3'
import { resolveImageEditorRasterBrushLayerV3 } from './rasterBrushLayerV3'
import {
  createImageEditorRasterBrushTargetV3,
  createImageEditorRasterBrushTileLoaderV3,
} from './rasterBrushTilesV3'

export type ImageEditorBrushToolIdV3 = 'raster-brush' | 'eraser' | 'mask-edit'

export interface ImageEditorBrushEditingTargetV3 {
  layerId: string
  cacheId: string
  matrix: AnnotationMatrixV3
  inverseMatrix: AnnotationMatrixV3
  tileResources: Readonly<Record<string, string>>
  destination: { kind: 'raster' } | { kind: 'mask'; maskId: string }
  tool: ImageEditBrushToolV3
  target: ImageEditBrushTargetV3
  loadTile: ImageEditBrushTileLoaderV3
}

export type ImageEditorBrushEditingTargetResolutionV3 =
  | { ready: true; target: ImageEditorBrushEditingTargetV3 }
  | { ready: false; reason: string }

export function resolveImageEditorBrushEditingTargetV3(input: {
  document: ImageEditDocumentV3
  selectedLayerIds: readonly string[]
  activeTool: ImageEditorBrushToolIdV3
  maskMode: 'paint' | 'erase'
  resourceByteSizes: ReadonlyMap<string, number>
}): ImageEditorBrushEditingTargetResolutionV3 {
  if (input.activeTool === 'mask-edit') {
    const resolved = resolveImageEditorMaskBrushLayerV3(input.document, input.selectedLayerIds)
    if (!resolved.ready) return resolved
    const { layer, matrix, inverseMatrix } = resolved.target
    return {
      ready: true,
      target: {
        layerId: layer.id,
        cacheId: `${layer.id}:mask:${layer.mask.maskId}`,
        matrix,
        inverseMatrix,
        tileResources: layer.mask.tiles,
        destination: { kind: 'mask', maskId: layer.mask.maskId },
        tool: input.maskMode === 'erase' ? 'eraser' : 'brush',
        target: createImageEditorMaskBrushTargetV3(),
        loadTile: createImageEditorMaskBrushTileLoaderV3({
          document: input.document,
          mask: layer.mask,
          resourceByteSizes: input.resourceByteSizes,
        }),
      },
    }
  }
  const resolved = resolveImageEditorRasterBrushLayerV3(input.document, input.selectedLayerIds)
  if (!resolved.ready) return resolved
  const { layer, matrix, inverseMatrix } = resolved.target
  return {
    ready: true,
    target: {
      layerId: layer.id,
      cacheId: layer.id,
      matrix,
      inverseMatrix,
      tileResources: layer.tiles,
      destination: { kind: 'raster' },
      tool: input.activeTool === 'eraser' ? 'eraser' : 'brush',
      target: createImageEditorRasterBrushTargetV3(input.document),
      loadTile: createImageEditorRasterBrushTileLoaderV3({
        document: input.document,
        layer,
        resourceByteSizes: input.resourceByteSizes,
      }),
    },
  }
}
