import { describe, expect, it } from 'vitest'
import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from './sceneDefaults'
import { deserializeScene, serializeScene } from './sceneSerialization'
import { createStateKeyframe } from './stateKeyframeTypes'

describe('当前状态关键帧空间路径持久化', () => {
  it('v13 保存与加载保留空间路径并重新编译轨道', () => {
    const camera = createCameraObject('Camera', pickDefaultColor(0), {
      position: { x: 0, y: 2, z: 5 },
      target: { x: 0, y: 0, z: 0 },
    })
    const stateKeyframeA = createStateKeyframe([camera], 'A', camera.id, 0)
    const stateKeyframeB = createStateKeyframe([camera], 'B', camera.id, 2)
    stateKeyframeA.transition.perObject[camera.id] = {
      spatialPath: {
        kind: 'bezier',
        source: { kind: 'preset', preset: { kind: 'orbit', degrees: 180, direction: 'cw' } },
        startOutTangent: { x: 1, y: 0, z: 0 },
        knots: [],
        endInTangent: { x: -1, y: 0, z: 0 },
      },
    }
    const snapshot = deserializeScene(serializeScene({
      objects: [camera],
      activeCameraId: camera.id,
      sceneSettings: createDefaultSceneSettings(),
      stateKeyframes: [stateKeyframeA, stateKeyframeB],
    }))
    const path = snapshot.stateKeyframes[0].transition.perObject[camera.id].spatialPath
    expect(path?.source).toEqual({
      kind: 'preset',
      preset: { kind: 'orbit', degrees: 180, direction: 'cw' },
    })
    expect(path?.knots).toHaveLength(0)
    expect(snapshot.animation.tracks.some((track) => track.propertyPath === 'transform.position.z')).toBe(true)
  })
})
