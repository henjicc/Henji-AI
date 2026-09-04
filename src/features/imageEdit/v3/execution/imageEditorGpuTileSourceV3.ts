import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'

type RequestedTileKeyV3 = Extract<
  ImageEditorGpuSceneWorkerEventV3,
  { type: 'tiles-needed' }
>['keys'][number]

export function floatPremultipliedTileToGpuSource(
  key: RequestedTileKeyV3,
  premultiplied: Float32Array,
  width: number,
  height: number,
): ImageEditorV3SourceTile {
  const straight = new Float32Array(premultiplied.length)
  for (let offset = 0; offset < premultiplied.length; offset += 4) {
    const alpha = Math.max(0, premultiplied[offset + 3])
    const inverseAlpha = alpha > 0 ? 1 / alpha : 0
    straight[offset] = premultiplied[offset] * inverseAlpha
    straight[offset + 1] = premultiplied[offset + 1] * inverseAlpha
    straight[offset + 2] = premultiplied[offset + 2] * inverseAlpha
    straight[offset + 3] = alpha
  }
  return {
    resourceRef: key.resourceRef, mip: key.mip, tileX: key.tileX, tileY: key.tileY,
    halo: 0, width, height, channels: 4, bitDepth: 32,
    sampleFormat: 'float', numericRange: 'scene-linear', byteOrder: 'little-endian',
    rowStride: width * 16, colorSpace: 'scrgb', transferFunction: 'linear',
    alphaMode: 'straight', orientationApplied: true,
    originX: key.tileX * 512, originY: key.tileY * 512, pixels: straight.buffer,
  }
}
