import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ pixels: new Uint8ClampedArray(64 * 64 * 4) }))
vi.mock('../../ui/specialInterfaces/multiAngle/imageBlockTextures', () => ({ sampleImageBlock: () => fixture.pixels }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn() }) }))

describe('扩图模糊预览缓存', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const drawImage = vi.fn()
  const encode = vi.fn(() => 'data:image/png;base64,fixture')
  const canvases: { width: number; height: number }[] = []
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    canvases.length = 0
    fixture.pixels.fill(255)
    vi.stubGlobal('crypto', webcrypto)
    vi.stubGlobal('document', { createElement: () => {
      const canvas = { width: 0, height: 0, toDataURL: encode, getContext: () => ({
        createImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }), putImageData: vi.fn(), drawImage, filter: '',
      }) }
      canvases.push(canvas)
      return canvas
    } })
  })
  it('相同像素跨节点复用一次烘焙，内容替换后失效，临时画布释放', async () => {
    const { getOutpaintPreview } = await import('./outpaintPreviewTexture')
    const image = {} as HTMLImageElement
    await Promise.all([getOutpaintPreview(image), getOutpaintPreview(image)])
    expect(encode).toHaveBeenCalledTimes(1)
    expect(drawImage).toHaveBeenCalledTimes(10)
    expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true)
    fixture.pixels[0] = 0
    await getOutpaintPreview(image)
    expect(encode).toHaveBeenCalledTimes(2)
  })
  it('烘焙扩展四边和四角，采样不越界且输出固定低分辨率', async () => {
    const { bakeOutpaintPreview } = await import('./outpaintPreviewTexture')
    encode.mockImplementationOnce(() => {
      expect(canvases[2]).toMatchObject({ width: 192, height: 192 })
      return 'data:image/png;base64,fixture'
    })
    bakeOutpaintPreview(fixture.pixels)
    const patches = drawImage.mock.calls.slice(0, 9)
    expect(patches.map(call => call.slice(1, 5))).toEqual([
      [0, 0, 1, 1], [0, 0, 64, 1], [63, 0, 1, 1],
      [0, 0, 1, 64], [0, 0, 64, 64], [63, 0, 1, 64],
      [0, 63, 1, 1], [0, 63, 64, 1], [63, 63, 1, 1],
    ])
  })
  it('缓存容量受限，淘汰后只重新生成被淘汰内容', async () => {
    const { getOutpaintPreview } = await import('./outpaintPreviewTexture')
    const image = {} as HTMLImageElement
    for (let i = 0; i < 25; i++) { fixture.pixels[0] = i; await getOutpaintPreview(image) }
    await getOutpaintPreview(image)
    expect(encode).toHaveBeenCalledTimes(25)
    fixture.pixels[0] = 0
    await getOutpaintPreview(image)
    expect(encode).toHaveBeenCalledTimes(26)
  })
})
