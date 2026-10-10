import { prepareDeformation, inverseDeformationBounds, mapAffine, inverseAffine, type Deformation } from '@/core/imaging/transforms';
import { invertImageEditTransformV3 } from '@/core/imageEdit/v3/execution/affineTransform'
import { imageEditRasterOverrideRectV3, resolveImageEditRasterSourceExtentV3, resolveImageEditRasterStorageSizeV3 } from '@/core/imageEdit/v3/execution/rasterSourceGeometry'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import { resolveImageEditOutputGeometryV3, type ImageEditOutputGeometryV3 } from '@/core/imageEdit/v3/outputGeometry'
import { IMAGE_EDIT_STORAGE_TILE_SIZE, mipSize } from '@/core/imageEdit/v3/tileGeometry'
import type { ImageEditorV3PyramidDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import { planImageEditorViewportTilesV3 } from '../execution/viewportTilePlannerV3'
import type {
  ImageEditorGpuGraphMaskV3,
  ImageEditorGpuRasterLayerV3,
  ImageEditorGpuRasterSceneV3,
} from './imageEditorGpuRasterSceneCompilerV3'
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'

export interface ImageEditorGpuPlannedTileV3 {
  readonly key: ImageEditorGpuSceneTileKeyV3
  readonly coreOriginX: number
  readonly coreOriginY: number
  readonly coreWidth: number
  readonly coreHeight: number
}

/** 稀疏蒙版与画笔共用 viewport planner，只请求当前视口相交的 mip0 脏瓦片。 */
export function planImageEditorGpuMaskTilesV3(
  scene: Pick<ImageEditorGpuRasterSceneV3, 'width' | 'height' | 'color' | 'geometry'>,
  mask: ImageEditorGpuGraphMaskV3,
  transform: ImageEditTransformV3,
  layout: ImageEditorViewportLayoutV3,
  deformation?: Deformation | null,
  local?: ImageEditTransformV3,
): ImageEditorGpuPlannedLayerV3 {
  if (Object.keys(mask.sparseTiles).length === 0) {
    return {
      layerId: mask.maskId, mip: 0,
      tiles: [],
    }
  }
  const planned = planImageEditorGpuRasterTilesV3(scene, {
    layerId: mask.maskId, sourceKind: 'raster', resourceRef: null,
    contentVersion: `mask:${mask.maskId}`, sparseTiles: mask.sparseTiles,
    visible: true, opacity: 1, transform, deformation, deformationLocalTransform: local,
  }, layout, 0, false)
  return {
    ...planned,
    tiles: planned.tiles.map((tile) => ({
      ...tile, key: { ...tile.key, resourceKind: 'sparse-mask', format: 'r8unorm' },
    })),
  }
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
  rasterSamplingHalo = true,
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
  if (layer.deformation) {
    const width=scene.geometry.width,height=scene.geometry.height;
    const bounds=inverseDeformationBounds(prepareDeformation(layer.deformation),[Math.min(...points.map(p=>p[0]))/width,Math.min(...points.map(p=>p[1]))/height],[Math.max(...points.map(p=>p[0]))/width,Math.max(...points.map(p=>p[1]))/height]);
    points.splice(0,points.length,...(bounds?[[bounds.min[0]*width,bounds.min[1]*height],[bounds.max[0]*width,bounds.min[1]*height],[bounds.min[0]*width,bounds.max[1]*height],[bounds.max[0]*width,bounds.max[1]*height]]:[[0,0]]).map(p=>mapAffine(inverseAffine(layer.deformationLocalTransform??[1,0,0,1,0,0]),[p[0],p[1]])));
  }
  const minX = Math.min(...points.map((point) => point[0]))
  const minY = Math.min(...points.map((point) => point[1]))
  const maxX = Math.max(...points.map((point) => point[0]))
  const maxY = Math.max(...points.map((point) => point[1]))
  const layerScale = Math.max(
    Math.hypot(layer.transform[0], layer.transform[1]),
    Math.hypot(layer.transform[2], layer.transform[3]),
  )
  const sourceZoom = layer.deformation ? Math.max(1, viewport.zoom * layerScale) : Math.max(Number.EPSILON, viewport.zoom * layerScale)
  const pyramid = layer.sourcePyramid ?? createImageEditorGpuPyramidDescriptorV3(scene.width, scene.height)
  const sourceSize = pyramid.levels.find((level) => level.mip === 0)!
  const hasSparseOverrides = Object.keys(layer.sparseTiles).length > 0
  // 稀疏画笔覆盖属于图层的文档坐标空间，允许画到原始小图片边界之外。
  const sparseExtent = resolveImageEditRasterSourceExtentV3(
    layer.resourceRef ? sourceSize : null, scene, Object.keys(layer.sparseTiles),
  )
  const planningPyramid = hasSparseOverrides
    ? createImageEditorGpuPyramidDescriptorV3(sparseExtent.width, sparseExtent.height) : pyramid
  const planningSize = hasSparseOverrides ? sparseExtent : sourceSize
  const plan = planImageEditorViewportTilesV3({
    documentSize: planningSize,
    sourceSize: planningSize,
    pyramid: planningPyramid,
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
    previousMip: hasSparseOverrides ? 0 : previousMip,
  })
  // 画笔覆盖的权威数据只存在 mip0；在生成派生金字塔前固定 mip0，避免旧底图
  // 的低 mip 覆盖新笔画。未带稀疏覆盖的 8192 路径仍按 4.1 正常选 mip。
  const plannedMip = hasSparseOverrides ? 0 : plan.mip
  const coordinates = plannedMip === plan.mip ? plan.tiles : planImageEditorViewportTilesV3({
    documentSize: planningSize,
    sourceSize: planningSize,
    pyramid: { tileSize: IMAGE_EDIT_STORAGE_TILE_SIZE, levels: [planningPyramid.levels[0]!] },
    viewport: {
      documentX: minX, documentY: minY,
      width: Math.max(Number.EPSILON, (maxX - minX) * sourceZoom),
      height: Math.max(Number.EPSILON, (maxY - minY) * sourceZoom),
      zoom: sourceZoom, devicePixelRatio: viewport.devicePixelRatio,
      interacting: viewport.interacting, velocityX: viewport.velocityX, velocityY: viewport.velocityY,
    },
    bitDepth: scene.color.bitDepth === 8 ? 8 : scene.color.bitDepth === 16 ? 16 : 32,
    haloDocumentPixels: 1, overscanViewports: viewport.interacting ? 0.25 : 0.125,
    forwardPrefetchViewports: 0.25, previousMip: 0,
  }).tiles
  const tiles = coordinates.flatMap((tile) => {
    const override = plannedMip === 0 ? layer.sparseTiles[`0/${tile.tileX}/${tile.tileY}`] : undefined
    const overrideRect = override ? imageEditRasterOverrideRectV3(
      resolveImageEditRasterStorageSizeV3(layer.resourceRef ? sourceSize : null, scene), `0/${tile.tileX}/${tile.tileY}`,
    ) : null
    const mipDimensions = (override ? planningPyramid : pyramid).levels.find((level) => level.mip === plannedMip)
    // 非覆盖区只请求真实源覆盖的瓦片；源范围之外是透明，不是一个可解码瓦片。
    if (!mipDimensions || tile.tileX >= mipDimensions.columns || tile.tileY >= mipDimensions.rows) return []
    if (!override && !layer.resourceRef && layer.sourceKind !== 'annotation') return []
    const resourceRef = override?.resourceRef ?? layer.resourceRef
    if (!resourceRef) return []
    const key: ImageEditorGpuSceneTileKeyV3 = {
      resourceRef,
      resourceKind: override
        ? 'brush-tile'
        : layer.sourceKind === 'annotation' ? 'generated-annotation' : 'source-raster',
      mip: plannedMip,
      tileX: tile.tileX,
      tileY: tile.tileY,
      contentVersion: override?.contentVersion ?? layer.contentVersion,
      ...(override ? { resourceByteLength: override.byteLength } : {}),
      ...(override || layer.sourceKind === 'annotation' ? { format: 'rgba16float' as const } : {}),
    }
    if (rasterSamplingHalo && hasSparseOverrides && layer.sourceKind === 'raster') {
      const coreWidth = overrideRect?.width ?? Math.min(512, mipDimensions.width - tile.tileX * 512)
      const coreHeight = overrideRect?.height ?? Math.min(512, mipDimensions.height - tile.tileY * 512)
      const x = Math.max(0, tile.tileX * 512 - 1), y = Math.max(0, tile.tileY * 512 - 1)
      const rect = { x, y, width: Math.min(sparseExtent.width, tile.tileX * 512 + coreWidth + 1) - x,
        height: Math.min(sparseExtent.height, tile.tileY * 512 + coreHeight + 1) - y }
      const neighbors = Object.entries(layer.sparseTiles).filter(([name]) => {
        const [, tx, ty] = name.split('/').map(Number)
        return tx * 512 < x + rect.width && ty * 512 < y + rect.height
          && (tx + 1) * 512 > x && (ty + 1) * 512 > y
      }).sort(([a], [b]) => a.localeCompare(b)).map(([tileKey, entry]) => ({
        tileKey, resourceRef: entry.resourceRef, byteLength: entry.byteLength, contentVersion: entry.contentVersion,
      }))
      key.rasterRegion = { sourceRef: layer.resourceRef, sourceSize: layer.resourceRef ? sourceSize : null,
        extent: sparseExtent, rect, tiles: neighbors }
      key.contentVersion = JSON.stringify([layer.contentVersion, scene.color, sparseExtent, rect, neighbors])
      key.format = 'rgba16float'
    }
    return [{
      key,
      coreOriginX: tile.tileX * IMAGE_EDIT_STORAGE_TILE_SIZE,
      coreOriginY: tile.tileY * IMAGE_EDIT_STORAGE_TILE_SIZE,
      coreWidth: overrideRect?.width ?? Math.min(IMAGE_EDIT_STORAGE_TILE_SIZE, mipDimensions.width - tile.tileX * IMAGE_EDIT_STORAGE_TILE_SIZE),
      coreHeight: overrideRect?.height ?? Math.min(IMAGE_EDIT_STORAGE_TILE_SIZE, mipDimensions.height - tile.tileY * IMAGE_EDIT_STORAGE_TILE_SIZE),
    }]
  })
  return {
    layerId: layer.layerId,
    mip: plannedMip,
    tiles,
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
