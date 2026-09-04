import type { ImageEditorGpuSceneFailedEventV3 } from './imageEditorGpuSceneProtocolV3'

interface ImageEditorGpuSceneFailureInputV3 {
  sceneGeneration: number
  deviceGeneration: number
  requestId: string | null
  code: ImageEditorGpuSceneFailedEventV3['code']
  message: string
  recoverable: boolean
  deviceAcquireCount: number
  surfaceFrameCount: number
}

export function createImageEditorGpuSceneFailureEventV3(
  input: ImageEditorGpuSceneFailureInputV3,
): ImageEditorGpuSceneFailedEventV3 {
  return {
    type: 'failed',
    sceneGeneration: input.sceneGeneration,
    deviceGeneration: input.deviceGeneration,
    requestId: input.requestId,
    code: input.code,
    message: input.message,
    recoverable: input.recoverable,
    diagnostic: input.message.startsWith('Reality 注入'),
    diagnostics: input.message === 'Reality 注入 GPU 初始化失败'
      ? { deviceAcquireCount: input.deviceAcquireCount, surfaceFrameCount: input.surfaceFrameCount }
      : undefined,
  }
}
