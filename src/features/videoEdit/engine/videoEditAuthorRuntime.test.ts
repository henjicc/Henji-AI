import { afterEach, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditAuthorRuntime } from './videoEditAuthorRuntime'
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
  const inputs = { current, frames: [{ offset: -1, texture: previous, available: true }, { offset: .5, texture: current, available: false }] }
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
