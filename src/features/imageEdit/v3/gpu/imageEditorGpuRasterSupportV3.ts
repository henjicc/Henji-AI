import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import { resolveImageEditOutputGeometryV3 } from '@/core/imageEdit/v3/outputGeometry'
import type { ImageEditCanvasGeometryV3 } from '@/core/imageEdit/v3/documentTypes'
import {
  imageEditorGpuSceneTileKeyV3,
  type ImageEditorGpuSceneTileKeyV3,
} from './imageEditorGpuSceneProtocolV3'

export function assertImageEditorGpuSourceTileV3(
  key: ImageEditorGpuSceneTileKeyV3,
  tile: ImageEditorV3SourceTile,
): void {
  if (tile.resourceRef !== key.resourceRef || tile.mip !== key.mip
    || tile.tileX !== key.tileX || tile.tileY !== key.tileY) throw new Error('GPU 源瓦片身份不一致')
  const formatValid = (tile.bitDepth === 8 && tile.sampleFormat === 'uint' && tile.numericRange === 'unorm8')
    || (tile.bitDepth === 16 && tile.sampleFormat === 'uint' && tile.numericRange === 'unorm16')
    || (tile.bitDepth === 32 && tile.sampleFormat === 'float' && tile.numericRange === 'scene-linear')
  if (!formatValid || tile.alphaMode !== 'straight' || tile.orientationApplied !== true
    || tile.halo < 0 || tile.halo > 1) {
    throw new Error('GPU 合成只接受显式 8/16/Float32 straight-alpha 瓦片与 1px halo')
  }
  if (tile.rowStride < tile.width * 4 * (tile.bitDepth / 8)
    || tile.pixels.byteLength < tile.rowStride * tile.height) throw new Error('GPU 源瓦片像素缓冲区不完整')
}

export function imageEditorGpuRetainedStateKeyV3(
  layerId: string,
  key: ImageEditorGpuSceneTileKeyV3,
): string {
  return `${layerId}:${imageEditorGpuSceneTileKeyV3(key)}`
}

export function imageEditorGpuOutputPixelSizeV3(
  layout: ImageEditorViewportLayoutV3,
): readonly [number, number] {
  return [
    Math.max(1, Math.ceil(layout.viewport.width * layout.viewport.devicePixelRatio)),
    Math.max(1, Math.ceil(layout.viewport.height * layout.viewport.devicePixelRatio)),
  ]
}

export function imageEditorGpuCameraUniformV3(
  layout: ImageEditorViewportLayoutV3,
  geometry: ImageEditCanvasGeometryV3,
): Float32Array {
  const resolved = resolveImageEditOutputGeometryV3(geometry)
  const scale = layout.viewport.zoom * layout.viewport.devicePixelRatio
  const rotation = resolved.rotate === 90 ? 1 : resolved.rotate === 180 ? 2 : resolved.rotate === 270 ? 3 : 0
  return new Float32Array([
    layout.viewport.documentX, layout.viewport.documentY, scale, 0,
    resolved.sourceWidth, resolved.sourceHeight, resolved.cropX, resolved.cropY,
    rotation, resolved.mirrored ? 1 : 0, 0, 0,
  ])
}
