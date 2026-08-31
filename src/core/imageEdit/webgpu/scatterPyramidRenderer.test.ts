import { describe, expect, it, vi } from 'vitest'
import type { DiffusionScatterLevel } from '../diffusionRecipe'
import type {
  GpuDevice,
  GpuRenderPipeline,
  GpuTexture,
} from '../worker/webgpuRuntimeSupport'
import { renderScatterPyramid } from './scatterPyramidRenderer'

function createTexture(): GpuTexture {
  return {
    createView: () => ({}),
    destroy: vi.fn(),
  }
}

function createDevice() {
  const submit = vi.fn()
  const onSubmittedWorkDone = vi.fn(async () => undefined)
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  }
  return {
    submit,
    onSubmittedWorkDone,
    device: {
      queue: {
        submit,
        onSubmittedWorkDone,
        writeBuffer: vi.fn(),
      },
      createBuffer: () => ({ destroy: vi.fn() }),
      createBindGroup: () => ({}),
      createCommandEncoder: () => ({
        beginRenderPass: () => pass,
        finish: () => ({}),
      }),
    } as unknown as GpuDevice,
  }
}

describe('renderScatterPyramid', () => {
  it('同一散射链依赖队列顺序提交，不逐 pass 等待全队列栅栏', async () => {
    const { device, submit, onSubmittedWorkDone } = createDevice()
    const textures: GpuTexture[] = []
    const levels: DiffusionScatterLevel[] = [
      {
        divisor: 2,
        weight: [0.6, 0.6, 0.6],
      },
      {
        divisor: 4,
        weight: [0.4, 0.4, 0.4],
      },
    ]

    const result = await renderScatterPyramid({
      device,
      sampler: {},
      downsamplePipeline: { getBindGroupLayout: () => ({}) } as GpuRenderPipeline,
      upsamplePipeline: { getBindGroupLayout: () => ({}) } as GpuRenderPipeline,
      source: createTexture(),
      width: 64,
      height: 64,
      levels,
      acquireTexture: () => {
        const texture = createTexture()
        textures.push(texture)
        return texture
      },
      releaseTexture: vi.fn(),
    })

    expect(result.scales).toHaveLength(1)
    expect(result.textures).toEqual(textures)
    expect(submit).toHaveBeenCalledTimes(3)
    expect(onSubmittedWorkDone).not.toHaveBeenCalled()
  })
})
