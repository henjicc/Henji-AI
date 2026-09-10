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
  it('背面完整镜像主图，保留中间主体与上下顺序', () => {
    const source = new Uint8ClampedArray(5 * 5 * 4)
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) source.set([x * 40, y * 40, 90, 255], (y * 5 + x) * 4)
    const output = edgeTexturePixels(source, 5, 5, 'back', 5)
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      expect([...output.slice((y * 5 + x) * 4, (y * 5 + x) * 4 + 4)]).toEqual([(4 - x) * 40, y * 40, 90, 255])
    }
  })
  it('透明边缘不产生混色黑边', () => {
    const source = new Uint8ClampedArray(3 * 3 * 4)
    source.set([255, 80, 20, 255], (0 * 3 + 1) * 4)
    const output = edgeTexturePixels(source, 3, 3, 'back', 3)
    const center = [...output.slice(16, 20)]
    expect(center).toEqual([0, 0, 0, 0])
    expect([...output.slice(4, 8)]).toEqual([255, 80, 20, 255])
  })
})
