import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { CodeMotionSample } from '@/core/videoEdit/codeMaterial/motionSampling'
import { VideoEditAuthorRuntime } from './videoEditAuthorRuntime'
import type { AuthorLayer } from './videoEditAuthorModule'

/**
 * 软件栅格与合成替身：Canvas 只实现轴对齐的 fillRect / rect 裁剪（像素中心落在矩形里就上色），GPU 图层合成按位姿矩阵
 * 最近邻取样。矩形都落在偶数像素上，完整分辨率与 1/2 的画面都能逐像素算出参考结果。
 */
type Pixels = { width: number; height: number; pixels: Uint8Array }
const DEFAULTS = { fillStyle: 'c0', globalAlpha: 1, globalCompositeOperation: 'source-over', lineWidth: 1, lineJoin: 'miter', miterLimit: 10, shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, shadowColor: 'rgba(0, 0, 0, 0)', filter: 'none', font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', direction: 'ltr', letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto', fontStretch: 'normal', fontVariantCaps: 'normal', textRendering: 'auto', lang: 'inherit' }
class Raster implements Pixels {
  pixels: Uint8Array
  private w: number; private h: number
  constructor(width: number, height: number) { this.w = width; this.h = height; this.pixels = new Uint8Array(width * height) }
  get width(): number { return this.w }
  set width(value: number) { this.w = value; this.pixels = new Uint8Array(this.w * this.h) }
  get height(): number { return this.h }
  set height(value: number) { this.h = value; this.pixels = new Uint8Array(this.w * this.h) }
  getContext(): OffscreenCanvasRenderingContext2D { return context(this) as unknown as OffscreenCanvasRenderingContext2D }
}
function context(canvas: Raster) {
  let matrix = [1, 0, 0, 1, 0, 0], clip: number[] | undefined, path: number[] | undefined
  const stack: Array<{ matrix: number[]; clip?: number[]; state: Record<string, unknown> }> = []
  const device = (x: number, y: number, w: number, h: number): number[] => {
    if (matrix[1] || matrix[2]) throw new Error('替身只支持轴对齐变换')
    const xs = [matrix[0] * x + matrix[4], matrix[0] * (x + w) + matrix[4]], ys = [matrix[3] * y + matrix[5], matrix[3] * (y + h) + matrix[5]]
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  }
  const ctx: Record<string, unknown> = { ...DEFAULTS, canvas,
    reset() { canvas.pixels.fill(0); matrix = [1, 0, 0, 1, 0, 0]; clip = path = undefined; stack.length = 0; Object.assign(ctx, DEFAULTS) },
    save() { stack.push({ matrix: [...matrix], clip, state: Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, ctx[key]])) }) },
    restore() { const top = stack.pop(); if (top) { matrix = top.matrix; clip = top.clip; Object.assign(ctx, top.state) } },
    setTransform(...values: number[]) { matrix = values.slice(0, 6) },
    beginPath() { path = undefined },
    rect(x: number, y: number, w: number, h: number) { path = device(x, y, w, h) },
    clip() { const box = path ?? [0, 0, 0, 0]; clip = clip ? [Math.max(clip[0], box[0]), Math.max(clip[1], box[1]), Math.min(clip[2], box[2]), Math.min(clip[3], box[3])] : box },
    fillRect(x: number, y: number, w: number, h: number) {
      const box = device(x, y, w, h), color = Number(String(ctx.fillStyle).slice(1))
      for (let py = 0; py < canvas.height; py++) for (let px = 0; px < canvas.width; px++) {
        const cx = px + .5, cy = py + .5
        if (cx < box[0] || cx >= box[2] || cy < box[1] || cy >= box[3]) continue
        if (clip && (cx < clip[0] || cx >= clip[2] || cy < clip[1] || cy >= clip[3])) continue
        canvas.pixels[py * canvas.width + px] = color
      }
    },
    measureText: () => ({ width: 0 }),
  }
  return ctx
}
const gpu = vi.hoisted(() => ({ textures: [] as Array<{ width: number; height: number; mips: number }> }))
vi.mock('./videoEditAuthorGpu', () => ({ VideoEditAuthorGpu: class {
  async begin(target: Pixels) { target.pixels.fill(0) }
  draw(target: Pixels, width: number, height: number, source: { texture: Pixels; x: number; y: number; width: number; height: number }, samples: CodeMotionSample[], clip?: readonly number[], scale?: readonly [number, number]) {
    expect([width, height]).toEqual([target.width, target.height])
    const [sx, sy] = scale ?? [1, 1]
    for (const sample of samples) {
      if (!sample.pose) continue
      const m = sample.pose.matrix, a = m[0] * sx, d = m[3] * sy, e = m[4] * sx, f = m[5] * sy
      if (m[1] || m[2]) throw new Error('替身只支持轴对齐位姿')
      for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
        const cx = px + .5, cy = py + .5
        if (clip && (cx < clip[0] * sx || cx >= clip[2] * sx || cy < clip[1] * sy || cy >= clip[3] * sy)) continue
        const tx = Math.floor((cx - e) / a - source.x), ty = Math.floor((cy - f) / d - source.y)
        if (tx < 0 || ty < 0 || tx >= source.width || ty >= source.height) continue
        const value = source.texture.pixels[ty * source.texture.width + tx]
        if (value) target.pixels[py * width + px] = value
      }
    }
  }
  mipmaps() {} lens() {} finish() {} abandon() {} async dispose() {}
} }))
beforeEach(() => { vi.stubGlobal('OffscreenCanvas', Raster); gpu.textures.length = 0 })
afterEach(() => { vi.unstubAllGlobals() })

function device(): GpuDevice {
  return {
    createTexture: ({ size: [width, height], mipLevelCount = 1 }: { size: [number, number]; mipLevelCount?: number }) => {
      gpu.textures.push({ width, height, mips: mipLevelCount })
      return { width, height, pixels: new Uint8Array(width * height), createView: () => ({}), destroy() {} }
    },
    queue: {
      copyExternalImageToTexture: ({ source, origin = [0, 0] }: { source: Pixels; origin?: [number, number] }, { texture }: { texture: Pixels }, [width, height]: [number, number]) => {
        texture.pixels.fill(0)
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) texture.pixels[y * texture.width + x] = source.pixels[(y + origin[1]) * source.width + x + origin[0]]
      },
    },
  } as unknown as GpuDevice
}
const target = (width: number, height: number) => ({ width, height, pixels: new Uint8Array(width * height), createView: () => ({}), destroy() {} })
/** 参考画面：矩形按图层顺序直接画到 scale 倍的画幅上。 */
function reference(rects: ReadonlyArray<readonly [number, number, number, number, number]>, width: number, height: number, scale: number): Uint8Array {
  const pixels = new Uint8Array(width * height)
  for (const [color, x0, y0, x1, y1] of rects) for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const cx = (px + .5) / scale, cy = (py + .5) / scale
    if (cx >= x0 && cx < x1 && cy >= y0 && cy < y1) pixels[py * width + px] = color
  }
  return pixels
}
const info = (frame: number) => ({ time: frame / 60, frameDuration: 1 / 60, clip: { time: frame / 60, duration: 5 } })
/** 背景、卡片静止；信号点每帧挪 2 像素；带位姿的方块；一层用了换算不了的滤镜（只能按画布像素栅格）。 */
const layers = (): AuthorLayer[] => [
  { id: 'bg', draw(ctx) { ctx.fillStyle = 'c1'; ctx.fillRect(0, 0, 200, 100) } },
  { id: 'card', draw(ctx) { ctx.fillStyle = 'c2'; ctx.fillRect(20, 20, 60, 40) } },
  { id: 'dot', draw(ctx, t) { ctx.fillStyle = 'c3'; ctx.fillRect(100 + Math.round(t * 60) * 2, 60, 10, 10) } },
  { id: 'box', bounds: [0, 0, 20, 20], pose: () => ({ x: 150, y: 10 }), draw(ctx) { ctx.fillStyle = 'c4'; ctx.fillRect(0, 0, 20, 20) } },
  { id: 'glow', draw(ctx) { ctx.filter = 'url(#glow)'; ctx.fillStyle = 'c5'; ctx.fillRect(160, 70, 20, 20) } },
]
const expected = (frame: number): Array<[number, number, number, number, number]> => [[1, 0, 0, 200, 100], [2, 20, 20, 80, 60], [3, 100 + frame * 2, 60, 110 + frame * 2, 70], [4, 150, 10, 170, 30], [5, 160, 70, 180, 90]]

it('静止层只栅格、上传有内容的范围：停稳后上传字节大幅下降，合成画面与整幅栅格逐像素相同', async () => {
  const runtime = new VideoEditAuthorRuntime(device(), { name: '信号点', layers })
  const output = target(200, 100)
  try {
    let last
    for (let frame = 0; frame < 6; frame++) {
      last = await runtime.render(output, 200, 100, {}, {}, info(frame), undefined, undefined, false)
      expect(output.pixels).toEqual(reference(expected(frame), 200, 100, 1))
    }
    // 只有信号点所在的一小块每帧重画、上传；以前这一组按整帧画布上传 200×100×4 字节
    expect(last).toMatchObject({ redrawn: 1, uploads: 1 })
    expect(last!.uploadBytes).toBeGreaterThan(0)
    expect(last!.uploadBytes).toBeLessThan(200 * 100 * 4 / 20)
  } finally { await runtime.dispose() }
})

it('1/2 回放分辨率：代码图层的栅格与目标都减半，作者坐标不变，画面等于完整画面的缩小', async () => {
  const runtime = new VideoEditAuthorRuntime(device(), { name: '信号点', layers })
  const half = target(100, 50)
  try {
    for (let frame = 0; frame < 4; frame++) {
      const statistics = await runtime.render(half, 200, 100, {}, {}, info(frame), undefined, undefined, false, { width: 100, height: 50 })
      expect(half.pixels).toEqual(reference(expected(frame), 100, 50, .5))
      if (frame === 3) expect(statistics!.uploadBytes).toBeLessThan(100 * 50 * 4 / 10)
    }
    // 能换算的静止组栅格不超过一半画幅；带位姿的方块按 1 倍（完整分辨率是 2 倍）；滤镜换算不了的层按画布像素栅格并带 mip
    const stills = gpu.textures.filter(texture => texture.mips === 1)
    expect(stills.every(texture => texture.width <= 100 && texture.height <= 50)).toBe(true)
    expect(gpu.textures).toContainEqual(expect.objectContaining({ width: 24, height: 24 }))
    expect(gpu.textures.some(texture => texture.mips > 1 && texture.width > 24)).toBe(true)
    // 切回完整分辨率：不沿用缩小的栅格
    const full = target(200, 100)
    await runtime.render(full, 200, 100, {}, {}, info(4), undefined, undefined, false)
    expect(full.pixels).toEqual(reference(expected(4), 200, 100, 1))
    expect(gpu.textures).toContainEqual(expect.objectContaining({ width: 44, height: 44 }))
  } finally { await runtime.dispose() }
})

it('原生 GPU 入口在 1/2 时拿到缩小后的 target 与像素尺寸，元素选框仍按画布像素', async () => {
  const draw = vi.fn()
  const runtime = new VideoEditAuthorRuntime({} as GpuDevice, { name: '着色器', createWebGPU: () => ({ draw }) })
  const half = target(960, 540)
  try {
    await runtime.render(half, 1920, 1080, {}, {}, { ...info(0), renderScale: .5 }, undefined, { frames: [], images: {} }, true, { width: 960, height: 540 })
    expect(draw).toHaveBeenCalledWith(half, 0, {}, 960, 540, {}, expect.objectContaining({ renderScale: .5 }), { frames: [], images: {} })
    expect(runtime.observeElements()[0].bounds).toEqual([0, 0, 1920, 1080])
  } finally { await runtime.dispose() }
})
