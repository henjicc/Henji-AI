import type { ImageEditorGpuRasterFrameV3 } from './imageEditorGpuRasterPipelineContractsV3'
import type {
  ImageEditorGpuSceneRenderRequestV3,
  ImageEditorGpuSceneWorkerEventV3,
} from './imageEditorGpuSceneProtocolV3'

export interface ImageEditorGpuSceneFrameDeliveryV3 {
  event: ImageEditorGpuSceneWorkerEventV3
  transfer: Transferable[]
}

export function createImageEditorGpuSceneFrameDeliveryV3(
  request: ImageEditorGpuSceneRenderRequestV3,
  deviceGeneration: number,
  result: ImageEditorGpuRasterFrameV3,
): ImageEditorGpuSceneFrameDeliveryV3 {
  const base = {
    sceneGeneration: request.sceneGeneration,
    deviceGeneration,
    requestId: request.requestId,
    cameraSequence: request.cameraSequence,
    interactionSequence: request.interactionSequence,
    surfaceGeneration: result.presentation.surfaceGeneration,
    quality: request.quality,
    diagnostics: result.stats,
  }
  if (result.presentation.kind === 'webgpu-surface') {
    return {
      event: {
        type: 'surface-frame-ready',
        ...base,
        width: result.presentation.width,
        height: result.presentation.height,
      },
      transfer: [],
    }
  }
  return {
    event: {
      type: 'frame-ready',
      ...base,
      bitmap: result.presentation.bitmap,
      ...(result.presentation.surfaceFailureReason
        ? { surfaceFailureReason: result.presentation.surfaceFailureReason }
        : {}),
    },
    transfer: [result.presentation.bitmap],
  }
}
