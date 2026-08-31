import { describe, expect, it } from 'vitest'

import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts'
import type { ImageEditRenderPlanNode } from '@/core/imageEdit/v3/renderPlan'
import {
  applyPreviewBrushTileReplacementsV3,
  createPreviewBrushTileMapV3,
} from './previewPixelsV3'

const BRUSH = `sha256:${'a'.repeat(64)}`

function pixel(data: Float32Array, width: number, x: number, y = 0): number[] {
  const offset = (y * width + x) * 4
  return [...data.subarray(offset, offset + 4)]
}

describe('ImageEditor V3 managed preview brush tile 合成', () => {
  it('按 document tile 坐标完整替换底图区域，透明像素保持透明以露出下层', () => {
    const baseData = new Float32Array(1_024 * 4)
    for (let offset = 0; offset < baseData.length; offset += 4) {
      baseData.set([0.2, 0.2, 0.2, 1], offset)
    }
    const base = createFloat32PremultipliedRgbaTile(
      1_024,
      1,
      'linear-light',
      baseData,
      'srgb',
      'srgb',
      203,
    )
    const brushData = new Float32Array(512 * 4)
    brushData.set([0.25, 0, 0, 0.5], 10 * 4)
    const brushTiles = createPreviewBrushTileMapV3([{
      resourceId: BRUSH,
      storage: 'rgba-float32',
      width: 512,
      height: 1,
      bytes: brushData.buffer,
    }])
    const node = {
      parameters: { tiles: { '0/1/0': BRUSH } },
    } as unknown as ImageEditRenderPlanNode

    const output = applyPreviewBrushTileReplacementsV3(node, base, brushTiles, {
      width: 1_024,
      height: 1,
      scaleX: 1,
      scaleY: 1,
    })

    expect(pixel(output.data, output.width, 511)).toEqual([...new Float32Array([0.2, 0.2, 0.2, 1])])
    expect(pixel(output.data, output.width, 512)).toEqual([0, 0, 0, 0])
    expect(pixel(output.data, output.width, 522)).toEqual([0.25, 0, 0, 0.5])
    expect(pixel(base.data, base.width, 512)).toEqual([...new Float32Array([0.2, 0.2, 0.2, 1])])
  })

  it('Worker 边界再次拒绝超过 512 或非精确 Float32 RGBA 长度的瓦片', () => {
    expect(() => createPreviewBrushTileMapV3([{
      resourceId: BRUSH,
      storage: 'rgba-float32',
      width: 513,
      height: 1,
      bytes: new ArrayBuffer(513 * 4 * 4),
    }])).toThrow(/像素契约无效/)
    expect(() => createPreviewBrushTileMapV3([{
      resourceId: BRUSH,
      storage: 'rgba-float32',
      width: 2,
      height: 2,
      bytes: new ArrayBuffer(4),
    }])).toThrow(/像素契约无效/)
  })

  it('按 preview scale 将 document tile 边界映射到输出像素', () => {
    const baseData = new Float32Array(512 * 4)
    for (let offset = 0; offset < baseData.length; offset += 4) baseData[offset + 3] = 1
    const base = createFloat32PremultipliedRgbaTile(512, 1, 'linear-light', baseData)
    const brushData = new Float32Array(512 * 2 * 4)
    for (let offset = 0; offset < brushData.length; offset += 4) {
      brushData.set([0, 0.5, 0, 0.5], offset)
    }
    const node = {
      parameters: { tiles: { '0/1/0': BRUSH } },
    } as unknown as ImageEditRenderPlanNode
    const output = applyPreviewBrushTileReplacementsV3(
      node,
      base,
      createPreviewBrushTileMapV3([{
        resourceId: BRUSH,
        storage: 'rgba-float32',
        width: 512,
        height: 2,
        bytes: brushData.buffer,
      }]),
      { width: 512, height: 1, scaleX: 0.5, scaleY: 0.5 },
    )

    expect(pixel(output.data, output.width, 255)).toEqual([0, 0, 0, 1])
    expect(pixel(output.data, output.width, 256)).toEqual([0, 0.5, 0, 0.5])
  })
})
