import { expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditAuthorGpu } from './videoEditAuthorGpu'

it.each(['reject', 'validation'] as const)('首帧预编译浮点 motion/mip，%s 失败后可重试且绘制不做同步编译', async failure => {
  const pipeline = { getBindGroupLayout: () => ({}) }
  const compile = vi.fn(async (_descriptor: unknown) => pipeline)
  const validation = vi.fn(async (): Promise<{ message: string } | null> => null)
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), setScissorRect: vi.fn(), draw: vi.fn(), end: vi.fn() }
  const device = {
    createSampler: () => ({}), pushErrorScope: vi.fn(), popErrorScope: validation,
    createShaderModule: () => ({}), createRenderPipelineAsync: compile, createRenderPipeline: vi.fn(() => pipeline),
    createBuffer: () => ({ destroy: vi.fn() }), createBindGroup: () => ({}),
    createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }),
    queue: { writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: async () => {} },
  } as unknown as GpuDevice
  const gpu = new VideoEditAuthorGpu(device)
  const texture = { format: 'rgba16float', createView: () => ({}), destroy: vi.fn() }
  try {
    await gpu.prepareFormat('rgba8unorm')
    if (failure === 'reject') compile.mockRejectedValueOnce(new Error('编译失败'))
    else validation.mockResolvedValueOnce({ message: '验证失败' })
    await expect(gpu.begin(undefined, texture.format)).rejects.toThrow(/失败/)
    await gpu.begin(undefined, texture.format)
    gpu.mipmaps(texture, 2, 2)
    gpu.draw(() => texture, 2, 2, { texture, x: 0, y: 0, width: 2, height: 2 }, [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, 0, 0], opacity: 1 } }])
    expect(device.createRenderPipeline).not.toHaveBeenCalled()
    const compiled = compile.mock.calls.length
    await gpu.begin(texture)
    expect(compile).toHaveBeenCalledTimes(compiled)
  } finally { await gpu.dispose() }
})

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
    const untouched = vi.fn(() => texture)
    expect(gpu.draw(untouched, 3840, 2160, { texture, x: 0, y: 0, width: 3840, height: 2160 }, samples, [0, 0, 0, 0])).toBe(false)
    expect(untouched).not.toHaveBeenCalled()
    expect(pass.draw).toHaveBeenCalledWith(6)
    expect(pass.setScissorRect).toHaveBeenCalledWith(11, 20, 2990, 1980)
    expect(device.queue.writeBuffer).toHaveBeenCalledOnce()
    expect(device.queue.submit).not.toHaveBeenCalled()
    gpu.finish()
    expect(device.queue.submit).toHaveBeenCalledOnce()
  } finally { await gpu.dispose() }
})
