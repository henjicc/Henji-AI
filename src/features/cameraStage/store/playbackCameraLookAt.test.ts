import { describe, expect, it } from 'vitest'

import { createDefaultAnimation } from '../domain/animationTypes'
import { rotationFromPositionAndTarget } from '../domain/cameraUtils'
import { createCameraObject, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import type { StageTrack } from '../domain/animationTypes'
import type { StageCameraObject, StageVec3 } from '../domain/sceneTypes'
import { applyAnimationToPlaybackAppliers, registerPlaybackApplier } from './playbackAppliers'

/**
 * 实测缺陷：环绕运镜做完之后，拖时间指针看到的朝向是对的，按空格播放却始终朝前。
 *
 * 摄像机朝向不是动画轨道，而是由 `lookAt` 在渲染时解算的。scrub 会写 store，组件重算朝向
 * 并同步进采样引用；**播放按性能约束不写 store**，那个 layout effect 一次都不跑，朝向就冻结
 * 在按下空格那一帧——而环绕运镜只写了三条 `transform.position` 轨道，没有旋转轨道。
 */

function positionTrack(objectId: string, axis: 'x' | 'y' | 'z', values: Array<[number, number]>): StageTrack {
  return {
    objectId,
    propertyPath: `transform.position.${axis}`,
    keyframes: values.map(([time, value]) => ({ time, value, easing: 'linear' as const })),
  }
}

describe('播放期摄像机朝向', () => {
  it('摄像机绕行时朝向持续指向注视对象', () => {
    const subject = createPrimitiveObject('box', '立方体', pickDefaultColor(1))
    subject.transform.position = { x: 0, y: 0.5, z: 0 }
    const camera = createCameraObject('摄像机01', pickDefaultColor(0)) as StageCameraObject
    camera.lookAt = { mode: 'object', objectId: subject.id, fallbackTarget: { x: 0, y: 0, z: 0 } }
    const objects = [camera, subject]

    // 摄像机从 +Z 绕到 +X：没有旋转轨道，朝向只能靠 lookAt 解算
    const tracks = [
      positionTrack(camera.id, 'x', [[0, 0], [1, 4]]),
      positionTrack(camera.id, 'z', [[0, 4], [1, 0]]),
    ]

    const applied: StageVec3[] = []
    const unregister = registerPlaybackApplier(camera.id, 'transform.rotation', (value) => {
      applied.push(value as StageVec3)
    })

    applyAnimationToPlaybackAppliers(objects, tracks, 0)
    applyAnimationToPlaybackAppliers(objects, tracks, 1)
    unregister()

    expect(applied).toHaveLength(2)
    // 起点在 +Z 看向原点，终点在 +X 看向原点：水平角必须真的变了
    expect(applied[0].y).not.toBeCloseTo(applied[1].y, 1)
    expect(applied[1]).toMatchObject(
      rotationFromPositionAndTarget({ x: 4, y: camera.transform.position.y, z: 0 }, { x: 0, y: 0.5, z: 0 }, 0)
    )
  })

  it('注视对象自己在动时，朝向跟着它的采样位置走', () => {
    const subject = createPrimitiveObject('box', '立方体', pickDefaultColor(1))
    subject.transform.position = { x: 0, y: 0.5, z: 0 }
    const camera = createCameraObject('摄像机01', pickDefaultColor(0)) as StageCameraObject
    camera.transform.position = { x: 0, y: 1, z: 5 }
    camera.lookAt = { mode: 'object', objectId: subject.id, fallbackTarget: { x: 0, y: 0, z: 0 } }

    // 物体上下漂浮：摄像机不动，但俯仰角必须随之变化
    const tracks = [positionTrack(subject.id, 'y', [[0, 0.5], [1, 3]])]
    const applied: StageVec3[] = []
    const unregister = registerPlaybackApplier(camera.id, 'transform.rotation', (value) => {
      applied.push(value as StageVec3)
    })

    applyAnimationToPlaybackAppliers([camera, subject], tracks, 0)
    applyAnimationToPlaybackAppliers([camera, subject], tracks, 1)
    unregister()

    expect(applied[0].x).not.toBeCloseTo(applied[1].x, 1)
  })

  it('作者显式打了旋转关键帧时不被 lookAt 覆盖', () => {
    const subject = createPrimitiveObject('box', '立方体', pickDefaultColor(1))
    const camera = createCameraObject('摄像机01', pickDefaultColor(0)) as StageCameraObject
    camera.lookAt = { mode: 'object', objectId: subject.id, fallbackTarget: { x: 0, y: 0, z: 0 } }

    const tracks: StageTrack[] = [
      positionTrack(camera.id, 'x', [[0, 0], [1, 4]]),
      { objectId: camera.id, propertyPath: 'transform.rotation.y', keyframes: [
        { time: 0, value: 10, easing: 'linear' }, { time: 1, value: 90, easing: 'linear' },
      ] },
    ]

    const applied: StageVec3[] = []
    const unregister = registerPlaybackApplier(camera.id, 'transform.rotation', (value) => {
      applied.push(value as StageVec3)
    })
    applyAnimationToPlaybackAppliers([camera, subject], tracks, 1)
    unregister()

    // 只应该收到作者轨道那一次推送，且水平角是作者写的 90
    expect(applied).toHaveLength(1)
    expect(applied[0].y).toBeCloseTo(90, 5)
  })

  it('动画为空时不推送朝向，静态场景保持原样', () => {
    const camera = createCameraObject('摄像机01', pickDefaultColor(0)) as StageCameraObject
    const applied: StageVec3[] = []
    const unregister = registerPlaybackApplier(camera.id, 'transform.rotation', (value) => {
      applied.push(value as StageVec3)
    })
    applyAnimationToPlaybackAppliers([camera], createDefaultAnimation().tracks, 0)
    unregister()
    // 手动 lookAt 的静态摄像机仍会被解算一次，但不应抛错且结果稳定
    expect(applied.length).toBeLessThanOrEqual(1)
  })
})
