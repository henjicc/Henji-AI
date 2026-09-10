import { model } from '@henjicc/ai-sdk/tool-models/fal/outpaint'
import { describe, expect, it } from 'vitest'
import { createOutpaintScene, scaleOutpaintScene, resizeOutpaintScene, resizeOutpaintFrame, moveOutpaintImage, translateOutpaintImage, zoomOutpaintImage, outpaintSceneToMargins, marginsToRect, rectToMargins, resolveOutpaintMargins, resolveOutpaintRequestParams } from './outpaintGeometry'

describe('扩图框与请求参数', () => {
  const image = { x: 300, y: 400, width: 1000, height: 1500 }
  it.each([{ width: 800, height: 1200 }, { width: 1600, height: 800 }])('小框内缩到最小后仍可拉满四边，实际留白合法 %o', source => {
    const viewport = { width: 600 * source.width / source.height, height: 600 }
    let scene = createOutpaintScene(source, viewport, resolveOutpaintMargins({}, source, 700), 700)
    for (let i = 0; i < 40; i++) scene = { ...scene, image: zoomOutpaintImage(scene, 100, source, 700) }
    const full = resizeOutpaintScene({ x: 0, y: 0, ...viewport }, scene.image, source, viewport, 700)
    expect(full.frame).toEqual({ x: 0, y: 0, ...viewport })
    expect(full.image.width).toBeGreaterThan(scene.image.width)
    expect(full.image.width / full.image.height).toBeCloseTo(source.width / source.height)
    const scale = full.image.width / source.width
    for (const margin of [full.image.x, full.image.y, viewport.width - full.image.x - full.image.width, viewport.height - full.image.y - full.image.height]) {
      expect(margin / scale).toBeGreaterThanOrEqual(-1e-8)
      expect(margin / scale).toBeLessThanOrEqual(700 + 1e-8)
    }
  })
  it.each([{ dx: 20, dy: 0 }, { dx: -20, dy: 0 }, { dx: 0, dy: 20 }, { dx: 0, dy: -20 }])('最大留白后仍可拖动，最小等比放大且接口留白合法 %o', ({ dx, dy }) => {
    const source = { width: 1000, height: 1500 }
    const frame = { x: 0, y: 0, width: 480, height: 580 }
    const initial = { x: 140, y: 140, width: 200, height: 300 }
    const moved = translateOutpaintImage({ ...initial, x: initial.x + dx, y: initial.y + dy }, frame, source, 700)
    expect(moved.x + moved.width / 2).toBeCloseTo(initial.x + initial.width / 2 + dx)
    expect(moved.y + moved.height / 2).toBeCloseTo(initial.y + initial.height / 2 + dy)
    expect(moved.width / moved.height).toBeCloseTo(source.width / source.height)
    expect(moved.width).toBeGreaterThan(initial.width)
    const scale = moved.width / source.width
    const margins = [moved.x, moved.y, frame.width - moved.x - moved.width, frame.height - moved.y - moved.height].map(value => value / scale)
    expect(margins.every(value => value >= -1e-8 && value <= 700 + 1e-8)).toBe(true)
    expect(Math.max(...margins)).toBeCloseTo(700)
  })
  it('普通图片平移不改变尺寸，碰到图片边界时停止', () => {
    const source = { width: 1000, height: 1500 }
    const frame = { x: 0, y: 0, width: 480, height: 580 }
    const initial = { x: 100, y: 100, width: 300, height: 450 }
    expect(translateOutpaintImage(initial, frame, source, 700)).toEqual(initial)
    const moved = translateOutpaintImage({ ...initial, x: 9999, y: 9999 }, frame, source, 700)
    expect(moved.width).toBe(initial.width)
    expect(moved.height).toBe(initial.height)
    expect(moved.x + moved.width).toBeCloseTo(frame.width)
    expect(moved.y + moved.height).toBeCloseTo(frame.height)
  })
  it('节点任意方向改变大小时，框与图片共用等比变换且输出参数不变', () => {
    const source = { width: 1000, height: 1500 }
    const viewport = { width: 600, height: 500 }
    const initial = createOutpaintScene(source, viewport, resolveOutpaintMargins({}, source, 700), 700)
    const scene = { ...initial, image: zoomOutpaintImage(initial, 100, source, 700) }
    const margins = outpaintSceneToMargins(scene, source, 700)
    for (const target of [{ width: 900, height: 550 }, { width: 350, height: 700 }, viewport]) {
      const resized = scaleOutpaintScene(scene, viewport, target)
      expect(resized.frame.width / resized.frame.height).toBeCloseTo(scene.frame.width / scene.frame.height)
      expect(resized.image.width / resized.image.height).toBeCloseTo(source.width / source.height)
      expect((resized.image.x - resized.frame.x) / resized.frame.width).toBeCloseTo((scene.image.x - scene.frame.x) / scene.frame.width)
      expect(outpaintSceneToMargins(resized, source, 700)).toEqual(margins)
    }
    expect(scaleOutpaintScene(scene, viewport, viewport)).toEqual(scene)
  })
  it.each([{ width: 1000, height: 1500 }, { width: 1600, height: 800 }])('最大框贴满工作面，拉边不移动或缩放图片 %o', source => {
    const viewport = { width: 600, height: 500 }
    const scene = createOutpaintScene(source, viewport, resolveOutpaintMargins({}, source, 700), 700)
    const frame = resizeOutpaintFrame({ x: -9999, y: -9999, width: 99999, height: 99999 }, scene.image, source, viewport, 700)
    expect(frame).toEqual({ x: 0, y: 0, ...viewport })
    const margins = outpaintSceneToMargins({ ...scene, frame }, source, 700)
    expect(Object.values(margins).every(value => value >= 0 && value <= 700)).toBe(true)
  })
  it('移动的是图片，固定框不变，碰到边界停止', () => {
    const source = { width: 1000, height: 1500 }
    const scene = createOutpaintScene(source, { width: 600, height: 500 }, resolveOutpaintMargins({}, source, 700), 700)
    const moved = moveOutpaintImage({ ...scene.image, x: -9999, y: 9999 }, scene.frame, source, 700)
    expect(moved.width).toBe(scene.image.width)
    expect(moved.x).toBe(scene.frame.x)
    expect(moved.y + moved.height).toBeCloseTo(scene.frame.y + scene.frame.height)
    const margins = outpaintSceneToMargins({ ...scene, image: moved }, source, 700)
    expect(margins.expandLeft).toBe(0)
    expect(margins.expandBottom).toBe(0)
  })
  it('滚轮改变图片与留白比例，API 参数与保存重开构图一致', () => {
    const source = { width: 1000, height: 1500 }
    const viewport = { width: 600, height: 500 }
    const scene = createOutpaintScene(source, viewport, resolveOutpaintMargins({}, source, 700), 700)
    const smaller = zoomOutpaintImage(scene, 100, source, 700)
    expect(smaller.width).toBeLessThan(scene.image.width)
    expect(smaller.width / smaller.height).toBeCloseTo(source.width / source.height)
    const margins = outpaintSceneToMargins({ ...scene, image: smaller }, source, 700)
    expect(margins.expandLeft).toBeGreaterThan(100)
    const restored = createOutpaintScene(source, viewport, margins, 700)
    expect(restored.frame.width / restored.image.width).toBeCloseTo(scene.frame.width / smaller.width, 2)
    let current = { ...scene, image: smaller }
    for (let index = 0; index < 100; index++) current = { ...current, image: zoomOutpaintImage(current, 100, source, 700) }
    expect(Object.values(outpaintSceneToMargins(current, source, 700)).every(value => value <= 700)).toBe(true)
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
