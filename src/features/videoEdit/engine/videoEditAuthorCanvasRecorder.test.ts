import { expect, it, vi } from 'vitest'
import { AuthorCanvasAsset, AuthorCanvasUnrecordable, recordAuthorCanvas, replayAuthorCanvas } from './videoEditAuthorCanvasRecorder'

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

it('读回状态与变换按录制位置回答；读像素或无法比对的对象不参与沿用', () => {
  vi.stubGlobal('DOMMatrix', class { a: number; b: number; c: number; d: number; e: number; f: number; constructor(m: number[]) { [this.a, this.b, this.c, this.d, this.e, this.f] = m } })
  const seen: unknown[] = []
  recordAuthorCanvas(size, measuring(), [2, 0, 0, 2, 4, 0], ctx => {
    ctx.save(); ctx.globalAlpha = .25; ctx.scale(3, 1); seen.push(ctx.globalAlpha, ctx.getTransform().a, ctx.getTransform().e)
    ctx.restore(); seen.push(ctx.globalAlpha, ctx.getTransform().a, ctx.canvas.width)
  })
  expect(seen).toEqual([.25, 6, 4, 1, 2, 100])
  expect(() => recordAuthorCanvas(size, measuring(), [1, 0, 0, 1, 0, 0], ctx => { ctx.getImageData(0, 0, 1, 1) })).toThrow(AuthorCanvasUnrecordable)
  const own = { width: 4, height: 4 } as unknown as CanvasImageSource
  const live = recordAuthorCanvas(size, measuring(), [1, 0, 0, 1, 0, 0], ctx => ctx.drawImage(own, 0, 0))
  expect(live.comparable).toBe(false)
  const drawn: unknown[] = []
  replayAuthorCanvas(live, { drawImage: (...args: unknown[]) => drawn.push(args) } as unknown as OffscreenCanvasRenderingContext2D, () => { throw new Error('no asset') })
  expect(drawn).toEqual([[own, 0, 0]])
  vi.unstubAllGlobals()
})
