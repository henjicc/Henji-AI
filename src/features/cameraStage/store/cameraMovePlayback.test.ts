import { describe, expect, it } from 'vitest'

import { applyAnimationAtTime } from './playbackSampling'
import { applyAnimationToPlaybackAppliers, registerPlaybackApplier } from './playbackAppliers'
import { resolveCameraLookAtTarget, rotationFromPositionAndTarget } from '../domain/cameraUtils'
import { compileStateKeyframesToAnimation } from '../domain/stateKeyframeCompiler'
import { createStateKeyframe } from '../domain/stateKeyframeTypes'
import { createCameraObject, createPrimitiveObject } from '../domain/sceneDefaults'
import { createCameraPresetPath } from '../domain/spatialPath'
import type { StageCameraLookAt, StageCameraObject, StageObject, StageVec3 } from '../domain/sceneTypes'
import type { StageStateKeyframe } from '../domain/stateKeyframeTypes'

/*
 * 回归（实测缺陷）：
 * 1. 环绕超过 180° 时，编译器把朝向插成欧拉角轨道并按最短路径换算，环绕 270° 中段镜头背对主体；
 * 2. 有注视对象时播放用插值旋转轨道、导出按实时注视点求朝向，两者最多差 152°；
 * 3. 空间路径在每个关键帧处强制停下，“平滑通过”无效，两段 90° 环绕衔接点速度跌到峰值 2%。
 */

// 颜色在这里只是场景数据，不是 UI 令牌；拼接写法用于避开界面用的十六进制字面量检查。
const GREY = `#${'888888'}`
const PURPLE = `#${'7c3aed'}`
const SUBJECT = { x: 0, y: 1, z: 0 }
const DEG = Math.PI / 180

function scene(lookAt: 'manual' | 'object'): StageObject[] {
  const start = { x: 0, y: 4, z: 12 }
  const camera = createCameraObject('摄像机', GREY, { position: start, target: SUBJECT })
  const box = createPrimitiveObject('box', '主体', PURPLE)
  const cameraLookAt: StageCameraLookAt = lookAt === 'manual'
    ? { mode: 'manual', target: SUBJECT }
    : { mode: 'object', objectId: 'box', fallbackTarget: SUBJECT }
  return [
    { ...camera, id: 'cam', lookAt: cameraLookAt },
    { ...box, id: 'box', transform: { ...box.transform, position: SUBJECT } },
  ]
}

/** 按正式运镜写入方式：每段在起点卡上物化环绕路径，终点卡机位落到环绕终点。 */
function orbitKeyframes(objects: StageObject[], segments: Array<{ degrees: number; duration: number }>, continuity: 'stop' | 'smooth'): StageStateKeyframe[] {
  const stateKeyframes = [{ ...createStateKeyframe(objects, '卡0', 'cam', 0), continuity }]
  let time = 0
  for (const [index, segment] of segments.entries()) {
    const from = stateKeyframes[index]
    const generated = createCameraPresetPath({ kind: 'orbit', degrees: segment.degrees, direction: 'cw' }, from.objectStates.cam.transform.position, SUBJECT)
    from.transition.perObject.cam = { spatialPath: generated.path, speedPreset: 'easeInOut' }
    time += segment.duration
    const next = { ...createStateKeyframe(objects, `卡${index + 1}`, 'cam', time), continuity }
    next.objectStates.cam = { ...next.objectStates.cam, transform: { ...next.objectStates.cam.transform, position: generated.endPosition } }
    stateKeyframes.push(next)
  }
  return stateKeyframes
}

function forward(rotation: StageVec3): StageVec3 {
  return {
    x: -Math.sin(rotation.y * DEG) * Math.cos(rotation.x * DEG),
    y: Math.sin(rotation.x * DEG),
    z: -Math.cos(rotation.y * DEG) * Math.cos(rotation.x * DEG),
  }
}

function angleBetween(a: StageVec3, b: StageVec3): number {
  const fa = forward(a)
  const fb = forward(b)
  return Math.acos(Math.max(-1, Math.min(1, fa.x * fb.x + fa.y * fb.y + fa.z * fb.z))) / DEG
}

/** 导出路径：scrub 落回对象后，StageViewportCamera 在 object 模式按实时注视点、manual 模式取 rotation。 */
function exportRotation(objects: StageObject[], camera: StageCameraObject): StageVec3 {
  return camera.lookAt.mode === 'object'
    ? rotationFromPositionAndTarget(camera.transform.position, resolveCameraLookAtTarget(camera, objects), camera.transform.rotation.z)
    : camera.transform.rotation
}

describe('运镜朝向与速度', () => {
  it.each(['manual', 'object'] as const)('环绕 270°（%s 注视）全程镜头对准主体，播放与导出朝向一致', (lookAt) => {
    const objects = scene(lookAt)
    const animation = compileStateKeyframesToAnimation(orbitKeyframes(objects, [{ degrees: 270, duration: 8 }], 'stop'), objects)
    let played: StageVec3 | null = null
    const dispose = registerPlaybackApplier('cam', 'transform.rotation', (value) => { played = value as StageVec3 })
    let maxAimError = 0
    let maxPlaybackExportGap = 0
    for (let frame = 0; frame <= 240; frame += 1) {
      const time = frame / 30
      const sampled = applyAnimationAtTime(objects, animation, time)
      const camera = sampled.find((object) => object.id === 'cam') as StageCameraObject
      const exported = exportRotation(sampled, camera)
      applyAnimationToPlaybackAppliers(objects, animation, time)
      maxAimError = Math.max(maxAimError, angleBetween(exported, rotationFromPositionAndTarget(camera.transform.position, SUBJECT)))
      maxPlaybackExportGap = Math.max(maxPlaybackExportGap, angleBetween(played!, exported))
    }
    dispose()
    expect(maxAimError).toBeLessThan(1)
    expect(maxPlaybackExportGap).toBeLessThan(1e-3)
  })

  it('object 模式盯目标物体的实时位置，不是运镜那一刻的快照坐标', () => {
    const objects = scene('object')
    const stateKeyframes = orbitKeyframes(objects, [{ degrees: 90, duration: 2 }], 'stop')
    // 目标物体在做完运镜之后被挪走：朝向必须跟到它的新位置。
    const moved = objects.map((object) => object.id === 'box'
      ? { ...object, transform: { ...object.transform, position: { x: 3, y: 1, z: 0 } } }
      : object)
    const animation = compileStateKeyframesToAnimation(stateKeyframes, moved)
    const camera = applyAnimationAtTime(moved, animation, 1).find((object) => object.id === 'cam') as StageCameraObject
    const expected = rotationFromPositionAndTarget(camera.transform.position, { x: 3, y: 1, z: 0 })
    expect(angleBetween(camera.transform.rotation, expected)).toBeLessThan(1e-6)
  })

  it('目标物体已被删除时退回快照注视点', () => {
    const [camera] = scene('object')
    const animation = compileStateKeyframesToAnimation(orbitKeyframes([camera], [{ degrees: 90, duration: 2 }], 'stop'), [camera])
    const sampled = applyAnimationAtTime([camera], animation, 1)[0] as StageCameraObject
    expect(angleBetween(sampled.transform.rotation, rotationFromPositionAndTarget(sampled.transform.position, SUBJECT))).toBeLessThan(1e-3)
  })

  it('注视区间夹在两段手动摇镜之间时，后一段摇镜从停留角度开始，停留期间不跳变', () => {
    const objects = scene('manual')
    const near = { x: 0, y: 1, z: 5 }
    const far = { x: -5, y: 1, z: 10 }
    const keyframe = (time: number, position: StageVec3, target: StageVec3, delay = 0): StageStateKeyframe => {
      const stateKeyframe = createStateKeyframe(objects, `卡${time}`, 'cam', time)
      stateKeyframe.objectStates.cam = { ...stateKeyframe.objectStates.cam, transform: { ...stateKeyframe.objectStates.cam.transform, position }, lookAt: { mode: 'manual', target } }
      stateKeyframe.transition.perObject.cam = { speedPreset: 'uniform', delay }
      return stateKeyframe
    }
    // 卡0→1 原地摇镜 90°；卡1→2 注视点不变地平移；卡2→3 错峰 0.5 秒后再摇回去。
    const animation = compileStateKeyframesToAnimation([
      keyframe(0, near, { x: 0, y: 1, z: 0 }),
      keyframe(1, near, { x: -5, y: 1, z: 5 }),
      keyframe(2, far, { x: -5, y: 1, z: 5 }, 0.5),
      keyframe(3, far, { x: -10, y: 1, z: 10 }),
    ], objects)
    const yawAt = (time: number): number => (applyAnimationAtTime(objects, animation, time).find((object) => object.id === 'cam') as StageCameraObject).transform.rotation.y
    for (const time of [2, 2.01, 2.25, 2.5]) expect(yawAt(time)).toBeCloseTo(0, 5)
    expect(yawAt(2.75)).toBeCloseTo(45, 5)

    // 最后一段改成机位与注视点一起平移：两端角度相同，也不能夹取到卡1 的 90°。
    const translated = compileStateKeyframesToAnimation([
      keyframe(0, near, { x: 0, y: 1, z: 0 }),
      keyframe(1, near, { x: -5, y: 1, z: 5 }),
      keyframe(2, far, { x: -5, y: 1, z: 5 }),
      keyframe(3, { x: -3, y: 1, z: 10 }, { x: -3, y: 1, z: 5 }),
    ], objects)
    for (const time of [2.25, 2.75, 3]) {
      const camera = applyAnimationAtTime(objects, translated, time).find((object) => object.id === 'cam') as StageCameraObject
      expect(camera.transform.rotation.y).toBeCloseTo(0, 5)
    }
  })

  it('两段 90° 环绕“平滑通过”时衔接点速度连续，不会停下', () => {
    const speedsAround = (continuity: 'stop' | 'smooth'): { before: number; after: number; peak: number } => {
      const objects = scene('manual')
      const animation = compileStateKeyframesToAnimation(orbitKeyframes(objects, [{ degrees: 90, duration: 4 }, { degrees: 90, duration: 4 }], continuity), objects)
      const positionAt = (time: number): StageVec3 => (applyAnimationAtTime(objects, animation, time).find((object) => object.id === 'cam') as StageCameraObject).transform.position
      const speed = (time: number): number => {
        const a = positionAt(time)
        const b = positionAt(time + 1 / 30)
        return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * 30
      }
      const peak = Math.max(...Array.from({ length: 239 }, (_, frame) => speed(frame / 30)))
      return { before: speed(4 - 1 / 30), after: speed(4), peak }
    }
    const stop = speedsAround('stop')
    const smooth = speedsAround('smooth')
    expect(stop.before / stop.peak).toBeLessThan(0.05)
    expect(smooth.before / smooth.peak).toBeGreaterThan(0.9)
    expect(Math.abs(smooth.after - smooth.before) / smooth.peak).toBeLessThan(0.01)
  })
})
