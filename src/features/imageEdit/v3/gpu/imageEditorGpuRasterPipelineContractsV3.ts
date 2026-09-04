import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import type { ImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'
import type { ImageEditorGpuTileAtlasAllocationV3 } from './imageEditorGpuTileAtlasV3'

export type ImageEditorGpuRasterTextureV3 = ImageEditorGpuTileAtlasAllocationV3

export interface ImageEditorGpuRasterCompositorStatsV3 {
  uploadCount: number
  pipelineCompileCount: number
  frameCount: number
  diagnosticReadbackCount: number
  transientUniformUpdateCount: number
  residentTileCount: number
  atlasPageCount: number
  allocatedAtlasBytes: number
  minimumPlannedMip: number
  maximumPlannedMip: number
  surfaceFrameCount: number
  imageBitmapFrameCount: number
  directSurfaceFailureCount: number
  renderedGraphNodeCount?: number
  graphCacheHitCount?: number
  invalidatedGraphNodeCount?: number
  fusedAdjustmentCount?: number
  maximumGraphTargetWidth?: number
  maximumGraphTargetHeight?: number
}

export type ImageEditorGpuRasterFrameV3 = {
  presentation: {
    kind: 'webgpu-surface'
    surfaceGeneration: number
    width: number
    height: number
  }
  stats: ImageEditorGpuRasterCompositorStatsV3
  usedResourceKeys: readonly ImageEditorGpuSceneTileKeyV3[]
} | {
  presentation: {
    kind: 'gpu-image-bitmap'
    surfaceGeneration: number
    width: number
    height: number
    bitmap: ImageBitmap
    surfaceFailureReason?: string
  }
  stats: ImageEditorGpuRasterCompositorStatsV3
  usedResourceKeys: readonly ImageEditorGpuSceneTileKeyV3[]
}

export interface ImageEditorGpuRasterCompositorV3Like {
  syncScene(scene: ImageEditorGpuRasterSceneV3 | null): void
  updateTransientTransform(layerId: string, transform: ImageEditTransformV3 | null): void
  updateViewport(layout: ImageEditorViewportLayoutV3): void
  attachPresentationSurface(canvas: OffscreenCanvas, surfaceGeneration: number): void
  memoryPressureBytes(): number
  estimateTileGpuBytes(tile: ImageEditorV3SourceTile): number
  uploadTile(key: ImageEditorGpuSceneTileKeyV3, tile: ImageEditorV3SourceTile): ImageEditorGpuRasterTextureV3
  requiredResourceKeys(layerId?: string): readonly ImageEditorGpuSceneTileKeyV3[]
  missingResources(resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null): ImageEditorGpuSceneTileKeyV3[]
  render(
    resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null,
    surfaceGeneration: number,
    acceptsSurfaceSubmit: () => boolean,
  ): Promise<ImageEditorGpuRasterFrameV3>
  readLinearPixelsForTest(resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null): Promise<Float32Array>
  readPresentedPixelsForTest?(resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuRasterTextureV3 | null): Promise<Uint8Array>
  snapshotStats(): ImageEditorGpuRasterCompositorStatsV3
  dispose(): void
}

export interface ImageEditorGpuRasterCompositorOptionsV3 {
  memoryBudgetBytes?: number
}
