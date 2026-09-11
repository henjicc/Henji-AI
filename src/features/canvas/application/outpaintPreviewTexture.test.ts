import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ pixels: new Uint8ClampedArray(64 * 64 * 4) }))
vi.mock('../ui/specialInterfaces/multiAngle/imageBlockTextures', () => ({ sampleImageBlock: () => fixture.pixels }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn() }) }))

describe('扩图模糊预览缓存', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const drawImage = vi.fn()
  const encode = vi.fn(() => 'data:image/png;base64,fixture')
  const canvases: { width: number; height: number }[] = []
  const image = { naturalWidth: 800, naturalHeight: 1200 } as HTMLImageElement
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    canvases.length = 0
    fixture.pixels.fill(255)
    vi.stubGlobal('crypto', webcrypto)
    vi.stubGlobal('document', { createElement: () => {
      const canvas = { width: 0, height: 0, toDataURL: encode, getContext: () => ({
        createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData: vi.fn(), drawImage, filter: '',
      }) }
      canvases.push(canvas)
      return canvas
    } })
  })
  it('相同像素跨节点复用一次烘焙，内容替换后失效，临时画布释放', async () => {
    const { getOutpaintPreview } = await import('./outpaintPreviewTexture')
    await Promise.all([getOutpaintPreview(image, 700), getOutpaintPreview(image, 700)])
    expect(encode).toHaveBeenCalledTimes(1)
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true)
    fixture.pixels[0] = 0
    await getOutpaintPreview(image, 700)
    expect(encode).toHaveBeenCalledTimes(2)
  })
  it('原图不扭曲，四边过渡连续，外部线条弯曲而非直线拉伸', async () => {
    const { outpaintSamplePosition: sample } = await import('./outpaintPreviewTexture')
    expect(sample(0.25, 0.75)).toEqual([0.25, 0.75])
    for (const [u, v, du, dv] of [[0, 0.5, -0.00001, 0], [1, 0.5, 0.00001, 0], [0.5, 0, 0, -0.00001], [0.5, 1, 0, 0.00001]]) {
      const edge = sample(u, v); const outside = sample(u + du, v + dv)
      expect(outside[0]).toBeCloseTo(edge[0], 4)
      expect(outside[1]).toBeCloseTo(edge[1], 4)
    }
    expect(Math.abs(sample(0.5, 1.5)[0] - sample(0.5, 1.1)[0])).toBeGreaterThan(0.02)
    for (const u of [-10, -1, 0, 0.5, 1, 2, 10]) for (const v of [-10, 0, 1, 10]) {
      expect(sample(u, v).every(value => value >= 0 && value <= 1)).toBe(true)
    }
  })
  it('缓存容量受限，淘汰后只重新生成被淘汰内容', async () => {
    const { getOutpaintPreview } = await import('./outpaintPreviewTexture')
    for (let i = 0; i < 25; i++) { fixture.pixels[0] = i; await getOutpaintPreview(image, 700) }
    await getOutpaintPreview(image, 700)
    expect(encode).toHaveBeenCalledTimes(25)
    fixture.pixels[0] = 0
    await getOutpaintPreview(image, 700)
    expect(encode).toHaveBeenCalledTimes(26)
  })
})
