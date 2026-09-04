import type { ImageEditWebGpuDeviceLoss, ManagedWebGpuDevice } from '@/core/imageEdit/webgpu/deviceManager'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'

import type { ImageEditorGpuRasterCompositorV3Like } from './imageEditorGpuRasterCompositorV3'

export interface ImageEditorGpuSceneGpuStateV3 {
  managed: ManagedWebGpuDevice
  context: ImageEditorGpuSceneContextV3
  compositor: ImageEditorGpuRasterCompositorV3Like
  unsubscribeError: () => void
}

export interface ImageEditorGpuSceneDeviceManagerV3 {
  onDeviceLost(handler: (reason: string, loss: ImageEditWebGpuDeviceLoss) => void): void
  acquire(): Promise<ManagedWebGpuDevice>
  getRecoveryStatus(): { generation: number; retryAfterMs: number }
  destroy(): void
}

export interface ImageEditorGpuSceneContextV3 {
  onError(listener: (error: unknown) => void): () => void
  dispose(): void
}

export interface ImageEditorGpuSceneRuntimeDependenciesV3 {
  deviceManager?: ImageEditorGpuSceneDeviceManagerV3
  contextFactory?: (device: GpuDevice) => Promise<ImageEditorGpuSceneContextV3>
  compositorFactory?: (
    context: ImageEditorGpuSceneContextV3,
    options: { memoryBudgetBytes: number },
  ) => ImageEditorGpuRasterCompositorV3Like
}

export type ImageEditorGpuSceneRuntimeStatusV3 =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'lost'
  | 'recovering'
  | 'fallback'
  | 'disposed'
