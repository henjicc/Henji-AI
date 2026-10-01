import { describe, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { createVideoEditDocument, videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import type { VideoSample } from 'mediabunny'

const state = vi.hoisted(() => ({ device: undefined as GpuDevice | undefined }))
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
  const output = { getContext: () => ({ configure: vi.fn(), getCurrentTexture: () => ({ createView: () => ({}) }) }) } as unknown as OffscreenCanvas
  const compositor = new VideoEditGpuCompositor(output)
  const sample = { timestamp: 0, duration: 1 / 60, displayWidth: 3840, displayHeight: 2160, rotation: 0, flip: false, toVideoFrame: () => ({ visibleRect: { width: 3840, height: 2160 }, close: closed }) } as unknown as VideoSample
  return { compositor, sample, device, closed, destroyed }
}
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
