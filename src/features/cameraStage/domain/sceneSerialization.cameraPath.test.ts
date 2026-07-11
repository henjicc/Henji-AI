import { describe, expect, it } from 'vitest'
import { createCameraObject, pickDefaultColor } from './sceneDefaults'
import { deserializeScene } from './sceneSerialization'
import { createShot } from './shotTypes'

describe('旧运镜预设迁移', () => {
  it('v11 cameraMoves 加载后物化为空间路径并同步下一卡终点', () => {
    const camera = createCameraObject('Camera', pickDefaultColor(0), {
      position: { x: 0, y: 2, z: 5 },
      target: { x: 0, y: 0, z: 0 },
    })
    const shotA = createShot([camera], 'A', camera.id, 0)
    const shotB = createShot([camera], 'B', camera.id, 2)
    shotA.transition.cameraMoves[camera.id] = { kind: 'orbit', degrees: 180, direction: 'cw' }
    const snapshot = deserializeScene(JSON.stringify({
      schemaVersion: 11,
      objects: [camera],
      activeCameraId: camera.id,
      animation: { tracks: [], motionSchedule: [], duration: 2, fps: 30 },
      sceneSettings: undefined,
      editorMode: 'simple',
      shots: [shotA, shotB],
    }))
    const path = snapshot.shots[0].transition.perObject[camera.id].spatialPath
    expect(path?.source).toEqual({
      kind: 'preset',
      preset: { kind: 'orbit', degrees: 180, direction: 'cw' },
    })
    expect(path?.knots).toHaveLength(1)
    expect(snapshot.shots[0].transition.cameraMoves).toEqual({})
    expect(snapshot.shots[1].objectStates[camera.id].transform.position.z).toBeCloseTo(-5, 5)
    expect(snapshot.animation.tracks.some((track) => track.propertyPath === 'transform.position.z')).toBe(true)
  })
})
