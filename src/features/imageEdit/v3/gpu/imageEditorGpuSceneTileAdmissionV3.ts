import type { ImageEditorGpuRasterCompositorV3Like,
  ImageEditorGpuRasterTextureV3 } from './imageEditorGpuRasterPipelineContractsV3'
import { imageEditorGpuSceneErrorMessageV3 } from './imageEditorGpuSceneRecoveryV3'
import { ImageEditorGpuSceneResourceRegistryV3 } from './imageEditorGpuSceneResourceRegistryV3'
import type { ImageEditorGpuSceneUploadTileV3 } from './imageEditorGpuSceneProtocolV3'
import { ImageEditorGpuTileAtlasBudgetErrorV3 } from './imageEditorGpuTileAtlasV3'

export type ImageEditorGpuSceneTileAdmissionResultV3 = { admitted: true } | {
  admitted: false
  code: 'resource-budget-exceeded' | 'composition-not-ready'
  message: string
}

export function admitImageEditorGpuSceneTileV3(options: {
  resources: ImageEditorGpuSceneResourceRegistryV3<ImageEditorGpuRasterTextureV3>
  compositor: ImageEditorGpuRasterCompositorV3Like
  entry: ImageEditorGpuSceneUploadTileV3
  trimCombined: (additionalBytes: number) => boolean
}): ImageEditorGpuSceneTileAdmissionResultV3 {
  if (options.resources.get(options.entry.key)) return { admitted: true }
  let payload: ImageEditorGpuRasterTextureV3 | null = null
  try {
    const gpuBytes = options.compositor.estimateTileGpuBytes(options.entry.tile)
    if (!options.trimCombined(gpuBytes)) return budgetFailure(
      'GPU Scene 预览与导出资源超过共享 256 MiB 会话预算',
    )
    const admission = options.resources.prepareAdmission(gpuBytes)
    if (!admission.admitted) return budgetFailure(
      'GPU Scene 资源超过 256 MiB 会话预算且没有可淘汰资源',
    )
    while (!payload) {
      try {
        payload = options.compositor.uploadTile(options.entry.key, options.entry.tile)
      } catch (error) {
        if (!(error instanceof ImageEditorGpuTileAtlasBudgetErrorV3)
          || !options.resources.evictOldestUnprotected()) throw error
      }
    }
    const registration = options.resources.register(
      options.entry.key,
      payload,
      gpuBytes,
      options.entry.protections,
    )
    payload = null
    return registration.admitted ? { admitted: true } : budgetFailure(
      'GPU Scene 资源超过 256 MiB 会话预算且没有可淘汰资源',
    )
  } catch (error) {
    payload?.destroy()
    return { admitted: false, code: 'composition-not-ready',
      message: imageEditorGpuSceneErrorMessageV3(error) }
  }
}

export function trimImageEditorGpuSceneMemoryV3(options: {
  resources: ImageEditorGpuSceneResourceRegistryV3<ImageEditorGpuRasterTextureV3> | null
  preview: ImageEditorGpuRasterCompositorV3Like | null
  exportResidentBytes: number
  additionalBytes?: number
  includeCompositorPressure?: boolean
}): boolean {
  if (!options.resources || !options.preview) {
    return !options.includeCompositorPressure || options.preview?.memoryPressureBytes() === 0
  }
  for (;;) {
    const snapshot = options.resources.snapshot()
    const previewBytes = options.preview.estimatedResidentGpuBytes?.() ?? snapshot.bytes
    const fits = previewBytes + options.exportResidentBytes + (options.additionalBytes ?? 0)
      <= snapshot.budgetBytes
    if (fits && (!options.includeCompositorPressure || options.preview.memoryPressureBytes() === 0)) {
      return true
    }
    if (!options.resources.evictOldestUnprotected()) return false
  }
}

function budgetFailure(message: string): ImageEditorGpuSceneTileAdmissionResultV3 {
  return { admitted: false, code: 'resource-budget-exceeded', message }
}
