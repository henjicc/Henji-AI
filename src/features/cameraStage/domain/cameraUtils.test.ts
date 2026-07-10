import { describe, expect, it } from 'vitest'
import { createCameraObject, createPrimitiveObject, pickDefaultColor } from './sceneDefaults'
import { applyObjectPatch, isFirstCamera } from './cameraUtils'

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
    const nextCameraB = next.find((item) => item.id === cameraB.id)
    expect(nextCameraB?.aspectRatio).toEqual(cameraB.aspectRatio)
    expect(nextCameraB?.name).toBe('副机位')
    // 首摄像机不受影响
    expect(next.find((item) => item.id === cameraA.id)?.aspectRatio).toEqual(cameraA.aspectRatio)
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
