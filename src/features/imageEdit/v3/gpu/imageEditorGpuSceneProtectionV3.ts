import type { ImageEditorGpuRasterCompositorV3Like,
  ImageEditorGpuRasterTextureV3 } from './imageEditorGpuRasterPipelineContractsV3'
import type { ImageEditorGpuSceneResourceRegistryV3 } from './imageEditorGpuSceneResourceRegistryV3'
import type { ImageEditorGpuSceneWorkerRequestV3 } from './imageEditorGpuSceneProtocolV3'

type RenderRequestV3 = Extract<ImageEditorGpuSceneWorkerRequestV3, { type: 'render' }>

export function acceptsImageEditorGpuSceneRenderV3(
  request: RenderRequestV3,
  current: { sceneGeneration: number; cameraSequence: number; interactionSequence: number },
  surfaceGeneration: number,
): boolean {
  return request.sceneGeneration === current.sceneGeneration
    && request.cameraSequence === current.cameraSequence
    && request.interactionSequence === current.interactionSequence
    && request.surfaceGeneration === surfaceGeneration
}

export function refreshImageEditorGpuSceneViewportProtectionsV3(
  resources: ImageEditorGpuSceneResourceRegistryV3<ImageEditorGpuRasterTextureV3> | null,
  compositor: ImageEditorGpuRasterCompositorV3Like | null,
): void {
  if (!resources) return
  resources.releaseProtection('viewport')
  if (!compositor) return
  for (const key of compositor.requiredResourceKeys()) resources.protect(key, 'viewport')
}

export function refreshImageEditorGpuSceneInteractionProtectionsV3(
  resources: ImageEditorGpuSceneResourceRegistryV3<ImageEditorGpuRasterTextureV3> | null,
  compositor: ImageEditorGpuRasterCompositorV3Like | null,
  layerId: string | null,
): void {
  if (!resources) return
  resources.releaseProtection('interaction')
  if (!compositor || !layerId) return
  for (const key of compositor.requiredResourceKeys(layerId)) resources.protect(key, 'interaction')
}
