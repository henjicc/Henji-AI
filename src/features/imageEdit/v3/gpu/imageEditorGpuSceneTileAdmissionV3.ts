import type { ImageEditorGpuRasterCompositorV3Like,
  ImageEditorGpuRasterTextureV3 } from './imageEditorGpuRasterPipelineContractsV3'
import { imageEditorGpuSceneErrorMessageV3 } from './imageEditorGpuSceneRecoveryV3'
import { ImageEditorGpuSceneResourceRegistryV3 } from './imageEditorGpuSceneResourceRegistryV3'
import type { ImageEditorGpuSceneUploadTileV3 } from './imageEditorGpuSceneProtocolV3'

export type ImageEditorGpuSceneTileAdmissionResultV3 = { admitted: true } | {
  admitted: false
  code: 'composition-not-ready'
  message: string
}

export function admitImageEditorGpuSceneTileV3(options: {
  resources: ImageEditorGpuSceneResourceRegistryV3<ImageEditorGpuRasterTextureV3>
  compositor: ImageEditorGpuRasterCompositorV3Like
  entry: ImageEditorGpuSceneUploadTileV3
  trimCombined: (additionalBytes: number) => void
}): ImageEditorGpuSceneTileAdmissionResultV3 {
  if (options.resources.get(options.entry.key)) return { admitted: true }
  let payload: ImageEditorGpuRasterTextureV3 | null = null
  try {
    const gpuBytes = options.compositor.estimateTileGpuBytes(options.entry.tile)
    options.trimCombined(gpuBytes)
    options.resources.prepareAdmission(gpuBytes)
    payload = options.compositor.uploadTile(options.entry.key, options.entry.tile)
    options.resources.register(options.entry.key, payload, gpuBytes, options.entry.protections)
    payload = null
    return { admitted: true }
  } catch (error) {
    payload?.destroy()
    return { admitted: false, code: 'composition-not-ready',
      message: imageEditorGpuSceneErrorMessageV3(error) }
  }
}

/** 把未受保护的缓存淘汰到预算以内；剩下的都是当前帧需要的资源，保留不动。 */
export function trimImageEditorGpuSceneMemoryV3(options: {
  resources: ImageEditorGpuSceneResourceRegistryV3<ImageEditorGpuRasterTextureV3> | null
  preview: ImageEditorGpuRasterCompositorV3Like | null
  exportResidentBytes: number
  additionalBytes?: number
  includeCompositorPressure?: boolean
}): void {
  if (!options.resources || !options.preview) return
  for (;;) {
    const snapshot = options.resources.snapshot()
    const previewBytes = options.preview.estimatedResidentGpuBytes?.() ?? snapshot.bytes
    const fits = previewBytes + options.exportResidentBytes + (options.additionalBytes ?? 0)
      <= snapshot.budgetBytes
    if (fits && (!options.includeCompositorPressure || options.preview.memoryPressureBytes() === 0)) return
    if (!options.resources.evictOldestUnprotected()) return
  }
}
