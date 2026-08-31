import { collectRelevantGpuLimits } from './webgpuCapabilities'
import type { ImageEditWorkerCapabilities } from './protocol'
import type { WorkerWebGpuState } from './webgpuRuntimeBackend'

export function describeWorkerWebGpuCapabilities(
  state: WorkerWebGpuState
): ImageEditWorkerCapabilities {
  const info = state.adapter.info ?? {}
  return {
    available: true,
    adapterName: info.description || info.device || info.vendor || null,
    backend: info.architecture || null,
    isFallbackAdapter: state.adapter.isFallbackAdapter ?? null,
    features: state.adapter.features ? [...state.adapter.features] : [],
    limits: collectRelevantGpuLimits(state.adapter.limits),
    rgba16Float: { renderable: true, sampleable: true },
    offscreenCanvas: true,
    imageBitmap: true,
    supportedExportFormats: ['image/png', 'image/jpeg', 'image/webp'],
  }
}

export function assertWorkerTextureSize(
  state: WorkerWebGpuState,
  width: number,
  height: number
): void {
  const limit = state.adapter.limits?.maxTextureDimension2D
  if (typeof limit === 'number' && Math.max(width, height) > limit) {
    throw new Error(`图片尺寸 ${width}x${height} 超过设备纹理上限 ${limit}`)
  }
}
