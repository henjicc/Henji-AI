import type { ImageEditorViewportCompositeRuntimeEventV3 } from './viewportCompositeProtocolV3'
import type { ImageEditorRenderSessionStateV3 } from './imageEditorRenderSessionV3'

export function imageEditorRenderRuntimePatchV3(
  event: ImageEditorViewportCompositeRuntimeEventV3,
  currentDiagnostic: string | null,
): Partial<ImageEditorRenderSessionStateV3> {
  if (event.status === 'gpu-ready') {
    return {
      renderBackend: 'gpu',
      deviceStatus: 'ready',
      deviceGeneration: event.deviceGeneration ?? 0,
      diagnostic: null,
    }
  }
  return {
    renderBackend: 'cpu',
    deviceStatus: event.status === 'device-lost' ? 'lost' : 'fallback',
    diagnostic: event.status === 'device-lost' ? event.reason : currentDiagnostic,
  }
}
