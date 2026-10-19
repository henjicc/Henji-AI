import { afterEach, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditAuthorRuntime } from './videoEditAuthorRuntime'
const { layerDraw } = vi.hoisted(() => ({ layerDraw: vi.fn() }))

vi.mock('./videoEditAuthorGpu', () => ({ VideoEditAuthorGpu: class {
  begin = vi.fn(); draw = layerDraw; mipmaps = vi.fn(); lens = vi.fn(); finish = vi.fn(); dispose = vi.fn()
} }))

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

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
  expect(draw.mock.calls[0][0]).toBe(context)
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

it('passes the supplied context directly to one author draw and uploads the original Canvas filter result', async () => {
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
    expect(draw).toHaveBeenCalledWith(contexts[0], 1)
    expect(contexts[1].drawImage).toHaveBeenCalledOnce()
    expect(upload).toHaveBeenCalledOnce()
    expect(upload.mock.calls[0][0].source.context).toBe(contexts[1])
    expect(contexts[1].filter).toBe('none')
  } finally { await runtime.dispose() }
})
