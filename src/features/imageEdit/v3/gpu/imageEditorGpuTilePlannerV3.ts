import { invertImageEditTransformV3 } from '@/core/imageEdit/v3/execution/affineTransform'
import { resolveImageEditOutputGeometryV3, type ImageEditOutputGeometryV3 } from '@/core/imageEdit/v3/outputGeometry'
import { IMAGE_EDIT_STORAGE_TILE_SIZE, mipSize } from '@/core/imageEdit/v3/tileGeometry'
import type { ImageEditorV3PyramidDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import { planImageEditorViewportTilesV3 } from '../execution/viewportTilePlannerV3'
import type { ImageEditorGpuRasterLayerV3, ImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'

export interface ImageEditorGpuPlannedTileV3 {
  readonly key: ImageEditorGpuSceneTileKeyV3
  readonly coreOriginX: number
  readonly coreOriginY: number
  readonly coreWidth: number
  readonly coreHeight: number
}

export interface ImageEditorGpuPlannedLayerV3 {
  readonly layerId: string
  readonly mip: number
  readonly tiles: readonly ImageEditorGpuPlannedTileV3[]
}

/**
 * 把现有 CPU 视口 tile planner 投影到某一根级栅格层的源坐标。
 * 旋转/斜切使用反变换包围盒，会多请求少量瓦片，但不会漏掉可见像素。
 */
export function planImageEditorGpuRasterTilesV3(
  scene: Pick<ImageEditorGpuRasterSceneV3, 'width' | 'height' | 'color' | 'geometry'>,
  layer: ImageEditorGpuRasterLayerV3,
  layout: ImageEditorViewportLayoutV3,
  previousMip?: number,
): ImageEditorGpuPlannedLayerV3 {
  const inverse = invertImageEditTransformV3(layer.transform)
  const viewport = layout.viewport
  const right = viewport.documentX + viewport.width / viewport.zoom
  const bottom = viewport.documentY + viewport.height / viewport.zoom
  const geometry = resolveImageEditOutputGeometryV3(scene.geometry)
  const points = [
    [viewport.documentX, viewport.documentY], [right, viewport.documentY],
    [viewport.documentX, bottom], [right, bottom],
  ].map(([x, y]) => outputToLayerSource(inverse, geometry, x, y))
  const minX = Math.min(...points.map((point) => point[0]))
  const minY = Math.min(...points.map((point) => point[1]))
  const maxX = Math.max(...points.map((point) => point[0]))
  const maxY = Math.max(...points.map((point) => point[1]))
  const layerScale = Math.max(
    Math.hypot(layer.transform[0], layer.transform[1]),
    Math.hypot(layer.transform[2], layer.transform[3]),
  )
  const sourceZoom = Math.max(Number.EPSILON, viewport.zoom * layerScale)
  const pyramid = createImageEditorGpuPyramidDescriptorV3(scene.width, scene.height)
  const plan = planImageEditorViewportTilesV3({
    resourceRef: layer.resourceRef,
    documentSize: { width: scene.width, height: scene.height },
    sourceSize: { width: scene.width, height: scene.height },
    pyramid,
    viewport: {
      documentX: minX,
      documentY: minY,
      width: Math.max(Number.EPSILON, (maxX - minX) * sourceZoom),
      height: Math.max(Number.EPSILON, (maxY - minY) * sourceZoom),
      zoom: sourceZoom,
      devicePixelRatio: viewport.devicePixelRatio,
      interacting: viewport.interacting,
      velocityX: viewport.velocityX,
      velocityY: viewport.velocityY,
    },
    bitDepth: scene.color.bitDepth === 8 ? 8 : scene.color.bitDepth === 16 ? 16 : 32,
    haloDocumentPixels: 1,
    overscanViewports: viewport.interacting ? 0.25 : 0.125,
    forwardPrefetchViewports: 0.25,
    previousMip,
  })
  const mipDimensions = mipSize({ width: scene.width, height: scene.height }, plan.mip)
  return {
    layerId: layer.layerId,
    mip: plan.mip,
    tiles: plan.tiles.map((tile) => ({
      key: {
        resourceRef: layer.resourceRef,
        mip: tile.mip,
        tileX: tile.tileX,
        tileY: tile.tileY,
        contentVersion: layer.contentVersion,
      },
      coreOriginX: tile.tileX * IMAGE_EDIT_STORAGE_TILE_SIZE,
      coreOriginY: tile.tileY * IMAGE_EDIT_STORAGE_TILE_SIZE,
      coreWidth: Math.min(
        IMAGE_EDIT_STORAGE_TILE_SIZE,
        mipDimensions.width - tile.tileX * IMAGE_EDIT_STORAGE_TILE_SIZE,
      ),
      coreHeight: Math.min(
        IMAGE_EDIT_STORAGE_TILE_SIZE,
        mipDimensions.height - tile.tileY * IMAGE_EDIT_STORAGE_TILE_SIZE,
      ),
    })),
  }
}

function outputToLayerSource(
  inverse: ImageEditorGpuRasterLayerV3['transform'],
  geometry: ImageEditOutputGeometryV3,
  outputX: number,
  outputY: number,
): readonly [number, number] {
  const orientedX = outputX + geometry.cropX
  const orientedY = outputY + geometry.cropY
  let mirroredX = orientedX
  let sourceY = orientedY
  if (geometry.rotate === 90) {
    mirroredX = orientedY
    sourceY = geometry.sourceHeight - orientedX
  } else if (geometry.rotate === 180) {
    mirroredX = geometry.sourceWidth - orientedX
    sourceY = geometry.sourceHeight - orientedY
  } else if (geometry.rotate === 270) {
    mirroredX = geometry.sourceWidth - orientedY
    sourceY = orientedX
  }
  const sourceX = geometry.mirrored ? geometry.sourceWidth - mirroredX : mirroredX
  return transformPoint(inverse, sourceX, sourceY)
}

export function createImageEditorGpuPyramidDescriptorV3(
  width: number,
  height: number,
): ImageEditorV3PyramidDescriptor {
  const source = { width, height }
  const levels: ImageEditorV3PyramidDescriptor['levels'] = []
  for (let mip = 0; mip <= 30; mip += 1) {
    const size = mipSize(source, mip)
    levels.push({
      mip,
      width: size.width,
      height: size.height,
      columns: Math.ceil(size.width / IMAGE_EDIT_STORAGE_TILE_SIZE),
      rows: Math.ceil(size.height / IMAGE_EDIT_STORAGE_TILE_SIZE),
    })
    if (size.width === 1 && size.height === 1) break
  }
  return { tileSize: IMAGE_EDIT_STORAGE_TILE_SIZE, levels }
}

function transformPoint(
  matrix: readonly [number, number, number, number, number, number],
  x: number,
  y: number,
): readonly [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
}
