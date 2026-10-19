import { expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditAuthorGpu } from './videoEditAuthorGpu'

it('真实运动准备路径允许 4K 全屏曝光，分数裁剪按像素中心处理', async () => {
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), setScissorRect: vi.fn(), draw: vi.fn(), end: vi.fn() }
  const device = {
    createSampler: () => ({}), pushErrorScope: vi.fn(), popErrorScope: async () => null,
    createShaderModule: () => ({}), createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBuffer: () => ({ destroy: vi.fn() }), createBindGroup: () => ({}),
    createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }),
    queue: { writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: async () => {} },
  } as unknown as GpuDevice
  const gpu = new VideoEditAuthorGpu(device)
  const texture = { createView: () => ({}), destroy: vi.fn() }
  await gpu.begin(texture)
  const samples = Array.from({ length: 64 }, () => ({ offset: { numerator: 0, denominator: 1 }, weight: 1 / 64, pose: { matrix: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number], opacity: 1 } }))
  try {
    gpu.draw(texture, 3840, 2160, { texture, x: 0, y: 0, width: 3840, height: 2160 }, samples, [10.6, 20.4, 3000.5, 2000.4])
    expect(pass.draw).toHaveBeenCalledWith(6)
    expect(pass.setScissorRect).toHaveBeenCalledWith(11, 20, 2990, 1980)
    expect(device.queue.writeBuffer).toHaveBeenCalledOnce()
    expect(device.queue.submit).not.toHaveBeenCalled()
    gpu.finish()
    expect(device.queue.submit).toHaveBeenCalledOnce()
  } finally { await gpu.dispose() }
})
