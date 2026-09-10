import { describe, expect, it } from 'vitest'
import { edgeTexturePixels } from './imageBlockTextures'

describe('图片块边缘延伸贴图', () => {
  it('侧面仅复制对应边缘，沿厚度方向延伸并保持上下左右顺序', () => {
    const width = 5; const height = 5
    const source = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) source.set([x * 40, y * 40, 90, 255], (y * width + x) * 4)
    for (const face of ['left', 'right', 'top', 'bottom'] as const) {
      const output = edgeTexturePixels(source, width, height, face, 5)
      for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
        const sx = face === 'left' ? 0 : face === 'right' ? 4 : x
        const sy = face === 'top' ? 0 : face === 'bottom' ? 4 : y
        expect([...output.slice((y * 5 + x) * 4, (y * 5 + x) * 4 + 4)]).toEqual([sx * 40, sy * 40, 90, 255])
      }
    }
  })
  it('背面仅融合边缘颜色，中心主体变化不会被复制到背面', () => {
    const source = new Uint8ClampedArray(5 * 5 * 4)
    for (let i = 0; i < source.length; i += 4) source.set([210, 100, 40, 255], i)
    const before = edgeTexturePixels(source, 5, 5, 'back')
    source.set([0, 255, 255, 255], (2 * 5 + 2) * 4)
    expect(edgeTexturePixels(source, 5, 5, 'back')).toEqual(before)
    expect([...before.slice(0, 4)]).toEqual([210, 100, 40, 255])
  })
  it('透明边缘不产生混色黑边', () => {
    const source = new Uint8ClampedArray(3 * 3 * 4)
    source.set([255, 80, 20, 255], (0 * 3 + 1) * 4)
    const output = edgeTexturePixels(source, 3, 3, 'back', 3)
    const center = [...output.slice(16, 20)]
    expect(center.slice(0, 3)).toEqual([255, 80, 20])
    expect(center[3]).toBeGreaterThan(0)
    expect(center[3]).toBeLessThan(255)
  })
})
