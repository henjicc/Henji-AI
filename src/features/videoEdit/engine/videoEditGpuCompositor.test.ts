import { describe, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { createVideoEditDocument, videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'

const state = vi.hoisted(() => ({ device: undefined as GpuDevice | undefined }))
vi.mock('@/core/imageEdit/webgpu/deviceManager', () => ({ ImageEditWebGpuDeviceManager: class {
  onDeviceLost() {}
  async acquire() { return { device: state.device!, provider: { getPreferredCanvasFormat: () => 'rgba8unorm' } } }
  destroy() {}
} }))
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
