import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { createVideoEditDocument, videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import type { VideoSample } from 'mediabunny'

const state = vi.hoisted(() => ({ device: undefined as GpuDevice | undefined }))
afterEach(() => { vi.unstubAllGlobals() })
vi.mock('@/core/imageEdit/webgpu/deviceManager', () => ({ ImageEditWebGpuDeviceManager: class {
  onDeviceLost() {}
  async acquire() { return { device: state.device!, provider: { getPreferredCanvasFormat: () => 'rgba8unorm' } } }
  destroy() {}
} }))
function copyFixture(fence: () => Promise<void>) {
  const closed = vi.fn(); const destroyed = vi.fn()
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() }
  const device = {
    queue: { copyExternalImageToTexture: vi.fn(), writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: fence },
    lost: new Promise<{ reason?: string; message?: string }>(() => {}), createShaderModule: vi.fn(), createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createSampler: vi.fn(),
    createTexture: () => ({ createView: () => ({}), destroy: destroyed }), createBuffer: () => ({ destroy: vi.fn() }),
    createBindGroup: vi.fn(), createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }), pushErrorScope: vi.fn(), popErrorScope: async () => null, destroy: vi.fn(), importExternalTexture: vi.fn(),
  }
  state.device = device
  const output = { width: 3840, height: 2160, getContext: () => ({ configure: vi.fn(), getCurrentTexture: () => ({ createView: () => ({}) }) }) } as unknown as OffscreenCanvas
  const compositor = new VideoEditGpuCompositor(output)
  const sample = { timestamp: 0, duration: 1 / 60, displayWidth: 3840, displayHeight: 2160, rotation: 0, flip: false, toVideoFrame: () => ({ visibleRect: { width: 3840, height: 2160 }, close: closed }) } as unknown as VideoSample
  return { compositor, sample, device, closed, destroyed }
}
it('已经到时的画面直接提交，不再等待额外一次垂直同步', async () => {
  const request = vi.fn((callback: FrameRequestCallback) => { queueMicrotask(() => callback(performance.now())); return 1 })
  vi.stubGlobal('self', { requestAnimationFrame: request, cancelAnimationFrame: vi.fn() })
  const { compositor, device } = copyFixture(async () => {})
  const document = createVideoEditDocument('到时呈现')
  const result = await compositor.draw(videoEditComposition(document, document.sequences[0].id), [], [], () => true, performance.timeOrigin + performance.now() - 1)
  await result.completion
  expect(result.presented).toBe(true); expect(device.queue.submit).toHaveBeenCalledOnce(); expect(request).not.toHaveBeenCalled()
  await compositor.dispose()
})
it('未来帧仍等指定时刻，取消等待不能提交已失效画面', async () => {
  const callbacks = new Map<number, FrameRequestCallback>(); let token = 0
  const request = vi.fn((callback: FrameRequestCallback) => { callbacks.set(++token, callback); return token })
  vi.stubGlobal('self', { requestAnimationFrame: request, cancelAnimationFrame: (id: number) => callbacks.delete(id) })
  const { compositor, device } = copyFixture(async () => {}); const document = createVideoEditDocument('未来呈现')
  let owned = true
  const rendering = compositor.draw(videoEditComposition(document, document.sequences[0].id), [], [], () => owned, performance.timeOrigin + performance.now() + 1000)
  for (let index = 0; index < 20; index++) await Promise.resolve()
  expect(request).toHaveBeenCalledOnce(); expect(device.queue.submit).not.toHaveBeenCalled()
  owned = false; compositor.cancelPresentation()
  expect((await rendering).presented).toBe(false); expect(device.queue.submit).not.toHaveBeenCalled(); expect(callbacks.size).toBe(0)
  await compositor.dispose()
})
it('同队列顺序复制不逐层等待，外部解码帧保留到完成；销毁等待所有复制释放', async () => {
  let complete!: () => void; const fence = new Promise<void>(resolve => { complete = resolve })
  const { compositor, sample, device, closed, destroyed } = copyFixture(() => fence)
  const copies = await Promise.all([compositor.snapshot(sample, true, true), compositor.snapshot(sample, true, true)])
  expect(device.queue.submit).toHaveBeenCalledTimes(2); expect(closed).not.toHaveBeenCalled()
  // The final composition is enqueued after copies without awaiting their fences.
  const document = createVideoEditDocument('同队列合成')
  const drawing = await compositor.draw(videoEditComposition(document, document.sequences[0].id), [], [], () => true)
  expect(device.queue.submit).toHaveBeenCalledTimes(3)
  let disposed = false; const closing = compositor.dispose().then(() => { disposed = true })
  await Promise.resolve(); expect(disposed).toBe(false)
  complete(); await drawing.completion; await closing
  expect(closed).toHaveBeenCalledTimes(2)
  copies.forEach(copy => copy.close()); expect(destroyed).toHaveBeenCalledTimes(4)
  await expect(compositor.snapshot(sample, true, true)).rejects.toThrow('关闭')
})
it('多源同时等待复制名额时逐次重查，单个完成不能唤醒后突破两份外部帧预算', async () => {
  const finish: Array<() => void> = []
  const { compositor, sample, device, closed } = copyFixture(() => new Promise<void>(resolve => { finish.push(resolve) }))
  const pending = Array.from({ length: 4 }, () => compositor.snapshot(sample, true, true))
  const tick = async (): Promise<void> => { for (let index = 0; index < 30; index++) await Promise.resolve() }
  await tick(); expect(device.queue.submit).toHaveBeenCalledTimes(2)
  finish[0](); await tick(); expect(device.queue.submit).toHaveBeenCalledTimes(3)
  finish[1](); await tick(); expect(device.queue.submit).toHaveBeenCalledTimes(4)
  finish[2](); finish[3](); const copies = await Promise.all(pending)
  await tick(); expect(closed).toHaveBeenCalledTimes(4)
  copies.forEach(copy => copy.close()); await compositor.dispose()
})
describe('合成器共享图片候选生命周期', () => {
  it('代码与普通片段共享一次上传，满文字工作集切换图片先回收，不因旧预算阻塞', async () => {
    vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} getContext() { return { fillText() {} } } })
    for (const [width, height, count] of [[3840, 2160, 8], [16, 16, 32]]) {
      const { compositor, device, destroyed } = copyFixture(async () => {})
      compositor.canvas.width = width; compositor.canvas.height = height
      const document = createVideoEditDocument('满工作集'); document.sequences[0].width = width; document.sequences[0].height = height
      document.items = [{ id: 'text', kind: 'text', name: '文字' }]
      const composition = videoEditComposition(document, document.sequences[0].id)
      const base = makeVideoEditItemClip(document, 'text', document.sequences[0].id, { frame: 0 })
      const clips = Array.from({ length: count }, (_, index) => ({ ...base, id: `text-${index}` }))
      await compositor.prepareImages(new Map(), () => true, new Set(clips.map(clip => clip.id)))
      await (await compositor.draw(composition, clips, clips.map(() => null), () => true)).completion
      expect(compositor.imageDiagnostics().textures).toBe(count)
      const picture = { width, height } as ImageBitmap
      const inputs = await compositor.prepareImages(new Map([['original', picture], ['same-original', picture]]), () => true)
      expect(inputs.get('original')!.texture).toBe(inputs.get('same-original')!.texture)
      expect(destroyed).toHaveBeenCalledTimes(count)
      await (await compositor.draw(composition, [base, { ...base, id: 'copy' }], [picture, picture], () => true)).completion
      expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(count + 1)
      expect(compositor.imageDiagnostics()).toMatchObject({ textures: 1, bytes: width * height * 4, uploads: count + 1 })
      await expect(compositor.prepareImages(new Map(Array.from({ length: 33 }, (_, index) => [`image-${index}`, { width: 1, height: 1 } as ImageBitmap])), () => true)).rejects.toThrow('32')
      await compositor.dispose(); expect(compositor.imageDiagnostics().textures).toBe(0)
    }
  })
  it('新图上传异常清理候选并保留最后有效纹理，重试不读取被销毁纹理', async () => {
    const textures: Array<{ createView: () => object; destroy: ReturnType<typeof vi.fn> }> = []
    const copy = vi.fn(); const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() }
    state.device = {
      queue: { copyExternalImageToTexture: copy, writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: async () => {} },
      lost: new Promise(() => {}), createShaderModule: vi.fn(), createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createSampler: vi.fn(),
      createTexture: () => { const texture = { createView: () => ({}), destroy: vi.fn() }; textures.push(texture); return texture }, createBuffer: () => ({ destroy: vi.fn() }),
      createBindGroup: vi.fn(), createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }), pushErrorScope: vi.fn(), popErrorScope: async () => null, destroy: vi.fn(),
    }
    const output = { getContext: () => ({ configure: vi.fn(), getCurrentTexture: () => ({ createView: () => ({}) }) }) } as unknown as OffscreenCanvas
    const compositor = new VideoEditGpuCompositor(output)
    const document = createVideoEditDocument('图片上传'); document.items.push({ id: 'item', name: '画面', kind: 'text' })
    const clip = makeVideoEditItemClip(document, 'item', document.sequences[0].id, { frame: 0 }); const composition = videoEditComposition(document, document.sequences[0].id)
    const first = { width: 32, height: 32 } as ImageBitmap; const second = { width: 32, height: 32 } as ImageBitmap
    await (await compositor.draw(composition, [clip], [first], () => true)).completion
    copy.mockImplementationOnce(() => { throw new Error('GPU上传失败') })
    await expect(compositor.draw(composition, [clip], [second], () => true)).rejects.toThrow('GPU上传失败')
    expect(textures[0].destroy).not.toHaveBeenCalled(); expect(textures[1].destroy).toHaveBeenCalledOnce()
    await (await compositor.draw(composition, [clip], [first], () => true)).completion
    expect(copy).toHaveBeenCalledTimes(2)
    await compositor.dispose(); expect(textures[0].destroy).toHaveBeenCalledOnce()
  })
})
