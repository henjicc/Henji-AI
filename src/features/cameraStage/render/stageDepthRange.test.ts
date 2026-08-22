import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { resolveDepthRangeFromBox } from './stageDepthRange'

function cameraAt(position: [number, number, number], target: [number, number, number]): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 16 / 9, 0.05, 1000)
  camera.position.set(...position)
  camera.lookAt(new Vector3(...target))
  camera.updateMatrixWorld(true)
  return camera
}

describe('深度图归一化区间', () => {
  it('按主体在视线方向上的最近/最远距离取区间', () => {
    const camera = cameraAt([0, 0, 10], [0, 0, 0])
    const box = new Box3(new Vector3(-1, -1, -2), new Vector3(1, 1, 2))

    const range = resolveDepthRangeFromBox(box, camera)

    // 主体前后表面距相机 8 与 12，两端各留 6% 余量
    expect(range.near).toBeCloseTo(8 - 4 * 0.06, 4)
    expect(range.far).toBeCloseTo(12 + 4 * 0.06, 4)
  })

  it('没有主体时退回相机近平面起的兜底进深', () => {
    const camera = cameraAt([0, 0, 10], [0, 0, 0])

    const range = resolveDepthRangeFromBox(new Box3(), camera)

    expect(range.near).toBe(camera.near)
    expect(range.far).toBeGreaterThan(range.near)
  })

  it('主体贴在相机上时区间不塌成零宽，也不越过近平面', () => {
    const camera = cameraAt([0, 0, 0], [0, 0, -1])
    const box = new Box3(new Vector3(-0.01, -0.01, -0.01), new Vector3(0.01, 0.01, 0.01))

    const range = resolveDepthRangeFromBox(box, camera)

    expect(range.near).toBeGreaterThanOrEqual(camera.near)
    expect(range.far).toBeGreaterThan(range.near)
  })
})
