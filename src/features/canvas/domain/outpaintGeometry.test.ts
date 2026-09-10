import { model } from '@henjicc/ai-sdk/tool-models/fal/outpaint'
import { describe, expect, it } from 'vitest'
import { marginsToRect, rectToMargins, resolveOutpaintMargins, resolveOutpaintRequestParams } from './outpaintGeometry'

describe('扩图框与请求参数', () => {
  const image = { x: 300, y: 400, width: 1000, height: 1500 }
  it('初始宽高等比例扩展 20%，四边像素不会和 zoom out 叠加', () => {
    const margins = resolveOutpaintMargins({}, image, 700)
    expect(margins).toEqual({ expandLeft: 100, expandRight: 100, expandTop: 150, expandBottom: 150 })
    expect(resolveOutpaintRequestParams({ zoomOutPercentage: 20 }, image, 700)).toEqual({ ...margins, zoomOutPercentage: 0 })
    expect(marginsToRect(margins, image)).toEqual({ x: 200, y: 250, width: 1200, height: 1800 })
  })
  it('超大原图初始扩展保持同比例并遵守每边上限', () => {
    const margins = resolveOutpaintMargins({}, { width: 10000, height: 20000 }, 700)
    expect(margins).toEqual({ expandLeft: 350, expandRight: 350, expandTop: 700, expandBottom: 700 })
  })
  it('向内拖不能裁掉原图，向外不能超出接口上限', () => {
    expect(rectToMargins({ x: 800, y: 700, width: 200, height: 300 }, image, 700))
      .toEqual({ expandLeft: 0, expandRight: 0, expandTop: 0, expandBottom: 0 })
    expect(rectToMargins({ x: -2000, y: -2000, width: 9000, height: 9000 }, image, 700))
      .toEqual({ expandLeft: 700, expandRight: 700, expandTop: 700, expandBottom: 700 })
  })
  it('图框参数交给现有 SDK 后生成正确的四边请求，不叠加缩小', () => {
    const params = resolveOutpaintRequestParams({ expandLeft: 0, expandRight: 240, expandTop: 40, expandBottom: 90 }, image, 700)
    expect(model.request?.builder?.({ image: ['source.png'], ...params })).toEqual({
      image_url: 'source.png', expand_left: 0, expand_right: 240, expand_top: 40, expand_bottom: 90, zoom_out_percentage: 0,
    })
  })
  it('不对称扩展、保存重开和请求构图完全一致', () => {
    const margins = { expandLeft: 23, expandRight: 500, expandTop: 0, expandBottom: 171 }
    const saved = resolveOutpaintMargins(JSON.parse(JSON.stringify(margins)), image, 700)
    expect(rectToMargins(marginsToRect(saved, image), image, 700)).toEqual(margins)
  })
})
