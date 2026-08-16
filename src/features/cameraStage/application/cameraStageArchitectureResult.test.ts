import { describe, expect, it } from 'vitest'

import { createCameraObject, createDefaultSceneSettings, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import { createStateKeyframe } from '../domain/stateKeyframeTypes'
import { useCameraStageStore } from '../store/cameraStageStore'

describe('Camera Stage 单一状态关键帧架构结果', () => {
  it('建模写入同步全部状态关键帧且不产生意外动画', () => {
    const camera = createCameraObject('摄像机', pickDefaultColor(0))
    const object = createPrimitiveObject('sphere', '球', pickDefaultColor(1))
    const objects = [camera, object]
    const first = createStateKeyframe(objects, '关键帧 1', camera.id, 0)
    const second = createStateKeyframe(objects, '关键帧 2', camera.id, 1)
    useCameraStageStore.getState().loadSnapshot({
      objects,
      activeCameraId: camera.id,
      animation: { tracks: [], motionSchedule: [], duration: 0, fps: 30 },
      sceneSettings: createDefaultSceneSettings(),
      stateKeyframes: [first, second],
    }, { id: 'project-1', name: '架构结果测试' })

    useCameraStageStore.getState().updateObjectAcrossStateKeyframes(object.id, {
      transform: { ...object.transform, scale: { x: 2, y: 2, z: 2 } },
    })
    expect(useCameraStageStore.getState().stateKeyframes.map(
      (item) => item.objectStates[object.id]?.transform.scale.x,
    )).toEqual([2, 2])
    const scaleTracks = useCameraStageStore.getState().animation.tracks.filter(
      (track) => track.objectId === object.id && track.propertyPath.startsWith('transform.scale'),
    )
    expect(scaleTracks).toHaveLength(0)
  })
})
