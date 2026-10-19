import { afterEach, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditAuthorRuntime } from './videoEditAuthorRuntime'

vi.mock('./videoEditAuthorGpu', () => ({ VideoEditAuthorGpu: class {
  begin = vi.fn(); draw = vi.fn(); mipmaps = vi.fn(); lens = vi.fn(); finish = vi.fn(); dispose = vi.fn()
} }))

afterEach(() => { vi.unstubAllGlobals() })

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
