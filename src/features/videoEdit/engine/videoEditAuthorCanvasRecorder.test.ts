import { expect, it, vi } from 'vitest'
import { AuthorCanvasAsset, AuthorCanvasUnrecordable, authorCanvasContext, recordAuthorCanvas, replayAuthorCanvas } from './videoEditAuthorCanvasRecorder'

function measuring(): OffscreenCanvasRenderingContext2D {
  return { reset: vi.fn(), font: '10px sans-serif', fillStyle: 'black', globalAlpha: 1, getImageData: vi.fn(), measureText: vi.fn(function (this: { font: string }, text: string) { return { width: text.length * Number.parseFloat(this.font) } }) } as unknown as OffscreenCanvasRenderingContext2D
}
const size = { width: 100, height: 50 }
const scene = (ctx: OffscreenCanvasRenderingContext2D, label: string, image?: CanvasImageSource): void => {
  ctx.save(); ctx.translate(10, 5); ctx.font = '20px sans-serif'
  const width = ctx.measureText(label).width
  const gradient = ctx.createLinearGradient(0, 0, width, 0); gradient.addColorStop(0, 'red'); gradient.addColorStop(1, 'blue')
  ctx.fillStyle = gradient; ctx.globalAlpha = ctx.globalAlpha * .5; ctx.fillText(label, 0, 0)
  if (image) ctx.drawImage(image, 0, 0, 10, 10)
  ctx.restore()
}

it('同样的绘制录成同样的指令；重放按原顺序作用在真实画布，图片与渐变换成本帧对象', () => {
  const asset = new AuthorCanvasAsset('logo', 32, 32)
  const a = recordAuthorCanvas(size, measuring(), [2, 0, 0, 2, 0, 0], ctx => scene(ctx, 'AB', asset as unknown as CanvasImageSource))
  const b = recordAuthorCanvas(size, measuring(), [2, 0, 0, 2, 0, 0], ctx => scene(ctx, 'AB', asset as unknown as CanvasImageSource))
  const c = recordAuthorCanvas(size, measuring(), [2, 0, 0, 2, 0, 0], ctx => scene(ctx, 'ABC', asset as unknown as CanvasImageSource))
  expect(a.comparable).toBe(true); expect(a.signature).toBe(b.signature); expect(c.signature).not.toBe(a.signature)
  expect([...a.assets]).toEqual(['logo'])
  const calls: unknown[][] = []
  const gradient = { addColorStop: vi.fn((...args: unknown[]) => calls.push(['stop', ...args])) }
  const real = new Proxy({} as Record<string, unknown>, {
    get: (_, name: string) => name === 'createLinearGradient' ? (...args: unknown[]) => { calls.push([name, ...args]); return gradient } : (...args: unknown[]) => calls.push([name, ...args]),
    set: (_, name: string, value) => { calls.push(['set', name, value]); return true },
  }) as unknown as OffscreenCanvasRenderingContext2D
  const bitmap = { frame: 1 } as unknown as CanvasImageSource
  replayAuthorCanvas(a, real, key => key === 'logo' ? bitmap : undefined as never)
  expect(calls).toEqual([
    ['save'], ['translate', 10, 5], ['set', 'font', '20px sans-serif'],
    ['createLinearGradient', 0, 0, 40, 0], ['stop', 0, 'red'], ['stop', 1, 'blue'],
    ['set', 'fillStyle', gradient], ['set', 'globalAlpha', .5], ['fillText', 'AB', 0, 0], ['drawImage', bitmap, 0, 0, 10, 10], ['restore'],
  ])
})

it('读回状态与变换按录制位置回答（变换按画布像素，不含宿主的栅格变换）；读像素或无法比对的对象不参与沿用', () => {
  vi.stubGlobal('DOMMatrix', class { a: number; b: number; c: number; d: number; e: number; f: number; constructor(m: number[]) { [this.a, this.b, this.c, this.d, this.e, this.f] = m } })
  const seen: unknown[] = []
  recordAuthorCanvas(size, measuring(), [2, 0, 0, 2, 4, 0], ctx => {
    ctx.save(); ctx.globalAlpha = .25; ctx.scale(3, 1); seen.push(ctx.globalAlpha, ctx.getTransform().a, ctx.getTransform().e)
    ctx.restore(); seen.push(ctx.globalAlpha, ctx.getTransform().a, ctx.canvas.width)
  })
  expect(seen).toEqual([.25, 3, 0, 1, 1, 100])
  expect(() => recordAuthorCanvas(size, measuring(), [1, 0, 0, 1, 0, 0], ctx => { ctx.getImageData(0, 0, 1, 1) })).toThrow(AuthorCanvasUnrecordable)
  const own = { width: 4, height: 4 } as unknown as CanvasImageSource
  const live = recordAuthorCanvas(size, measuring(), [1, 0, 0, 1, 0, 0], ctx => ctx.drawImage(own, 0, 0))
  expect(live.comparable).toBe(false)
  const drawn: unknown[] = []
  replayAuthorCanvas(live, { drawImage: (...args: unknown[]) => drawn.push(args) } as unknown as OffscreenCanvasRenderingContext2D, () => { throw new Error('no asset') })
  expect(drawn).toEqual([[own, 0, 0]])
  vi.unstubAllGlobals()
})

it('作者的 setTransform/resetTransform 相对宿主的栅格变换生效：运动层里也按画布像素画', () => {
  vi.stubGlobal('DOMMatrix', class { a: number; b: number; c: number; d: number; e: number; f: number; constructor(m: number[]) { [this.a, this.b, this.c, this.d, this.e, this.f] = m } })
  const raster: [number, number, number, number, number, number] = [2, 0, 0, 2, 10, 20]
  const seen: unknown[] = []
  const recording = recordAuthorCanvas(size, measuring(), raster, ctx => {
    ctx.setTransform(3, 0, 0, 3, 5, 0); seen.push(ctx.getTransform().a, ctx.getTransform().e)
    ctx.fillRect(0, 0, 1, 1); ctx.resetTransform(); seen.push(ctx.getTransform().a); ctx.setTransform({ a: 1, b: 0, c: 0, d: 1, e: 7, f: 0 }); ctx.fillRect(0, 0, 1, 1)
  })
  expect(seen).toEqual([3, 5, 1])
  const calls: unknown[][] = []
  const real = new Proxy({} as Record<string, unknown>, { get: (_, name: string) => (...args: unknown[]) => calls.push([name, ...args]) }) as unknown as OffscreenCanvasRenderingContext2D
  replayAuthorCanvas(recording, real, () => { throw new Error('no asset') }, raster)
  expect(calls).toEqual([['setTransform', 6, 0, 0, 6, 20, 20], ['fillRect', 0, 0, 1, 1], ['setTransform', 2, 0, 0, 2, 10, 20], ['setTransform', 2, 0, 0, 2, 24, 20], ['fillRect', 0, 0, 1, 1]])
  // 录制不了、直接画的图层也一样
  const direct: unknown[][] = []
  let current = [1, 0, 0, 1, 0, 0]
  const canvas = { setTransform: (...m: number[]) => { current = m; direct.push(m) }, getTransform: () => { const [a, b, c, d, e, f] = current; return { a, b, c, d, e, f } } } as unknown as OffscreenCanvasRenderingContext2D
  const wrapped = authorCanvasContext(canvas, raster)
  wrapped.setTransform(1, 0, 0, 1, 3, 4); expect(direct.at(-1)).toEqual([2, 0, 0, 2, 16, 28]); expect(wrapped.getTransform().e).toBe(3)
  wrapped.resetTransform(); expect(direct.at(-1)).toEqual(raster)
  authorCanvasContext(canvas, [1, 0, 0, 1, 0, 0]).setTransform(1, 0, 0, 1, 3, 4); expect(direct.at(-1)).toEqual([1, 0, 0, 1, 3, 4])
  vi.unstubAllGlobals()
})

it('作者缓存到模块变量的渐变与图案，下一帧照样画对：录制时按定义重建，直接画时换成真实对象', () => {
  let cached: { gradient?: CanvasGradient; pattern?: CanvasPattern } = {}
  const tile = { width: 4, height: 4 } as unknown as CanvasImageSource
  const draw = (ctx: OffscreenCanvasRenderingContext2D): void => {
    if (!cached.gradient) { cached.gradient = ctx.createLinearGradient(0, 0, 10, 0); cached.gradient.addColorStop(0, 'red'); cached.gradient.addColorStop(1, 'blue') }
    ctx.fillStyle = cached.gradient; ctx.fillRect(0, 0, 10, 10)
  }
  const first = recordAuthorCanvas(size, measuring(), [1, 0, 0, 1, 0, 0], draw)
  const second = recordAuthorCanvas(size, measuring(), [1, 0, 0, 1, 0, 0], draw)
  expect(second.comparable).toBe(true); expect(second.signature).toBe(first.signature)
  const calls: unknown[][] = []
  const gradient = { addColorStop: (...args: unknown[]) => calls.push(['stop', ...args]) }
  const real = new Proxy({} as Record<string, unknown>, {
    get: (_, name: string) => name === 'createLinearGradient' ? (...args: unknown[]) => { calls.push([name, ...args]); return gradient } : (...args: unknown[]) => calls.push([name, ...args]),
    set: (_, name: string, value) => { calls.push(['set', name, value]); return true },
  }) as unknown as OffscreenCanvasRenderingContext2D
  replayAuthorCanvas(second, real, () => { throw new Error('no asset') })
  expect(calls).toEqual([['createLinearGradient', 0, 0, 10, 0], ['stop', 0, 'red'], ['stop', 1, 'blue'], ['set', 'fillStyle', gradient], ['fillRect', 0, 0, 10, 10]])
  // 直接画的图层拿到录制期缓存的对象：换成真实画布上的渐变与图案
  cached = {}
  recordAuthorCanvas(size, measuring(), [1, 0, 0, 1, 0, 0], ctx => { draw(ctx); cached.pattern = ctx.createPattern(tile, 'repeat')! })
  const set: Record<string, unknown> = {}
  const canvas = { createLinearGradient: () => ({ stops: [] as unknown[], addColorStop(...args: unknown[]) { this.stops.push(args) } }), createPattern: (...args: unknown[]) => ({ pattern: args }) }
  const wrapped = authorCanvasContext(new Proxy(canvas, { set: (target, name: string, value) => { set[name] = value; return true } }) as unknown as OffscreenCanvasRenderingContext2D, [1, 0, 0, 1, 0, 0])
  wrapped.fillStyle = cached.gradient!; wrapped.strokeStyle = cached.pattern!
  expect(set.fillStyle).toEqual({ stops: [[0, 'red'], [1, 'blue']], addColorStop: expect.any(Function) })
  expect(set.strokeStyle).toEqual({ pattern: [tile, 'repeat'] })
})
