import { describe, expect, it } from 'vitest'

import { createDefaultImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import type { ImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { planImageEditorGpuRasterTilesV3 } from './imageEditorGpuTilePlannerV3'

const RESOURCE = `sha256:${'a'.repeat(64)}` as const

function scene(): Pick<ImageEditorGpuRasterSceneV3, 'width' | 'height' | 'color' | 'geometry' | 'layers'> {
  return {
    width: 8_192,
    height: 8_192,
    geometry: {
      width: 8_192, height: 8_192, crop: null,
      orientation: { rotate: 0, mirrored: false },
    },
    color: createDefaultImageEditColorModeV3(),
    layers: [{
      layerId: 'large', resourceRef: RESOURCE, contentVersion: `${RESOURCE}:1`,
      visible: true, opacity: 1, transform: [1, 0, 0, 1, 0, 0],
    }],
  }
}

describe('GPU 大图视口瓦片规划', () => {
  it('复用视口 planner 按缩放选 mip，不会要求 8192 整图纹理', () => {
    const value = scene()
    const layer = value.layers[0]
    const plan = planImageEditorGpuRasterTilesV3(value, layer, {
      stageWidth: 1_024,
      stageHeight: 768,
      viewportKey: 'large',
      viewport: {
        documentX: 3_072, documentY: 3_200, width: 1_024, height: 768,
        zoom: 0.125, devicePixelRatio: 2,
      },
    })

    expect(plan.mip).toBe(2)
    expect(plan.tiles.length).toBeGreaterThan(0)
    expect(plan.tiles.length).toBeLessThan(64)
    expect(new Set(plan.tiles.map((tile) => tile.key.mip))).toEqual(new Set([2]))
    expect(Math.max(...plan.tiles.map((tile) => tile.coreWidth))).toBeLessThanOrEqual(512)
  })

  it('平移后只更换局部瓦片，缩放临界点使用 previousMip 防抖', () => {
    const value = scene()
    const layer = value.layers[0]
    const first = planImageEditorGpuRasterTilesV3(value, layer, {
      stageWidth: 800, stageHeight: 600, viewportKey: 'a',
      viewport: { documentX: 0, documentY: 0, width: 800, height: 600, zoom: 0.5, devicePixelRatio: 1 },
    })
    const shifted = planImageEditorGpuRasterTilesV3(value, layer, {
      stageWidth: 800, stageHeight: 600, viewportKey: 'b',
      viewport: { documentX: 256, documentY: 0, width: 800, height: 600, zoom: 0.51, devicePixelRatio: 1 },
    }, first.mip)
    const firstKeys = new Set(first.tiles.map((tile) => `${tile.key.tileX}/${tile.key.tileY}`))
    const shiftedKeys = new Set(shifted.tiles.map((tile) => `${tile.key.tileX}/${tile.key.tileY}`))
    const retained = [...firstKeys].filter((key) => shiftedKeys.has(key))

    expect(shifted.mip).toBe(first.mip)
    expect(retained.length).toBeGreaterThan(0)
    expect(retained.length).toBeLessThanOrEqual(firstKeys.size)
  })
})
