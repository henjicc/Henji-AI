import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import {
  createDefaultImageEditorGpuSceneClientV3,
  type ImageEditorGpuSceneClientV3Like,
} from '../gpu/imageEditorGpuSceneClientV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import type {
  ImageEditorRenderSessionStateV3,
  ImageEditorRenderSnapshotV3,
} from './imageEditorRenderSessionContractsV3'

export class ImageEditorRenderSessionGpuBridgeV3 {
  private readonly client: ImageEditorGpuSceneClientV3Like | null
  private unsubscribe: () => void
  private sceneGeneration = 0
  private cameraSequence = 0
  private interactionSequence = 0
  private quality: ImageEditRenderQuality = 'draft'
  private layout: ImageEditorViewportLayoutV3 | null = null

  constructor(
    sessionId: string,
    injectedClient: ImageEditorGpuSceneClientV3Like | null | undefined,
    private readonly publish: (patch: Partial<ImageEditorRenderSessionStateV3>) => void,
  ) {
    this.client = injectedClient === undefined
      ? createDefaultImageEditorGpuSceneClientV3(sessionId)
      : injectedClient
    this.unsubscribe = this.client?.subscribe((event) => this.handleEvent(event))
      ?? (() => undefined)
  }

  syncSnapshot(snapshot: ImageEditorRenderSnapshotV3): void {
    this.sceneGeneration = snapshot.renderGeneration
    this.interactionSequence = 0
    this.quality = snapshot.quality
    this.client?.syncScene(snapshot)
    if (this.layout) {
      this.client?.updateViewport(this.sceneGeneration, this.cameraSequence, this.layout)
    }
  }

  updateViewport(cameraSequence: number, layout: ImageEditorViewportLayoutV3): void {
    this.cameraSequence = cameraSequence
    this.layout = layout
    if (this.sceneGeneration > 0) {
      this.client?.updateViewport(this.sceneGeneration, cameraSequence, layout)
    }
  }

  updateTransientLayerTransform(
    layerId: string,
    transform: ImageEditTransformV3,
    interactionSequence: number,
  ): void {
    if (this.sceneGeneration <= 0 || interactionSequence < this.interactionSequence) return
    this.interactionSequence = interactionSequence
    this.client?.updateTransientLayerTransform(
      this.sceneGeneration,
      layerId,
      transform,
      interactionSequence,
    )
  }

  clearTransientLayerTransform(layerId: string, interactionSequence: number): void {
    if (this.sceneGeneration <= 0 || interactionSequence < this.interactionSequence) return
    this.interactionSequence = interactionSequence
    this.client?.clearTransientLayerTransform(
      this.sceneGeneration,
      layerId,
      interactionSequence,
    )
  }

  requestFrame(quality: ImageEditRenderQuality = this.quality): void {
    if (this.sceneGeneration <= 0) return
    this.client?.requestFrame(
      this.sceneGeneration,
      this.cameraSequence,
      this.interactionSequence,
      quality,
    )
  }

  dispose(): void {
    this.unsubscribe()
    this.unsubscribe = () => undefined
    this.client?.dispose()
  }

  private handleEvent(event: ImageEditorGpuSceneWorkerEventV3): void {
    if (event.sceneGeneration !== this.sceneGeneration) return
    if (event.type === 'ready') {
      this.publish({
        deviceStatus: 'ready',
        deviceGeneration: event.deviceGeneration,
        diagnostic: null,
      })
      return
    }
    if (event.type === 'device-lost') {
      this.publish({
        compositionBackend: 'cpu',
        presentationBackend: 'canvas2d',
        deviceStatus: 'lost',
        deviceGeneration: event.deviceGeneration,
        diagnostic: event.reason,
      })
      return
    }
    if (event.type === 'failed' && event.code === 'initialization-failed') {
      this.publish({
        compositionBackend: 'cpu',
        presentationBackend: 'canvas2d',
        deviceStatus: 'fallback',
        diagnostic: event.message,
      })
    }
  }
}
