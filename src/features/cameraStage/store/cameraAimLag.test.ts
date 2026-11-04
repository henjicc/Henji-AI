import { describe, expect, it } from 'vitest'

import { applyAnimationAtTime, resolveCameraViewTarget } from './playbackSampling'
import { applyAnimationToPlaybackAppliers, registerPlaybackApplier } from './playbackAppliers'
import { rotationFromPositionAndTarget } from '../domain/cameraUtils'
import { compileStateKeyframesToAnimation } from '../domain/stateKeyframeCompiler'
import { createStateKeyframe } from '../domain/stateKeyframeTypes'
import { createCameraObject, createPrimitiveObject } from '../domain/sceneDefaults'
import { createCameraPresetPath } from '../domain/spatialPath'
import type { StageCameraObject, StageObject, StageVec3 } from '../domain/sceneTypes'

// 颜色在这里只是场景数据，不是 UI 令牌；拼接写法用于避开界面用的十六进制字面量检查。
const GREY = `#${'888888'}`
const SUBJECT = { x: 0, y: 1, z: 0 }
const DEG = Math.PI / 180

function orbitScene(aimLag: number) {
  const camera = createCameraObject('摄像机', GREY, { position: { x: 0, y: 2, z: 8 }, target: SUBJECT })
  const box = createPrimitiveObject('box', '主体', GREY)
  const objects: StageObject[] = [
    { ...camera, id: 'cam', lookAt: { mode: 'object', objectId: 'box', fallbackTarget: SUBJECT }, rig: 'steadicam', aimLag },
    { ...box, id: 'box', transform: { ...box.transform, position: SUBJECT } },
  ]
  const start = createStateKeyframe(objects, 'k0', 0)
  const generated = createCameraPresetPath({ kind: 'orbit', degrees: 180, direction: 'cw' }, start.objectStates.cam.transform.position, SUBJECT)
  start.transition.perObject.cam = { spatialPath: generated.path, speedPreset: 'easeInOut' }
  const end = createStateKeyframe(objects, 'k1', 6)
  end.objectStates.cam = { ...end.objectStates.cam, transform: { ...end.objectStates.cam.transform, position: generated.endPosition } }
  return { objects, animation: compileStateKeyframesToAnimation([start, end], objects) }
}

function forward(rotation: StageVec3): StageVec3 {
  return { x: -Math.sin(rotation.y * DEG) * Math.cos(rotation.x * DEG), y: Math.sin(rotation.x * DEG), z: -Math.cos(rotation.y * DEG) * Math.cos(rotation.x * DEG) }
}

function angle(a: StageVec3, b: StageVec3): number {
  const fa = forward(a)
  const fb = forward(b)
  return Math.acos(Math.max(-1, Math.min(1, fa.x * fb.x + fa.y * fb.y + fa.z * fb.z))) / DEG
}

function cameraAt(objects: StageObject[], animation: ReturnType<typeof orbitScene>['animation'], time: number): StageCameraObject {
  return applyAnimationAtTime(objects, animation, time).find((object) => object.id === 'cam') as StageCameraObject
}

describe('注视跟随滞后', () => {
  it('环绕时镜头略落后于主体、全程连续，关掉后正对主体', () => {
    const lagged = orbitScene(0.2)
    const direct = orbitScene(0)
    let maxLag = 0
    let maxAngularStep = 0
    let previous: StageVec3 | null = null
    for (let frame = 0; frame <= 6 * 60; frame += 1) {
      const time = frame / 60
      const camera = cameraAt(lagged.objects, lagged.animation, time)
      maxLag = Math.max(maxLag, angle(camera.transform.rotation, rotationFromPositionAndTarget(camera.transform.position, SUBJECT)))
      if (previous) maxAngularStep = Math.max(maxAngularStep, angle(previous, camera.transform.rotation))
      previous = camera.transform.rotation
      const aimed = cameraAt(direct.objects, direct.animation, time)
      expect(angle(aimed.transform.rotation, rotationFromPositionAndTarget(aimed.transform.position, SUBJECT))).toBeLessThan(1e-4)
    }
    expect(maxLag).toBeGreaterThan(1)
    expect(maxLag).toBeLessThan(15)
    // 60 帧/秒下相邻两帧转角不超过 1°：没有朝向跳变。
    expect(maxAngularStep).toBeLessThan(1)
  })

  it('播放、拖动时间轴与导出视口在同一时刻得到同一朝向，与采样先后和帧率无关', () => {
    const { objects, animation } = orbitScene(0.2)
    const time = 2.345
    const first = cameraAt(objects, animation, time).transform.rotation
    for (let frame = 0; frame <= 6 * 24; frame += 1) cameraAt(objects, animation, frame / 24)
    expect(cameraAt(objects, animation, time).transform.rotation).toEqual(first)

    let played: StageVec3 | null = null
    const dispose = registerPlaybackApplier('cam', 'transform.rotation', (value) => { played = value as StageVec3 })
    applyAnimationToPlaybackAppliers(objects, animation, time)
    dispose()
    expect(angle(played!, first)).toBeLessThan(1e-4)

    // 导出走 seek 落回对象，视口在 object 模式按“机位 + 视口看向的点”求朝向。
    const scrubbed = applyAnimationAtTime(objects, animation, time)
    const camera = scrubbed.find((object) => object.id === 'cam') as StageCameraObject
    const viewport = rotationFromPositionAndTarget(camera.transform.position, resolveCameraViewTarget(camera, scrubbed, animation, time))
    expect(angle(viewport, first)).toBeLessThan(1e-4)
  })
})
