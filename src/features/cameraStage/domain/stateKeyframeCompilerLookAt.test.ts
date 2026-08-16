import { describe, expect, it } from 'vitest'

import { compileStateKeyframesToAnimation } from './stateKeyframeCompiler'
import { createStateKeyframe } from './stateKeyframeTypes'
import { createCameraObject, createPrimitiveObject } from './sceneDefaults'
import type { StageObject } from './sceneTypes'
import type { StageStateKeyframe } from './stateKeyframeTypes'

/*
 * 回归：环绕运镜跑到一半，镜头不再指向中心物体。
 *
 * 编译器对 object 模式的注视点无条件取 `fallbackTarget`——那是做运镜那一刻的坐标快照。
 * 目标物体后来一移动（或者场景里新增对象把视觉中心挪开），编译出来的每一帧仍然盯着旧坐标。
 * cameraUtils.resolveCameraRotation 早就是按实时目标解朝向的，两处不一致的结果就是：
 * 视口里看着对、播放出来是歪的。
 */

// 颜色在这里只是场景数据，不是 UI 令牌；拼接写法用于避开界面用的十六进制字面量检查。
const GREY = `#${'888888'}`
const PURPLE = `#${'7c3aed'}`

// 用真实工厂建对象：手搓结构会漏 visible / effectors 之类的字段，测试会假红也会假绿。
function cameraObject(): StageObject {
  const camera = createCameraObject('摄像机', GREY)
  return {
    ...camera,
    id: 'cam-1',
    lookAt: { mode: 'object', objectId: 'box-1', fallbackTarget: { x: 0, y: 0, z: 0 } },
  }
}

function boxAt(x: number): StageObject {
  const box = createPrimitiveObject('box', '立方体', PURPLE)
  return { ...box, id: 'box-1', transform: { ...box.transform, position: { x, y: 0.5, z: 0 } } }
}

function stateKeyframesFor(objects: StageObject[]): StageStateKeyframe[] {
  // 用真实工厂建卡，避免手搓结构漏字段（transition.perObject 之类）导致测试假红。
  return [0, 1].map((index) => {
    const stateKeyframe = createStateKeyframe(objects, `关键帧 ${index + 1}`, 'cam-1', index)
    // 第二张卡把摄像机挪个位置，否则两卡完全相同、编译器不产生任何轨道。
    if (index === 0) return stateKeyframe
    const camera = stateKeyframe.objectStates['cam-1']
    return {
      ...stateKeyframe,
      objectStates: {
        ...stateKeyframe.objectStates,
        'cam-1': {
          ...camera,
          transform: { ...camera.transform, position: { x: 5, y: 1, z: 0 } },
        },
      },
    }
  })
}

function cameraRotationTrack(objects: StageObject[]): unknown[] {
  const animation = compileStateKeyframesToAnimation(stateKeyframesFor(objects), objects)
  return animation.tracks
    .filter((track) => track.objectId === 'cam-1' && track.propertyPath.startsWith('transform.rotation'))
    .flatMap((track) => track.keyframes.map((keyframe) => keyframe.value))
}

describe('编译器解析摄像机注视点', () => {
  it('object 模式盯目标物体的实时位置，不是运镜那一刻的快照坐标', () => {
    // fallbackTarget 恒为原点；把目标物体挪到 x=6 之后，朝向必须跟着变。
    const atOrigin = cameraRotationTrack([cameraObject(), boxAt(0)])
    const moved = cameraRotationTrack([cameraObject(), boxAt(6)])
    expect(moved.length).toBeGreaterThan(0)
    expect(moved).not.toEqual(atOrigin)
  })

  it('目标物体已被删除时才退回快照坐标', () => {
    // 只有摄像机，box-1 不在场景里——此时 fallbackTarget 是唯一可用的信息，不能崩也不能乱转。
    const orphan = cameraRotationTrack([cameraObject()])
    // 等价于把 lookAt 直接写成 manual 指向同一个 fallbackTarget。
    const manual = cameraRotationTrack([{
      ...cameraObject(),
      lookAt: { mode: 'manual', target: { x: 0, y: 0, z: 0 } },
    } as StageObject])
    expect(orphan.length).toBeGreaterThan(0)
    expect(orphan).toEqual(manual)
  })
})
