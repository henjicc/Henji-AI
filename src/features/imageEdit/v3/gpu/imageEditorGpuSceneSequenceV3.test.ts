import { describe, expect, it } from 'vitest'

import { ImageEditorGpuSceneSequenceGateV3 } from './imageEditorGpuSceneSequenceV3'

describe('ImageEditorGpuSceneSequenceGateV3', () => {
  it('独立推进 scene、camera、interaction 并拒绝任一维度的旧帧', () => {
    const gate = new ImageEditorGpuSceneSequenceGateV3()
    expect(gate.syncScene(3)).toBe(true)
    expect(gate.updateCamera(3, 8)).toBe(true)
    expect(gate.updateInteraction(3, 12)).toBe(true)

    expect(gate.acceptsEvent({
      type: 'frame-ready',
      requestId: 'current',
      sceneGeneration: 3,
      cameraSequence: 8,
      interactionSequence: 12,
      deviceGeneration: 1,
      surfaceGeneration: 0,
      quality: 'draft',
      bitmap: {} as ImageBitmap,
    })).toBe(true)
    expect(gate.acceptsEvent({
      type: 'frame-ready',
      requestId: 'old-camera',
      sceneGeneration: 3,
      cameraSequence: 7,
      interactionSequence: 12,
      deviceGeneration: 1,
      surfaceGeneration: 0,
      quality: 'draft',
      bitmap: {} as ImageBitmap,
    })).toBe(false)
    expect(gate.acceptsEvent({
      type: 'frame-ready',
      requestId: 'old-interaction',
      sceneGeneration: 3,
      cameraSequence: 8,
      interactionSequence: 11,
      deviceGeneration: 1,
      surfaceGeneration: 0,
      quality: 'draft',
      bitmap: {} as ImageBitmap,
    })).toBe(false)
    expect(gate.updateCamera(2, 100)).toBe(false)
    expect(gate.updateInteraction(3, 11)).toBe(false)
  })

  it('新 scene 自动清零相机和交互序列', () => {
    const gate = new ImageEditorGpuSceneSequenceGateV3()
    gate.syncScene(1)
    gate.updateCamera(1, 5)
    gate.updateInteraction(1, 7)

    expect(gate.syncScene(2)).toBe(true)
    expect(gate.snapshot()).toEqual({
      sceneGeneration: 2,
      cameraSequence: 0,
      interactionSequence: 0,
    })
  })
})
