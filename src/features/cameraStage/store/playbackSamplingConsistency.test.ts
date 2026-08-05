import { describe, expect, it } from 'vitest'

import { CAMERA_STAGE_COLOR_HEX } from '@/core/theme/colorTokens'

import { listAnimatableGroups, poseJointPath } from '../domain/animatableProps'
import { createCameraObject, createCharacterObject, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import type { StageTrack } from '../domain/animationTypes'
import type { StageCameraObject, StageVec3 } from '../domain/sceneTypes'
import { applyAnimationToPlaybackAppliers, registerPlaybackApplier } from './playbackAppliers'
import { sampleAnimationFrame } from './playbackSampling'

// 双路径清单 DP-05：响应式 scrub/离屏导出与命令式播放必须消费同一帧采样结果。

function track(objectId: string, propertyPath: string, value: number | string): StageTrack {
  return {
    objectId,
    propertyPath,
    keyframes: [{ time: 0, value, easing: 'linear' }],
  }
}

describe('播放与离屏导出共用轨道采样结果', () => {
  it('全部可动画分组把同一纯采样结果写入命令式 applier', () => {
    const primitive = createPrimitiveObject('box', '主体', pickDefaultColor(0))
    const character = createCharacterObject('角色', pickDefaultColor(1))
    const camera = createCameraObject('摄像机', pickDefaultColor(2)) as StageCameraObject
    const objects = [primitive, character, camera]
    const tracks: StageTrack[] = [
      track(primitive.id, 'transform.position.x', 3),
      track(primitive.id, 'transform.scale.y', 2),
      track(primitive.id, 'color', CAMERA_STAGE_COLOR_HEX.objectWarm),
      track(character.id, `${poseJointPath('head')}.x`, 25),
      track(character.id, 'color', CAMERA_STAGE_COLOR_HEX.objectCool),
      track(camera.id, 'transform.position.z', 8),
      track(camera.id, 'transform.rotation.y', 45),
      track(camera.id, 'fov', 72),
    ]
    const frame = sampleAnimationFrame(objects, tracks, 0)
    const applied = new Map<string, unknown>()
    const unregister: Array<() => void> = []

    for (const object of frame.objects) {
      for (const group of listAnimatableGroups(object)) {
        if (!group.children.some((child) => frame.trackKeys.has(`${object.id}::${child.path}`))) continue
        const key = `${object.id}::${group.groupPath}`
        unregister.push(registerPlaybackApplier(object.id, group.groupPath, (value) => {
          applied.set(key, value)
        }))
      }
    }

    applyAnimationToPlaybackAppliers(objects, tracks, 0)
    unregister.forEach((dispose) => dispose())

    for (const object of frame.objects) {
      for (const group of listAnimatableGroups(object)) {
        if (!group.children.some((child) => frame.trackKeys.has(`${object.id}::${child.path}`))) continue
        expect(applied.get(`${object.id}::${group.groupPath}`)).toEqual(group.getBaseValue(object))
      }
    }
  })

  /*
   * 播放时的朝向同样从注视点反解，否则"环绕运镜"只有位置在动、镜头始终朝正前方。
   * 作者显式打了旋转关键帧的情况另有分支（hasAuthoredRotation）不受影响。
   */
  it('手动注视模式在播放时也从注视点反解朝向，并保留 roll', () => {
    const camera = createCameraObject('摄像机', pickDefaultColor(0)) as StageCameraObject
    camera.transform.rotation = { x: 12, y: 34, z: 5 }
    camera.lookAt = { mode: 'manual', target: { x: 999, y: -999, z: 1 } }
    const rotations: StageVec3[] = []
    const dispose = registerPlaybackApplier(camera.id, 'transform.rotation', (value) => {
      rotations.push(value as StageVec3)
    })

    applyAnimationToPlaybackAppliers(
      [camera],
      [track(camera.id, 'transform.position.x', 2)],
      0,
    )
    dispose()

    expect(rotations).toHaveLength(1)
    expect(rotations[0]).not.toEqual(camera.transform.rotation)
    expect(rotations[0].z).toBe(5)
    // 目标在右下方很远处：应当明显向右下俯视。
    expect(rotations[0].x).toBeLessThan(0)
  })
})
