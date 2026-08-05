import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { createCameraObject, createPrimitiveObject, pickDefaultColor } from './sceneDefaults'
import {
  applyObjectPatch,
  areCameraAspectRatiosConsistent,
  cameraTargetFromPositionRotation,
  cameraTargetFromRotation,
  getCameraObjects,
  isFirstCamera,
  resolveCameraRotation,
  rotationFromPositionAndTarget,
} from './cameraUtils'

describe('cameraTargetFromPositionRotation', () => {
  it('反推控制目标后重新 lookAt 可无损还原俯仰和水平角', () => {
    const position = { x: 2, y: 3, z: 8 }
    const rotation = { x: -12.5, y: 27.25, z: 0 }
    const target = cameraTargetFromPositionRotation(position, rotation, 9)
    const restored = rotationFromPositionAndTarget(position, target)
    expect(restored.x).toBeCloseTo(rotation.x, 10)
    expect(restored.y).toBeCloseTo(rotation.y, 10)
  })
})

describe('areCameraAspectRatiosConsistent', () => {
  it('空集合和统一画幅的机位通过校验', () => {
    const cameraA = createCameraObject('摄像机01', pickDefaultColor(0))
    const cameraB = createCameraObject('摄像机02', pickDefaultColor(1))
    cameraB.aspectRatio = { ...cameraA.aspectRatio }

    expect(areCameraAspectRatiosConsistent([])).toBe(true)
    expect(areCameraAspectRatiosConsistent([cameraA, cameraB])).toBe(true)
  })

  it('旧工程中参与渲染的机位画幅意外不一致时返回 false', () => {
    const cameraA = createCameraObject('摄像机01', pickDefaultColor(0))
    const cameraB = createCameraObject('摄像机02', pickDefaultColor(1))
    cameraB.aspectRatio = { preset: '1:1', ratio: 1 }

    expect(areCameraAspectRatiosConsistent([cameraA, cameraB])).toBe(false)
  })
})

describe('isFirstCamera', () => {
  it('按对象数组插入顺序判定最早创建的摄像机', () => {
    const cameraA = createCameraObject('摄像机01', pickDefaultColor(0))
    const cameraB = createCameraObject('摄像机02', pickDefaultColor(1))
    const objects = [cameraA, cameraB]
    expect(isFirstCamera(objects, cameraA.id)).toBe(true)
    expect(isFirstCamera(objects, cameraB.id)).toBe(false)
  })

  it('非摄像机 id 或空场景返回 false', () => {
    const primitive = createPrimitiveObject('box', '方块01', pickDefaultColor(0))
    expect(isFirstCamera([primitive], primitive.id)).toBe(false)
    expect(isFirstCamera([], 'missing')).toBe(false)
  })
})

describe('applyObjectPatch（重要记录 007：摄像机画幅一致性）', () => {
  it('首摄像机改画幅时联动同步其余摄像机', () => {
    const cameraA = createCameraObject('摄像机01', pickDefaultColor(0))
    const cameraB = createCameraObject('摄像机02', pickDefaultColor(1))
    const objects = [cameraA, cameraB]
    const nextRatio = { preset: 'custom' as const, ratio: 2 }
    const next = applyObjectPatch(objects, cameraA.id, { aspectRatio: nextRatio })
    expect(next.find((item) => item.id === cameraA.id)?.type).toBe('camera')
    for (const item of next) {
      if (item.type === 'camera') {
        expect(item.aspectRatio).toEqual(nextRatio)
      }
    }
  })

  it('非首摄像机的画幅补丁被钳制忽略，其余字段仍正常生效', () => {
    const cameraA = createCameraObject('摄像机01', pickDefaultColor(0))
    const cameraB = createCameraObject('摄像机02', pickDefaultColor(1))
    const objects = [cameraA, cameraB]
    const next = applyObjectPatch(objects, cameraB.id, { aspectRatio: { preset: 'custom', ratio: 3 }, name: '副机位' })
    const nextCameraB = getCameraObjects(next).find((item) => item.id === cameraB.id)
    expect(nextCameraB?.aspectRatio).toEqual(cameraB.aspectRatio)
    expect(nextCameraB?.name).toBe('副机位')
    // 首摄像机不受影响
    expect(getCameraObjects(next).find((item) => item.id === cameraA.id)?.aspectRatio).toEqual(cameraA.aspectRatio)
  })

  it('非画幅补丁走原有 map 逻辑，不受机位判定影响', () => {
    const primitive = createPrimitiveObject('box', '方块01', pickDefaultColor(0))
    const next = applyObjectPatch([primitive], primitive.id, { name: '新名字' })
    expect(next.find((item) => item.id === primitive.id)?.name).toBe('新名字')
  })

  it('目标对象不存在时原样返回', () => {
    const cameraA = createCameraObject('摄像机01', pickDefaultColor(0))
    const objects = [cameraA]
    expect(applyObjectPatch(objects, 'missing', { name: 'x' })).toBe(objects)
  })
})

describe('摄像机旋转与注视点换算', () => {
  /*
   * 朝向的唯一数据源是 lookAt，manual 模式也不例外。
   *
   * 旧实现在 manual 模式直接返回存量 rotation，于是"只写目标点不写角度"的入口（面板手填注视点、
   * 通用动词写 look_at_target、运镜按 targetPoint 环绕）写进去的目标全部失效——实测"摄像机围绕
   * 两个物体旋转"轨迹绕上了，镜头却一直朝正前方。roll 不在 lookAt 里，仍必须原样保留。
   */
  it('手动注视模式也从注视点反解朝向，且保留 roll', () => {
    const camera = createCameraObject('摄像机01', pickDefaultColor(0), {
      position: { x: 0, y: 0, z: 5 },
      target: { x: 5, y: 0, z: 5 },
    })
    camera.transform.rotation = { x: 12, y: -34, z: 27 }
    camera.lookAt = { mode: 'manual', target: { x: 5, y: 0, z: 5 } }
    const resolved = resolveCameraRotation(camera, [camera])
    expect(resolved).toEqual(rotationFromPositionAndTarget(
      camera.transform.position,
      { x: 5, y: 0, z: 5 },
      27,
    ))
    expect(resolved.z).toBe(27)
    expect(resolved.y).not.toBe(-34)
  })

  it('注视点与机位重合时保持当前角度，不弹回正前方', () => {
    const camera = createCameraObject('摄像机01', pickDefaultColor(0), {
      position: { x: 1, y: 2, z: 3 },
      target: { x: 1, y: 2, z: 3 },
    })
    camera.transform.rotation = { x: 12, y: -34, z: 27 }
    camera.lookAt = { mode: 'manual', target: { x: 1, y: 2, z: 3 } }
    expect(resolveCameraRotation(camera, [camera])).toEqual({ x: 12, y: -34, z: 27 })
  })

  it('旋转换算往返时保持实际朝向', () => {
    const camera = createCameraObject('摄像机01', pickDefaultColor(0), {
      position: { x: 0, y: 0, z: 5 },
      target: { x: 3, y: 2, z: 0 },
    })
    const rotation = resolveCameraRotation(camera, [camera])
    const target = cameraTargetFromRotation(camera, [camera], rotation)
    if (camera.lookAt.mode !== 'manual') throw new Error('测试摄像机应使用手动注视点')
    const originalDirection = {
      x: camera.lookAt.target.x - camera.transform.position.x,
      y: camera.lookAt.target.y - camera.transform.position.y,
      z: camera.lookAt.target.z - camera.transform.position.z,
    }
    expect(target.x - camera.transform.position.x).toBeCloseTo(originalDirection.x, 5)
    expect(target.y - camera.transform.position.y).toBeCloseTo(originalDirection.y, 5)
    expect(target.z - camera.transform.position.z).toBeCloseTo(originalDirection.z, 5)
  })

  it('换算出的角度按 YXZ 顺序回放时与 three.js lookAt 姿态一致（回归：XYZ 顺序会产生假 roll）', () => {
    // 俯仰角和水平角同时非零的机位：欧拉顺序一旦用错，两个四元数会明显偏离
    const position = { x: 2.5, y: 1.8, z: -3.2 }
    const target = { x: -1, y: 0.6, z: 2 }
    const rotation = rotationFromPositionAndTarget(position, target)
    const lookAtQuaternion = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(
      new Vector3(position.x, position.y, position.z),
      new Vector3(target.x, target.y, target.z),
      new Vector3(0, 1, 0),
    ))
    const toQuaternion = (order: 'YXZ' | 'XYZ'): Quaternion => new Quaternion().setFromEuler(new Euler(
      rotation.x * Math.PI / 180,
      rotation.y * Math.PI / 180,
      rotation.z * Math.PI / 180,
      order,
    ))
    // |dot| = 1 表示同一姿态（四元数双覆盖，q 与 -q 等价）
    expect(Math.abs(lookAtQuaternion.dot(toQuaternion('YXZ')))).toBeCloseTo(1, 6)
    expect(Math.abs(lookAtQuaternion.dot(toQuaternion('XYZ')))).toBeLessThan(0.999)
  })
})
