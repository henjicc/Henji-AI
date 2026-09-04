import type { ImageEditorGpuSceneWorkerEventV3 } from './imageEditorGpuSceneProtocolV3'

export interface ImageEditorGpuSceneSequenceSnapshotV3 {
  sceneGeneration: number
  cameraSequence: number
  interactionSequence: number
}

export class ImageEditorGpuSceneSequenceGateV3 {
  private sceneGeneration = 0
  private cameraSequence = 0
  private interactionSequence = 0

  syncScene(sceneGeneration: number): boolean {
    if (!isSequence(sceneGeneration) || sceneGeneration < this.sceneGeneration) return false
    if (sceneGeneration > this.sceneGeneration) {
      this.sceneGeneration = sceneGeneration
      this.cameraSequence = 0
      this.interactionSequence = 0
    }
    return true
  }

  updateCamera(sceneGeneration: number, cameraSequence: number): boolean {
    if (!this.matchesScene(sceneGeneration)
      || !isSequence(cameraSequence)
      || cameraSequence < this.cameraSequence) return false
    this.cameraSequence = cameraSequence
    return true
  }

  updateInteraction(sceneGeneration: number, interactionSequence: number): boolean {
    if (!this.matchesScene(sceneGeneration)
      || !isSequence(interactionSequence)
      || interactionSequence < this.interactionSequence) return false
    this.interactionSequence = interactionSequence
    return true
  }

  acceptsEvent(event: ImageEditorGpuSceneWorkerEventV3): boolean {
    if (!this.matchesScene(event.sceneGeneration)) return false
    if (event.type === 'frame-ready') {
      return event.cameraSequence === this.cameraSequence
        && event.interactionSequence === this.interactionSequence
    }
    return true
  }

  snapshot(): ImageEditorGpuSceneSequenceSnapshotV3 {
    return {
      sceneGeneration: this.sceneGeneration,
      cameraSequence: this.cameraSequence,
      interactionSequence: this.interactionSequence,
    }
  }

  private matchesScene(sceneGeneration: number): boolean {
    return isSequence(sceneGeneration) && sceneGeneration === this.sceneGeneration
  }
}

function isSequence(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}
