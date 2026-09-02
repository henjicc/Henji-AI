/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  IMAGE_EDITOR_PRESENTATION_ATLAS_MAX_PAGES_V3,
  IMAGE_EDITOR_PRESENTATION_ATLAS_PAGE_SIZE_V3,
  ImageEditorPresentationAtlasV3,
} from './imageEditorPresentationAtlasV3'

function bitmap(width = 512, height = 512): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap
}

describe('ImageEditorPresentationAtlasV3', () => {
  const drawImage = vi.fn()

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    drawImage.mockClear()
  })

  it('页面固定为 4096 且相同瓦片只上传一次，四周写入 gutter', () => {
    const atlas = new ImageEditorPresentationAtlasV3()
    const first = atlas.store('generation:1:mip:0:x:0:y:0', bitmap())
    const second = atlas.store('generation:1:mip:0:x:0:y:0', bitmap())

    expect(first.source).toBe(second.source)
    expect(first.source.width).toBe(IMAGE_EDITOR_PRESENTATION_ATLAS_PAGE_SIZE_V3)
    expect(first.source.height).toBe(IMAGE_EDITOR_PRESENTATION_ATLAS_PAGE_SIZE_V3)
    expect(drawImage).toHaveBeenCalledTimes(9)
    expect(atlas.snapshot()).toMatchObject({ pageCount: 1, entryCount: 1 })
    atlas.dispose()
    expect(first.source.width).toBe(1)
    expect(first.source.height).toBe(1)
  })

  it('达到固定页数后按 LRU 复用槽位，不扩容或 resize 页面', () => {
    const atlas = new ImageEditorPresentationAtlasV3()
    for (let index = 0; index < 210; index += 1) atlas.store(`tile-${index}`, bitmap(32, 32))

    expect(atlas.snapshot()).toMatchObject({
      pageCount: IMAGE_EDITOR_PRESENTATION_ATLAS_MAX_PAGES_V3,
      entryCount: 196,
      estimatedBytes: 256 * 1024 * 1024,
    })
    expect(() => atlas.store('oversized', bitmap(513, 512))).toThrow('超过固定 atlas 槽位')
    atlas.dispose()
  })
})
