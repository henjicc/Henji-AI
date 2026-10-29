import { authorModuleTextLayouts, observeTextLayouts } from '@/core/videoEdit/textDrawObservation'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild-wasm'
import { makeCodeMaterialDefinition, appendCodeMaterialVersion } from '@/core/videoEdit/codeMaterialVersions'
import { addressCodeMaterialFiles, documentCodeSourceResolver } from '@/core/videoEdit/codeMaterial/sources'
import { AUTHOR_LIBRARIES } from '@/core/videoEdit/codeMaterial/authorLibraries'
import { collectVideoEditCodeMotion } from '@/core/videoEdit/codeMotionReview'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition } from '@/core/videoEdit/document'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'
import { bundleAuthorFiles } from './videoEditAuthorBundle'
import { authorEffectMetadata } from './videoEditAuthorParameters'
import type { AuthorModule } from './videoEditAuthorModule'
import { afterEach, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditAuthorRuntime } from './videoEditAuthorRuntime'
import { drawText, layoutText } from '../authorLibraries/text'
import { layoutBoxes, ready as flexReady } from '../authorLibraries/flex'
const { layerDraw } = vi.hoisted(() => ({ layerDraw: vi.fn() }))

vi.mock('./videoEditAuthorGpu', () => ({ VideoEditAuthorGpu: class {
  begin = vi.fn(); draw = layerDraw; mipmaps = vi.fn(); lens = vi.fn(); finish = vi.fn(); abandon = vi.fn(); dispose = vi.fn()
} }))

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('keeps Canvas image sampling independent of shared GPU uploads: a fresh image only when the layer is drawn again', async () => {
  class Bitmap {
    width = 32; height = 16
    close = vi.fn()
  }
  const context = { reset: vi.fn(), save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(() => ({ width: 32, height: 16 })) }
  class Canvas {
    constructor(public width: number, public height: number) {}
    getContext(): typeof context { return context }
  }
  vi.stubGlobal('ImageBitmap', Bitmap); vi.stubGlobal('OffscreenCanvas', Canvas)
  const createBitmap = vi.fn(async () => new Bitmap())
  vi.stubGlobal('createImageBitmap', createBitmap)
  const upload = vi.fn()
  const source = new Bitmap(), replacement = new Bitmap()
  const draw = vi.fn((ctx: OffscreenCanvasRenderingContext2D, _time: number, _params: unknown, _width: number, _height: number, assets: Record<string, CanvasImageSource>) => ctx.drawImage(assets.logo, 0, 0))
  const runtime = new VideoEditAuthorRuntime({
    createTexture: () => ({ destroy: vi.fn() }),
    queue: { copyExternalImageToTexture: upload },
  } as unknown as GpuDevice, { name: '图片采样', draw })
  const target = { createView: () => ({}), destroy() {} }
  const info = { time: 0, frameDuration: 1 / 60, clip: { time: 0, duration: 1 } }
  const render = (image: Bitmap) => runtime.render(target, 100, 50, {}, { logo: image as unknown as ImageBitmap }, info)
  await render(source)
  const first = await createBitmap.mock.results[0].value
  // The author draw is replayed with this frame's own bitmap, never the shared source.
  expect(context.drawImage).toHaveBeenLastCalledWith(first, 0, 0)
  expect(first).not.toBe(source); expect(first.close).toHaveBeenCalledOnce()
  // The same commands on the same pixels: the uploaded raster is reused, no copy, raster or upload.
  await render(source)
  expect(draw).toHaveBeenCalledTimes(2); expect(createBitmap).toHaveBeenCalledOnce()
  expect(context.drawImage).toHaveBeenCalledTimes(2); expect(upload).toHaveBeenCalledOnce()
  expect(context.getImageData).toHaveBeenCalledOnce()
  // A replaced image changes the content: new pixels, a fresh image and a new upload.
  await render(replacement)
  expect(createBitmap).toHaveBeenCalledTimes(2); expect(context.getImageData).toHaveBeenCalledTimes(2)
  expect(context.drawImage).toHaveBeenLastCalledWith(await createBitmap.mock.results[1].value, 0, 0)
  expect(upload).toHaveBeenCalledTimes(2)
  await runtime.dispose()
  expect(source.close).not.toHaveBeenCalled()
  expect(replacement.close).not.toHaveBeenCalled()
})

it('draws a video input that changes every frame directly, without reading its pixels back', async () => {
  class Bitmap { width = 32; height = 16; close = vi.fn() }
  const context = { reset: vi.fn(), save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(() => ({ width: 32, height: 16 })) }
  class Canvas { constructor(public width: number, public height: number) {} getContext(): typeof context { return context } }
  vi.stubGlobal('ImageBitmap', Bitmap); vi.stubGlobal('OffscreenCanvas', Canvas)
  const createBitmap = vi.fn(async () => new Bitmap())
  vi.stubGlobal('createImageBitmap', createBitmap)
  const upload = vi.fn()
  const draw = vi.fn((ctx: OffscreenCanvasRenderingContext2D, _time: number, _params: unknown, _width: number, _height: number, assets: Record<string, CanvasImageSource>) => ctx.drawImage(assets.video, 0, 0))
  const runtime = new VideoEditAuthorRuntime({ createTexture: () => ({ destroy: vi.fn() }), queue: { copyExternalImageToTexture: upload } } as unknown as GpuDevice, { name: '录屏', draw })
  const target = { createView: () => ({}), destroy() {} }
  const info = { time: 0, frameDuration: 1 / 60, clip: { time: 0, duration: 1 } }
  const frames = [new Bitmap(), new Bitmap(), new Bitmap(), new Bitmap()]
  for (const frame of frames) await runtime.render(target, 100, 50, {}, { video: frame as unknown as ImageBitmap }, info)
  // 前两帧还按静态图片处理；第二次连续换图之后，每帧直接画这一帧，不再读回像素或复制。
  expect(context.getImageData).toHaveBeenCalledTimes(2); expect(createBitmap).toHaveBeenCalledTimes(2)
  expect(context.drawImage).toHaveBeenLastCalledWith(frames[3], 0, 0); expect(upload).toHaveBeenCalledTimes(4)
  // 停在同一帧：回到像素缓存与新副本，画面不受共享图片的采样状态影响。
  await runtime.render(target, 100, 50, {}, { video: frames[3] as unknown as ImageBitmap }, info)
  expect(context.getImageData).toHaveBeenCalledTimes(3)
  expect(context.drawImage).toHaveBeenLastCalledWith(await createBitmap.mock.results[2].value, 0, 0)
  await runtime.dispose()
  expect(frames.every(frame => frame.close.mock.calls.length === 0)).toBe(true)
})

it('gives images read outside a canvas draw a real bitmap every frame and draws unrecordable layers directly', async () => {
  class Bitmap { width = 8; height = 8; close = vi.fn() }
  const context = { reset: vi.fn(), save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(() => ({ width: 8, height: 8 })) }
  class Canvas { constructor(public width: number, public height: number) {} getContext(): typeof context { return context } }
  vi.stubGlobal('ImageBitmap', Bitmap); vi.stubGlobal('OffscreenCanvas', Canvas)
  const createBitmap = vi.fn(async () => new Bitmap())
  vi.stubGlobal('createImageBitmap', createBitmap)
  const upload = vi.fn()
  const seen: unknown[] = []
  const readsPixels = vi.fn((ctx: OffscreenCanvasRenderingContext2D) => { ctx.getImageData(0, 0, 1, 1) })
  const runtime = new VideoEditAuthorRuntime({ createTexture: () => ({ destroy: vi.fn() }), queue: { copyExternalImageToTexture: upload } } as unknown as GpuDevice, {
    name: '外部图片',
    layers: (_params, _width, _height, assets) => { seen.push(assets.scene); return [{ draw: readsPixels }] },
  })
  const target = { createView: () => ({}), destroy() {} }
  const info = { time: 0, frameDuration: 1 / 60, clip: { time: 0, duration: 1 } }
  const source = new Bitmap()
  for (let frame = 0; frame < 2; frame++) await runtime.render(target, 100, 50, {}, { scene: source as unknown as ImageBitmap }, info)
  expect(seen.every(value => value instanceof Bitmap && value !== source)).toBe(true)
  expect(createBitmap).toHaveBeenCalledTimes(2)
  // A pixel read cannot be recorded: the layer draws on the real canvas every frame.
  expect(context.getImageData.mock.calls.filter(args => args.join() === '0,0,1,1')).toHaveLength(2)
  expect(upload).toHaveBeenCalledTimes(2)
  await runtime.dispose()
})

it('只读过一次的图片不再每帧预先拷位图；之后再读照常经重试拿到本帧位图', async () => {
  class Bitmap { width = 8; height = 8; close = vi.fn() }
  const context = { reset: vi.fn(), save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(() => ({ width: 8, height: 8 })) }
  class Canvas { constructor(public width: number, public height: number) {} getContext(): typeof context { return context } }
  vi.stubGlobal('ImageBitmap', Bitmap); vi.stubGlobal('OffscreenCanvas', Canvas)
  const createBitmap = vi.fn(async () => new Bitmap())
  vi.stubGlobal('createImageBitmap', createBitmap)
  let size: number | undefined, readAgain = false
  const seen: unknown[] = []
  const runtime = new VideoEditAuthorRuntime({ createTexture: () => ({ destroy: vi.fn() }), queue: { copyExternalImageToTexture: vi.fn() } } as unknown as GpuDevice, {
    name: '图标',
    // 作者第一帧量一次图标尺寸并缓存，之后不再读 assets
    layers: (_params, _width, _height, assets) => {
      if (size === undefined || readAgain) { const icon = assets.icon as unknown as Bitmap; seen.push(icon); size = icon.width }
      return [{ id: 'card', draw(ctx) { ctx.fillRect(0, 0, size!, size!) } }]
    },
  })
  const icon = new Bitmap()
  const copies: number[] = []
  try {
    for (let frame = 0; frame < 16; frame++) {
      const before = createBitmap.mock.calls.length
      await runtime.render({ createView: () => ({}), destroy() {} }, 100, 50, {}, { icon: icon as unknown as ImageBitmap }, { time: frame / 60, frameDuration: 1 / 60, clip: { time: frame / 60, duration: 5 } })
      copies.push(createBitmap.mock.calls.length - before)
    }
    expect(copies[0]).toBe(1)
    // 几帧之后不再为没人读的图片拷位图
    expect(copies.slice(10)).toEqual([0, 0, 0, 0, 0, 0])
    readAgain = true
    await runtime.render({ createView: () => ({}), destroy() {} }, 100, 50, {}, { icon: icon as unknown as ImageBitmap }, { time: 1, frameDuration: 1 / 60, clip: { time: 1, duration: 5 } })
    expect(seen.at(-1)).toBeInstanceOf(Bitmap); expect(seen.at(-1)).not.toBe(icon)
  } finally { await runtime.dispose() }
})

it('releases the module even when an instance disposer fails, without retrying disposal', async () => {
  const dispose = vi.fn(() => { throw new Error('instance cleanup') })
  const moduleDispose = vi.fn()
  const runtime = new VideoEditAuthorRuntime({} as GpuDevice, {
    name: '失败清理', createWebGPU: () => ({ draw() {}, dispose }), dispose: moduleDispose,
  })
  await runtime.render({ createView: () => ({}), destroy() {} }, 10, 10, {}, {}, { time: 0, frameDuration: 1 / 60, clip: { time: 0, duration: 1 } })
  await expect(runtime.dispose()).rejects.toThrow('代码效果资源释放失败')
  expect(moduleDispose).toHaveBeenCalledOnce()
  await runtime.dispose()
  expect(dispose).toHaveBeenCalledOnce()
})

it('passes borrowed current and neighbouring GPU textures directly and never destroys them', async () => {
  const current = { createView: vi.fn(), destroy: vi.fn() }
  const previous = { createView: vi.fn(), destroy: vi.fn() }
  const target = { createView: vi.fn(), destroy: vi.fn() }
  const device = { queue: { copyExternalImageToTexture: vi.fn() } } as unknown as GpuDevice
  const draw = vi.fn()
  const runtime = new VideoEditAuthorRuntime(device, { name: 'GPU 输入', kind: 'filter', frames: [-1, .5], createWebGPU: () => ({ draw }) })
  const info = { time: 1, frameDuration: 1 / 60, clip: { time: .5, duration: 3 } }
  const inputs = { current, frames: [{ offset: -1, texture: previous, available: true }, { offset: .5, texture: current, available: false }], images: {} }
  await runtime.render(target, 10, 10, {}, {}, info, undefined, inputs)
  expect(draw.mock.calls[0][0]).toBe(target)
  expect(draw.mock.calls[0][7]).toBe(inputs)
  expect(runtime.parameterMetadata.frames).toEqual([-1, .5])
  expect(device.queue.copyExternalImageToTexture).not.toHaveBeenCalled()
  await runtime.dispose()
  expect(current.destroy).not.toHaveBeenCalled()
  expect(previous.destroy).not.toHaveBeenCalled()
  expect(target.destroy).not.toHaveBeenCalled()
})

it('does not start unrelated layer pipelines for a native GPU effect and waits for disposal', async () => {
  const createShaderModule = vi.fn()
  const device = { createShaderModule } as unknown as GpuDevice
  const order: string[] = []
  const runtime = new VideoEditAuthorRuntime(device, {
    name: '原生 GPU',
    createWebGPU: received => {
      expect(received).toBe(device)
      return { draw() {}, async dispose() { await Promise.resolve(); order.push('gpu') } }
    },
    dispose() { order.push('module') },
  })
  await runtime.render({ createView: () => ({}), destroy() {} }, 10, 10, {}, {}, { time: 0, frameDuration: 1 / 60, clip: { time: 0, duration: 1 } })
  await runtime.dispose()
  expect(createShaderModule).not.toHaveBeenCalled()
  expect(order).toEqual(['gpu', 'module'])
})

it('edits a plain draw effect as one element without Canvas interception or extra author draws', async () => {
  const context = { reset: vi.fn(), setTransform: vi.fn() }
  class Canvas {
    constructor(public width: number, public height: number) {}
    getContext(): typeof context { return context }
  }
  vi.stubGlobal('OffscreenCanvas', Canvas)
  const device = { createTexture: () => ({ destroy: vi.fn() }), queue: { copyExternalImageToTexture: vi.fn() } } as unknown as GpuDevice
  const draw = vi.fn()
  const runtime = new VideoEditAuthorRuntime(device, { name: '整幅画面', params: [{ key: 'title', type: 'text' }], draw })
  await runtime.render({ createView: () => ({}), destroy() {} }, 100, 50, {}, {}, { time: 1, frameDuration: 1 / 60, clip: { time: 1, duration: 5 } }, { effect: { dx: 12, dy: -3, scale: 2 } })
  expect(draw).toHaveBeenCalledOnce()
  const [element] = runtime.observeElements()
  expect(element).toMatchObject({ id: 'effect', name: '整幅画面', bounds: [0, 0, 100, 50], textParameterKeys: ['title'] })
  element.matrix.forEach((value, index) => expect(value).toBeCloseTo([2, 0, 0, 2, -38, -28][index]))
  expect(layerDraw).toHaveBeenCalledOnce()
  expect(draw).toHaveBeenCalledOnce()
  await runtime.dispose()
  expect(runtime.observeElements()).toEqual([])
})

it('composites a native GPU whole-effect override on the same device without a Canvas allocation', async () => {
  const canvas = vi.fn(() => { throw new Error('native override must stay on GPU') })
  vi.stubGlobal('OffscreenCanvas', canvas)
  const intermediate = { createView: () => ({}), destroy: vi.fn() }
  const createTexture = vi.fn((_descriptor: unknown) => intermediate)
  const device = { createTexture } as unknown as GpuDevice
  const draw = vi.fn()
  const runtime = new VideoEditAuthorRuntime(device, { name: 'GPU', createWebGPU: () => ({ draw }) })
  const target = { createView: () => ({}), destroy() {} }
  await runtime.render(target, 100, 50, {}, {}, { time: 1, frameDuration: 1 / 60, clip: { time: 1, duration: 5 } }, { effect: { dx: 12 } })
  expect(draw).toHaveBeenCalledOnce()
  expect(draw.mock.calls[0][0]).toBe(intermediate)
  expect(canvas).not.toHaveBeenCalled()
  expect(createTexture.mock.calls[0][0]).not.toHaveProperty('mipLevelCount')
  expect(createTexture.mock.calls[0][0]).toMatchObject({ usage: 0x01 | 0x02 | 0x04 | 0x08 | 0x10 })
  expect(layerDraw.mock.calls[0][0]).toBe(target)
  expect(runtime.observeElements()[0].matrix[4]).toBe(12)
  await runtime.dispose()
  expect(intermediate.destroy).toHaveBeenCalledOnce()
})

it('records one author draw per frame and uploads the original Canvas filter result', async () => {
  const contexts: Array<{ reset: ReturnType<typeof vi.fn>; setTransform: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn>; filter: string }> = []
  class Canvas {
    context = { reset: vi.fn(), setTransform: vi.fn(), drawImage: vi.fn(), filter: 'none' }
    constructor(public width: number, public height: number) { contexts.push(this.context) }
    getContext(): typeof this.context { return this.context }
  }
  vi.stubGlobal('OffscreenCanvas', Canvas)
  const upload = vi.fn()
  const device = { createTexture: () => ({ destroy: vi.fn() }), queue: { copyExternalImageToTexture: upload } } as unknown as GpuDevice
  const draw = vi.fn()
  const runtime = new VideoEditAuthorRuntime(device, { name: '原高斯', layers: () => [{ bounds: [-10, -10, 10, 10], pose: t => ({ x: t * 500, y: 10, blur: 4 }), draw }] })
  const target = { createView: () => ({}), destroy: vi.fn() }
  try {
    await runtime.render(target, 3840, 2160, {}, {}, { time: 1, frameDuration: 1 / 60, clip: { time: 1, duration: 5 } })
    expect(draw).toHaveBeenCalledOnce()
    expect(draw).toHaveBeenCalledWith(expect.anything(), 1)
    // contexts[0] only measures text; [1] is the layer raster and [2] its Canvas blur.
    expect(contexts[2].drawImage).toHaveBeenCalledOnce()
    expect(upload).toHaveBeenCalledOnce()
    expect(upload.mock.calls[0][0].source.context).toBe(contexts[2])
    expect(contexts[2].filter).toBe('none')
  } finally { await runtime.dispose() }
})

/** Canvas 替身：每张画布各一个上下文，记下真实画布上的每个调用（第几张画布、方法、参数）。 */
function canvasHarness() {
  const calls: Array<{ canvas: number; name: string; args: unknown[] }> = []
  const methods = new Set(['reset', 'save', 'restore', 'setTransform', 'translate', 'scale', 'rotate', 'beginPath', 'rect', 'clip', 'clearRect', 'fillRect', 'fillText', 'drawImage', 'measureText', 'createPattern'])
  let count = 0
  class Bitmap { constructor(readonly width: number, readonly height: number) {} close(): void {} }
  class Canvas {
    readonly id = count++
    readonly context: OffscreenCanvasRenderingContext2D
    constructor(public width: number, public height: number) {
      const id = this.id, state: Record<string, unknown> = { globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: 'black', font: '10px sans-serif' }
      this.context = new Proxy(state, {
        has: (target, name) => name in target || methods.has(name as string),
        get: (target, name: string) => name === 'canvas' ? this : name in target ? target[name] : methods.has(name) ? (...args: unknown[]) => { calls.push({ canvas: id, name, args }); return name === 'measureText' ? { width: 10 } : undefined } : undefined,
        set: (target, name: string, value) => { target[name] = value; calls.push({ canvas: id, name: `=${name}`, args: [value] }); return true },
      }) as unknown as OffscreenCanvasRenderingContext2D
    }
    getContext(): OffscreenCanvasRenderingContext2D { return this.context }
    transferToImageBitmap(): ImageBitmap { return new Bitmap(this.width, this.height) as unknown as ImageBitmap }
  }
  vi.stubGlobal('OffscreenCanvas', Canvas)
  if (typeof ImageBitmap === 'undefined') vi.stubGlobal('ImageBitmap', Bitmap)
  const upload = vi.fn()
  const device = {
    createTexture: (descriptor: unknown) => ({ descriptor, destroy: vi.fn(), createView: () => ({}) }),
    queue: { copyExternalImageToTexture: upload },
  } as unknown as GpuDevice
  const text = (from: number, value: string): number => calls.slice(from).filter(call => call.name === 'fillText' && call.args[0] === value).length
  return { calls, upload, device, text }
}
const frameInfo = (frame: number) => ({ time: frame / 60, frameDuration: 1 / 60, clip: { time: frame / 60, duration: 5 } })
const output = { createView: () => ({}), destroy() {} }

it('layers 每帧排版的独立字素动画只栅格一次，重放沿用同一图集', async () => {
  const { device, calls, text } = canvasHarness()
  const runtime = new VideoEditAuthorRuntime(device, { name: '字素动画', layers() {
    const layout = layoutText('甲乙丙', { fontSize: 20 })
    return [{ id: 'title', draw(ctx, time) { drawText(ctx, layout, { graphemes: (_g, i) => ({ y: Math.max(0, 1 - time) * i, opacity: Math.min(1, .5 + time) }) }) } }]
  } })
  try {
    for (let frame = 0; frame < 10; frame++) await runtime.render(output, 100, 50, {}, {}, frameInfo(frame))
    await runtime.render(output, 100, 50, {}, {}, frameInfo(60))
    await runtime.render(output, 100, 50, {}, {}, frameInfo(61))
    expect(text(0, '甲')).toBe(1); expect(text(0, '乙')).toBe(1); expect(text(0, '丙')).toBe(1)
    const images = calls.filter(call => call.name === 'drawImage' && call.args[0] instanceof ImageBitmap)
    expect(images.length).toBeGreaterThan(3)
    expect(new Set(images.map(call => call.args[0])).size).toBe(1)
    expect(runtime.observeElements()[0].textDraws?.[0].revealComplete).toBe(true)
  } finally { await runtime.dispose() }
})

it.each([false, true])('动态图层中的同一文字布局复用位图与上传，pose 跨档重绘且不被 cacheKey=%s 挡住', async cached => {
  const { device, upload, calls } = canvasHarness()
  let scale = 1
  const draw = vi.fn(drawText)
  const runtime = new VideoEditAuthorRuntime(device, { name: '清晰文字', mode: 'dynamic', layers: () => {
    const layout = layoutText('静态标题', { fontSize: 20 })
    return [{ id: 'title', bounds: [0, 0, 80, 40], pose: () => ({ scale }), draw: ctx => draw(ctx, layout), ...(cached ? { cacheKey: 'text' } : {}) }]
  } })
  const images = () => calls.filter(call => call.name === 'drawImage' && call.args[0] instanceof ImageBitmap).map(call => call.args[0] as ImageBitmap)
  try {
    await runtime.render(output, 100, 50, {}, {}, frameInfo(0))
    const first = images()[0]
    await runtime.render(output, 100, 50, {}, {}, frameInfo(1))
    expect(draw).toHaveBeenCalledTimes(cached ? 1 : 2)
    expect(upload).toHaveBeenCalledOnce()
    expect(images()).toEqual([first])
    expect(runtime.observeElements()[0].textDraws).toHaveLength(1)
    scale = 3
    await runtime.render(output, 100, 50, {}, {}, frameInfo(2))
    const enlarged = images().at(-1)!
    expect(enlarged.width).toBe(first.width * 2)
    expect(upload).toHaveBeenCalledTimes(2)
    scale = 1
    await runtime.render(output, 100, 50, {}, {}, frameInfo(3))
    expect(images().at(-1)).toBe(first)
    expect(images().at(-1)?.width).toBe(first.width)
    expect(runtime.observeElements()[0].textDraws).toHaveLength(1)
  } finally { await runtime.dispose() }
})

it('实际绘制的文字事实随图层 cacheKey 沿用，并按当帧位姿观察；回读不能改动缓存', async () => {
  const { device } = canvasHarness()
  const draw = vi.fn((ctx: OffscreenCanvasRenderingContext2D) => drawText(ctx, layoutText('标题\n遗漏行', { fontSize: 20 }, { maxLines: 1, maxWidth: 60 })))
  const runtime = new VideoEditAuthorRuntime(device, { name: '文字', layers: () => [{ id: 'title', name: '标题', cacheKey: 'same', bounds: [0, 0, 80, 40], clip: [0, 0, 50, 50], pose: time => ({ x: time * 10, y: 0 }), draw }] })
  try {
    await runtime.render(output, 100, 50, {}, {}, frameInfo(0))
    const first = runtime.observeElements()[0]
    expect(first.textDraws).toHaveLength(1)
    expect(first.textDraws![0]).toMatchObject({ actualLines: 1, totalLines: 2, stageClip: [0, 0, 50, 50] })
    first.textDraws![0].omittedRanges.length = 0
    await runtime.render(output, 100, 50, {}, {}, frameInfo(1))
    const after = runtime.observeElements()[0]
    expect(draw).toHaveBeenCalledOnce()
    expect(after.matrix[4]).toBeCloseTo(10 / 60)
    expect(after.textDraws![0].omittedRanges.length).toBeGreaterThan(0)
    expect(after.textDraws![0].matrix).toEqual([1, 0, 0, 1, 0, 0])
  } finally { await runtime.dispose() }
})

it('静止层与在变的层拆成几张栅格：停稳后静止部分不再重画、不再上传，GPU 按原图层顺序叠', async () => {
  const { calls, upload, device, text } = canvasHarness()
  // 章节标题的样子：定位框里有沿连线跑的信号点，答案节点停留时轻微明暗起伏，标题与章节名停稳不动
  const runtime = new VideoEditAuthorRuntime(device, { name: '章节标题', layers: () => [
    { id: 'frame', draw(ctx, t) { ctx.fillRect(0, 0, 100, 4); ctx.fillText('pulse', t * 600, 2) } },
    { id: 'title', draw(ctx) { ctx.font = '40px sans-serif'; ctx.fillText('标题', 10, 30) } },
    { id: 'chapter', draw(ctx) { ctx.fillText('章节', 10, 10) } },
    { id: 'answer', draw(ctx, t) { ctx.globalAlpha = .85 + .15 * Math.sin(t * 2.4); ctx.fillText('答案', 60, 30) } },
  ] })
  const frames: Array<Record<string, unknown>> = []
  const drawn: unknown[][] = []
  for (let frame = 0; frame < 6; frame++) {
    const before = calls.length, uploads = upload.mock.calls.length, draws = layerDraw.mock.calls.length
    const statistics = await runtime.render(output, 100, 50, {}, {}, frameInfo(frame))
    frames.push({ ...statistics, title: text(before, '标题'), uploaded: upload.mock.calls.length - uploads })
    drawn.push(layerDraw.mock.calls.slice(draws).map(call => call[3].texture))
  }
  // 第一帧还不知道谁在变：整组一起画；第二帧拆成三组，静止组画这一次，之后沿用
  expect(frames.map(value => [value.title, value.uploaded])).toEqual([[1, 1], [1, 3], [0, 2], [0, 2], [0, 2], [0, 2]])
  expect(frames[5]).toMatchObject({ reused: 2, redrawn: 2, direct: 0, video: 0, uploads: 2, uploadBytes: 2 * 100 * 50 * 4 })
  // 每帧三张纹理按定位框、标题与章节名、答案的顺序叠；静止组的纹理跨帧是同一张
  expect(drawn[5]).toHaveLength(3)
  expect(drawn[4][1]).toBe(drawn[5][1])
  expect(new Set(drawn[5]).size).toBe(3)
  await runtime.dispose()
})

it('混合模式不是 source-over 的层与前面的层留在同一张画布，后面只用 source-over 的层照样拆出', async () => {
  const { calls, device, text } = canvasHarness()
  const runtime = new VideoEditAuthorRuntime(device, { name: '挖洞', layers: () => [
    { id: 'card', draw(ctx) { ctx.fillText('卡片', 0, 0) } },
    { id: 'hole', draw(ctx, t) { ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(t * 600, 0, 10, 10) } },
    { id: 'label', draw(ctx) { ctx.fillText('说明', 0, 20) } },
  ] })
  const counts: number[][] = []
  for (let frame = 0; frame < 5; frame++) {
    const before = calls.length
    await runtime.render(output, 100, 50, {}, {}, frameInfo(frame))
    counts.push([text(before, '卡片'), text(before, '说明')])
  }
  // 挖洞要作用在卡片上：卡片随它每帧重画；说明停稳后单独沿用
  expect(counts).toEqual([[1, 1], [1, 1], [1, 0], [1, 0], [1, 0]])
  await runtime.dispose()
})

it('隔几帧才变一次的层一直单独成组：静止部分不随分组来回切换而反复重画', async () => {
  const { calls, device, text } = canvasHarness()
  const runtime = new VideoEditAuthorRuntime(device, { name: '计数', layers: () => [
    { id: 'card', draw(ctx) { ctx.fillText('卡片', 0, 0) } },
    { id: 'count', draw(ctx, t) { ctx.fillText(String(Math.floor(t * 15)), 0, 20) } },
  ] })
  const card: number[] = []
  for (let frame = 0; frame < 24; frame++) { const before = calls.length; await runtime.render(output, 100, 50, {}, {}, frameInfo(frame)); card.push(text(before, '卡片')) }
  // 计数每 4 帧变一次：第一次变时拆开（卡片画这一次），之后卡片一直沿用
  expect(card.slice(0, 5)).toEqual([1, 0, 0, 0, 1])
  expect(card.slice(5).every(count => count === 0)).toBe(true)
  await runtime.dispose()
})

it('带 clip 的静止层组只栅格、上传 clip 的范围，并按该位置叠回画面', async () => {
  const { upload, device } = canvasHarness()
  const runtime = new VideoEditAuthorRuntime(device, { name: '闪烁', layers: () => [
    { id: 'card', draw(ctx) { ctx.fillText('卡片', 0, 0) } },
    { id: 'blink', clip: [10.5, 20, 30, 50], draw(ctx, t) { ctx.globalAlpha = .5 + .5 * Math.sin(t * 9); ctx.fillRect(10, 20, 20, 30) } },
  ] })
  for (let frame = 0; frame < 4; frame++) await runtime.render(output, 100, 50, {}, {}, frameInfo(frame))
  const last = upload.mock.calls.at(-1)!
  // 只在 clip 大小的画布上平移栅格：整张画布上传，不再从整帧画布里截取
  expect(last[0].origin).toBeUndefined(); expect(last[2]).toEqual([20, 30])
  expect([last[0].source.width, last[0].source.height]).toEqual([20, 30])
  const draw = layerDraw.mock.calls.at(-1)!
  expect(draw[3]).toMatchObject({ x: 0, y: 0, width: 20, height: 30 })
  expect(draw[4][0].pose.matrix).toEqual([1, 0, 0, 1, 10, 20])
  await runtime.dispose()
})

it('作者缓存的 ImageBitmap 按身份沿用：停稳的帧不重画、不上传；save/restore 不成对的层整段照旧画在一张画布', async () => {
  class Bitmap { width = 8; height = 8; close = vi.fn() }
  vi.stubGlobal('ImageBitmap', Bitmap)
  const { calls, upload, device } = canvasHarness()
  const patch = new Bitmap()
  const runtime = new VideoEditAuthorRuntime(device, { name: '退开', layers: () => [{ id: 'knock', draw(ctx) { ctx.save(); ctx.globalAlpha = .9; ctx.drawImage(patch as unknown as ImageBitmap, 4, 4); ctx.restore() } }] })
  for (let frame = 0; frame < 3; frame++) await runtime.render(output, 100, 50, {}, {}, frameInfo(frame))
  expect(calls.filter(call => call.name === 'drawImage').map(call => call.args[0])).toEqual([patch])
  expect(upload).toHaveBeenCalledOnce()
  await runtime.dispose()
  // 多出一次 restore：状态与裁剪会漏给后面的层，不拆开
  const leaky = canvasHarness()
  const unbalanced = new VideoEditAuthorRuntime(leaky.device, { name: '漏状态', layers: () => [
    { id: 'a', draw(ctx) { ctx.restore(); ctx.fillText('甲', 0, 0) } },
    { id: 'b', draw(ctx, t) { ctx.fillText(`乙${t}`, 0, 0) } },
  ] })
  for (let frame = 0; frame < 4; frame++) await unbalanced.render(output, 100, 50, {}, {}, frameInfo(frame))
  expect(leaky.text(0, '甲')).toBe(4)
  expect(leaky.upload).toHaveBeenCalledTimes(4)
  await unbalanced.dispose()
})

it('未绘制的整段布局向查询传递身份，不在每帧生成警告；空白图层没有文字警告', async () => {
  const { device } = canvasHarness()
  const runtime = new VideoEditAuthorRuntime(device, { name: '漏绘制', layers() {
    const whole = layoutText('标题第一行\n标题第二行', { fontSize: 20 }, { maxLines: 1 })
    return [{ id: 'title', draw(ctx) { for (const g of whole.graphemes) if (g.x !== null) drawText(ctx, layoutText(g.text, g.style)) } }]
  } })
  try {
    await runtime.render(output, 100, 50, {}, {}, frameInfo(0))
    expect(runtime.observeElements()[0].unassignedTextLayouts).not.toHaveLength(0)
    expect(runtime.observeElements()[0].textUncovered).toEqual([])
  } finally { await runtime.dispose() }
  const blank = new VideoEditAuthorRuntime(device, { name: '背景', layers: () => [{ id: 'background', draw(ctx) { ctx.fillRect(0, 0, 10, 10) } }] })
  try { await blank.render(output, 100, 50, {}, {}, frameInfo(0)); expect(blank.observeElements()[0].textUncovered).toEqual([]) } finally { await blank.dispose() }
})

it('flex 测量与基线参考计划不混入作者运行时的待绘制集合', async () => {
  await flexReady
  const { device } = canvasHarness()
  const runtime = new VideoEditAuthorRuntime(device, { name: '数据卡', layers() {
    const boxes = layoutBoxes({ id: 'card', style: { width: 80, padding: 4, alignItems: 'baseline' }, children: [{ id: 'title', text: { content: '中文标题\n第二行', style: { fontSize: 20 }, options: { maxLines: 1 } } }] }, { width: 100, height: 50 })
    return [{ id: 'title', draw(ctx) { drawText(ctx, boxes.title.text!) } }]
  } })
  try {
    for (let frame = 0; frame < 2; frame++) {
      await runtime.render(output, 100, 50, {}, {}, frameInfo(frame))
      const element = runtime.observeElements()[0]
      expect(new Set([...element.textLayouts ?? [], ...element.unassignedTextLayouts ?? []])).toEqual(new Set(element.textDraws?.map(draw => draw.layoutId)))
      expect(element.textDraws?.[0].truncated).toBe(true)
    }
  } finally { await runtime.dispose() }
})
it('save/restore 不成对导致合并时，排版事实仍归到正确图层并沿用', async () => {
  const { device } = canvasHarness()
  const runtime = new VideoEditAuthorRuntime(device, { name: '合并文字', layers: () => [
    { id: 'title', draw(ctx) { ctx.restore(); drawText(ctx, layoutText('第一行\n第二行', { fontSize: 20 }, { maxLines: 1 })) } },
    { id: 'background', draw(ctx) { ctx.fillRect(0, 0, 10, 10) } },
  ] })
  try {
    for (let i = 0; i < 3; i++) {
      await runtime.render(output, 100, 50, {}, {}, frameInfo(i))
      const elements = runtime.observeElements()
      expect(elements[0].textDraws).toHaveLength(1)
      expect(elements[0].textDraws![0]).toMatchObject({ truncated: true, retained: false })
      expect(elements[1].textDraws ?? []).toHaveLength(0)
    }
  } finally { await runtime.dispose() }
})

it('新建源码版本显式固定新版库，经冻结模块实际绘制后复核出截断；旧无库记录原样保存复用', async () => {
  const { device } = canvasHarness()
  const source = `import { layoutText, drawText } from 'henji-layout/text';
    export default { name: '端到端标题', kind: 'generator', mode: 'dynamic', layers() {
      const layout = layoutText('第一行\\n第二行', { fontSize: 20 }, { maxLines: 1 });
      return [{ id: 'title', bounds: [0,0,100,50], pose: t => ({ scale: 1 + t / 10 }), draw(ctx) { drawText(ctx, layout) } }];
    } };`
  let effect: AuthorModule | undefined
  const compile = async (files: import('@/core/videoEdit/codeMaterial/sources').CodeMaterialFiles) => {
    const bundle = await bundleAuthorFiles(files, build)
    let code = bundle.code
    for (const [name, version] of Object.entries(bundle.libraries ?? {})) {
      const release = AUTHOR_LIBRARIES[name][version]
      for (const file of Object.values(release.modules)) code = code.replaceAll(`henji-media://author-lib/${name}/${version}/${file}`, pathToFileURL(path.resolve(release.frozen!, file)).href)
    }
    const loaded = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')) as { default: AuthorModule }
    effect = loaded.default
    return { ...authorEffectMetadata(effect, bundle.apiVersion), apiVersion: bundle.apiVersion!, languageVersion: 4 as const, seed: 0, bundle }
  }
  const publication = { imports: [], async write(id: string, _name: string, files: import('@/core/videoEdit/codeMaterial/sources').CodeMaterialFiles) { return { folder: id, files: (await addressCodeMaterialFiles(files)).files } } }
  const { definition, program } = await makeCodeMaterialDefinition(source, compile, publication)
  const version = definition.versions[0]
  expect(version.libraries?.['henji-layout']).toBe('1.2.0')
  expect(program.bundle.libraries?.['henji-layout']).toBe('1.2.0')
  const runtime = new VideoEditAuthorRuntime(device, effect!, undefined, true, version.apiVersion)
  const document = createVideoEditDocument('新建源码复核'), sequence = createVideoEditSequence('主')
  sequence.width = 100; sequence.height = 50; addLegacyVideoEditTracks(sequence); document.sequences = [sequence]; document.codeMaterials = [definition]
  sequence.clips = [{ id: 'code', itemId: 'code-item', name: '标题', kind: 'code', track: 1, start: 0, duration: 30, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', code: { definitionId: definition.id, versionId: version.id, parameters: {} } }]
  const composition = videoEditComposition(document, sequence.id)
  try {
    const result = await collectVideoEditCodeMotion(composition, { from: 0, to: 30 }, { [version.id]: program }, {}, async (local, frame) => {
      await runtime.render(output, 100, 50, {}, {}, frameInfo(frame))
      const elements = runtime.observeElements()
      expect(elements[0].textDraws?.[0]).toMatchObject({ sourceText: '第一行\n第二行', truncated: true })
      return { sequenceId: local.id, revision: local.revision, frame, clips: [{ clipId: 'code', versionId: version.id, width: 100, height: 50, elements }] }
    })
    expect(result.records.filter(record => record.kind === 'text_truncated')).toEqual([expect.objectContaining({ elementPath: ['title'], timeline: { from: 0, to: 30 } })])
    expect(result.records.some(record => record.kind === 'text_overflow')).toBe(false)
  } finally { await runtime.dispose() }
  const old = structuredClone(definition); delete old.versions[0].libraries
  const appended = await appendCodeMaterialVersion(old, source, compile, documentCodeSourceResolver(), publication)
  expect(appended.versionId).toBe(version.id)
  expect(appended.program.bundle.libraries?.['henji-layout']).toBe('1.0.0')
  expect(appended.definition.versions[0].libraries).toBeUndefined()
})

it('模块常量的布局身份跨帧传递，绘制后提供同一身份供区间汇总', async () => {
  const { device } = canvasHarness(), pending = new Set<string>()
  const layout = observeTextLayouts(id => pending.add(id), () => layoutText('模块常量\n遗漏行', { fontSize: 20 }, { maxLines: 1 }))
  let enabled = false
  const module: AuthorModule = { name: '模块常量', layers: () => [{ id: 'title', draw(ctx) { if (enabled) drawText(ctx, layout); else ctx.fillRect(0, 0, 10, 10) } }] }
  authorModuleTextLayouts.set(module, pending)
  const runtime = new VideoEditAuthorRuntime(device, module)
  try {
    await runtime.render(output, 100, 50, {}, {}, frameInfo(0))
    expect(runtime.observeElements()[0].unassignedTextLayouts).not.toHaveLength(0)
    expect(runtime.observeElements()[0].textUncovered).toEqual([])
    enabled = true
    await runtime.render(output, 100, 50, {}, {}, frameInfo(1))
    expect(runtime.observeElements()[0].textUncovered).toEqual([])
  } finally { await runtime.dispose() }
})
