import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import type { ImageEditorPresentationSurfaceV3 } from './imageEditorPresentationSurfaceV3'

type GpuFrameReadyV3 = Extract<ImageEditorGpuSceneWorkerEventV3, { type: 'frame-ready' }>

/** 只管 GPU ImageBitmap 与既有双 Canvas 表面的所有权交接。 */
export class ImageEditorRenderSessionGpuPresentationV3 {
  private active = false

  constructor(private readonly surface: ImageEditorPresentationSurfaceV3) {}

  present(
    event: GpuFrameReadyV3,
    layout: ImageEditorViewportLayoutV3,
    eventToPresentMs: number | null,
  ): boolean {
    const presented = this.surface.presentGpuBitmap(
      event.bitmap,
      layout,
      event.sceneGeneration,
      event.cameraSequence,
      event.interactionSequence,
      eventToPresentMs,
      event.diagnostics,
    )
    if (presented) this.active = true
    return presented
  }

  fallback(resumeCpuPresentation: () => void): void {
    this.active = false
    resumeCpuPresentation()
  }

  isActive(): boolean {
    return this.active
  }
}
