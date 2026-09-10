import { model } from '@henjicc/ai-sdk/tool-models/fal/outpaint'
import { describe, expect, it } from 'vitest'
import { constrainOutpaintRect, fitOutpaintView, zoomOutpaintView, marginsToRect, rectToMargins, resolveOutpaintMargins, resolveOutpaintRequestParams } from './outpaintGeometry'

describe('扩图框与请求参数', () => {
  const image = { x: 300, y: 400, width: 1000, height: 1500 }
  it('平移撞到四边后停止，不改变框的尺寸，也遵守单边上限', () => {
    for (const x of [-9999, 9999]) for (const y of [-9999, 9999]) {
      const rect = constrainOutpaintRect({ x, y, width: 2000, height: 2500 }, image, 700, true)
      expect(rect.width).toBe(2000)
      expect(rect.height).toBe(2500)
      const margins = rectToMargins(rect, image, 700)
      expect(margins.expandLeft + margins.expandRight).toBe(1000)
      expect(margins.expandTop + margins.expandBottom).toBe(1000)
    }
  })
  it('固定显示范围容纳接口最大扩图，滚轮只改变查看倍率', () => {
    const size = { width: 1000, height: 1500 }
    const viewport = { width: 600, height: 500 }
    const view = fitOutpaintView(size, viewport, 700)
    expect(-700 * view.scale + view.x).toBeGreaterThanOrEqual(24)
    expect((size.height + 700) * view.scale + view.y).toBeLessThanOrEqual(460.001)
    const margins = resolveOutpaintMargins({}, size, 700)
    const zoom = zoomOutpaintView(1, -100, size, margins, viewport, 700)
    expect(zoom).toBeGreaterThan(1)
    expect(fitOutpaintView(size, viewport, 700, zoom).scale).toBeGreaterThan(view.scale)
    expect(zoomOutpaintView(zoom, 100, size, margins, viewport, 700)).toBeCloseTo(1)
    const maxZoom = zoomOutpaintView(100, 0, size, margins, viewport, 700)
    const enlarged = fitOutpaintView(size, viewport, 700, maxZoom)
    expect((size.height + margins.expandBottom) * enlarged.scale + enlarged.y).toBeLessThanOrEqual(460.001)
  })
  it('放大查看后拉边受显示边缘限制，平移也不越界或改变尺寸', () => {
    const visible = { x: 150, y: 200 }
    const resized = constrainOutpaintRect({ x: -999, y: -999, width: 9999, height: 9999 }, image, 700, false, visible)
    expect(resized).toEqual({ x: 150, y: 200, width: 1300, height: 1900 })
    expect(constrainOutpaintRect({ ...resized, x: -9999, y: -9999 }, image, 700, true, visible)).toEqual(resized)
  })
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
