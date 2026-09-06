import { describe, expect, it, vi } from 'vitest'
import type { ImageEditorV3PyramidDescriptor } from '@/platform/contracts/imageEditorV3'
import { createRasterSourceBrushFixtureV3 as fixture } from './rasterBrushSourceGeometryV3.testSupport'

describe('真实下笔使用独立原图、存储域和图层几何', () => {
  it.each([{ source: 16, canvas: 64, x: 48, key: '0/0/0', width: 64 },
    { source: 640, canvas: 64, x: 500, key: '0/0/0', width: 512 },
    { source: 16, canvas: 1024, x: 550, key: '0/1/1', width: 512 }])(
    '$source原图/$canvas画布，实际stroke在局部$x落笔且可撤销', async ({ source, canvas, x, key, width }) => {
      const value = fixture(source, canvas)
      value.stroke.begin()
      await value.stroke.append([{ x, y: x, screenX: x * canvas / source, screenY: x * canvas / source }])
      const result = await value.stroke.finish()
      expect(result?.changes).toHaveLength(1)
      const tile = value.stored.get(key)!
      expect(tile.width).toBe(width)
      expect(tile.data[((x % 512) * width + x % 512) * 4]).toBe(1)
      expect(value.readSourcePyramid).toHaveBeenCalledOnce()
      expect(value.readSourceTile).toHaveBeenCalledTimes(x >= 512 && source < 512 ? 0 : 1)
      expect(value.bus.getSnapshot().history.undoCount).toBe(1)
      value.bus.undo()
      const layer = value.bus.getSnapshot().document.layers[0]
      expect(layer.type === 'raster' && layer.tiles).toEqual({})
    })

  it('元数据等待中取消不会建像素资源、提交历史或保留预览，迟到结果不能复活笔画', async () => {
    const value = fixture(640, 64)
    let resolve!: (pyramid: ImageEditorV3PyramidDescriptor) => void
    value.readSourcePyramid.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    value.stroke.begin()
    const append = value.stroke.append([{ x: 500, y: 500, screenX: 50, screenY: 50 }])
    const rejection = expect(append).rejects.toThrow()
    await vi.waitFor(() => expect(value.readSourcePyramid).toHaveBeenCalledOnce())
    value.stroke.cancel()
    resolve(value.pyramid)
    await rejection
    expect(value.readSourceTile).not.toHaveBeenCalled()
    expect(value.persistTiles).not.toHaveBeenCalled()
    expect(value.bus.getSnapshot().history.undoCount).toBe(0)
    expect(value.bus.getSnapshot().previewOverrides).toEqual({})
  })
})
