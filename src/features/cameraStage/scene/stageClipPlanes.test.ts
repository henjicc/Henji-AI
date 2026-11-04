import { describe, expect, it } from 'vitest'
import { WHITE_HEX } from '@/core/theme/colorTokens'
import { createPrimitiveObject } from '../domain/sceneDefaults'
import { resolveStageSceneExtent, stageGroundSize } from '../application/stageSceneExtent'
import { resolveStageClipPlanes } from './stageClipPlanes'

function building(x: number, z: number, height: number) {
  const object = createPrimitiveObject('box', '楼', WHITE_HEX)
  object.transform.position = { x, y: height / 2, z }
  object.transform.scale = { x: 30, y: height, z: 30 }
  return object
}

describe('stage clip planes', () => {
  it('从 1.5 千米外看 800 米城区时远裁剪面罩住整片布景，地面铺到布景之外', () => {
    const extent = resolveStageSceneExtent([building(-400, -400, 60), building(400, 400, 120)])
    const camera = { x: 0, y: 600, z: 1500 }
    const planes = resolveStageClipPlanes(camera, 1600, extent)
    const farthestCorner = Math.hypot(415, 600, 1915)
    expect(planes.far).toBeGreaterThan(farthestCorner)
    expect(planes.near).toBeGreaterThan(0.05)
    expect(stageGroundSize(extent)).toBeGreaterThan(830)
  })

  it('小场景保持原来的 5 厘米近裁剪面、1000 米远裁剪面与 160 米地面', () => {
    const extent = resolveStageSceneExtent([building(0, 0, 2)])
    expect(resolveStageClipPlanes({ x: 0, y: 4.2, z: 9 }, 9.8, extent)).toEqual({ near: 0.05, far: 1000 })
    expect(stageGroundSize(extent)).toBe(160)
  })
})
