import { describe, expect, it } from 'vitest'

import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from './sceneDefaults'
import {
  deserializeScene,
  isCurrentCameraStageScene,
  UNSUPPORTED_CAMERA_STAGE_SCHEMA,
  serializeScene,
} from './sceneSerialization'
import { createStateKeyframe } from './stateKeyframeTypes'

describe('Camera Stage v13 状态关键帧持久化', () => {
  it('v13 只保存状态关键帧，且只有当前 schema 会进入现役链路', () => {
    const camera = createCameraObject('摄像机', pickDefaultColor(0))
    const stateKeyframe = createStateKeyframe([camera], '关键帧 1', camera.id, 0)
    const serialized = serializeScene({
      objects: [camera],
      activeCameraId: camera.id,
      sceneSettings: createDefaultSceneSettings(),
      stateKeyframes: [stateKeyframe],
    })
    const record = JSON.parse(serialized) as Record<string, unknown>
    expect(record.schemaVersion).toBe(13)
    expect(record.stateKeyframes).toHaveLength(1)
    expect(record).not.toHaveProperty('editorMode')
    expect(record).not.toHaveProperty('shots')
    expect(record).not.toHaveProperty('animation')

    expect(isCurrentCameraStageScene(serialized)).toBe(true)
  })

  it.each([1, 10, 11, 12, 14])('v%i 不是当前 schema，直接退出现役链路', (schemaVersion) => {
    const oldRecord = JSON.stringify({ schemaVersion, objects: [] })
    expect(isCurrentCameraStageScene(oldRecord)).toBe(false)
    expect(() => deserializeScene(oldRecord)).toThrow(`${UNSUPPORTED_CAMERA_STAGE_SCHEMA}:${schemaVersion}`)
  })
})
