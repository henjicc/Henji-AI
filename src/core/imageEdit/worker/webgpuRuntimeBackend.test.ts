import { describe, expect, it, vi } from 'vitest'
import type {
  ImageEditWebGpuDeviceLoss,
  ManagedWebGpuDevice,
} from '../webgpu/deviceManager'
import type { GpuDevice } from './webgpuRuntimeSupport'
import {
  WorkerWebGpuRuntimeBackend,
  type WorkerWebGpuState,
} from './webgpuRuntimeBackend'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

class FakeDeviceManager {
  currentGeneration = 1
  invalidate = vi.fn(() => { this.currentGeneration = -1 })
  destroy = vi.fn(() => { this.currentGeneration = -1 })
  private lostHandler: ((reason: string, loss: ImageEditWebGpuDeviceLoss) => void) | null = null

  onDeviceLost(
    handler: (reason: string, loss: ImageEditWebGpuDeviceLoss) => void
  ): void {
    this.lostHandler = handler
  }

  async acquire(): Promise<ManagedWebGpuDevice> {
    throw new Error('测试 stateFactory 不应请求真实设备')
  }

  isCurrent(generation: number): boolean {
    return this.currentGeneration === generation
  }

  lose(generation = this.currentGeneration): void {
    this.currentGeneration = -1
    this.lostHandler?.('test-device-lost', {
      generation,
      reason: 'test-device-lost',
      recovery: {
        state: 'idle',
        generation,
        recentLosses: 1,
        retryAfterMs: 0,
      },
    })
  }
}

function createState(
  generation: number,
  destroyDiffusion = vi.fn(),
  destroyGlow = vi.fn(),
  destroyBlur = vi.fn(),
): WorkerWebGpuState {
  return {
    generation,
    provider: { getPreferredCanvasFormat: () => 'bgra8unorm' },
    adapter: { requestDevice: async () => ({}) as GpuDevice },
    device: {} as GpuDevice,
    sampler: {},
    linearizePipeline: { getBindGroupLayout: () => ({}) },
    encodePipeline: { getBindGroupLayout: () => ({}) },
    diffusionRenderer: { destroy: destroyDiffusion },
    vgpuFastBlurRenderer: { destroy: destroyBlur },
    vgpuFastBlurRendererInitialization: null,
    vgpuGlowRenderer: { destroy: destroyGlow },
    vgpuGlowRendererInitialization: null,
    canvasFormat: 'bgra8unorm',
  } as unknown as WorkerWebGpuState
}

describe('WorkerWebGpuRuntimeBackend lifecycle', () => {
  it('并发 ensureState 共享一次初始化', async () => {
    const pending = deferred<WorkerWebGpuState>()
    const factory = vi.fn(() => pending.promise)
    const manager = new FakeDeviceManager()
    const backend = new WorkerWebGpuRuntimeBackend({
      deviceManager: manager,
      stateFactory: factory,
      stateDestroyer: vi.fn(),
    })
    const first = backend.ensureState()
    const second = backend.ensureState()
    const state = createState(1)
    pending.resolve(state)

    await expect(Promise.all([first, second])).resolves.toEqual([state, state])
    expect(factory).toHaveBeenCalledOnce()
    backend.destroy()
  })

  it('初始化期间 device lost 不会让旧 state 挂回新代际', async () => {
    const firstPending = deferred<WorkerWebGpuState>()
    const secondPending = deferred<WorkerWebGpuState>()
    const destroyState = vi.fn()
    const manager = new FakeDeviceManager()
    const factory = vi.fn()
      .mockImplementationOnce(() => firstPending.promise)
      .mockImplementationOnce(() => secondPending.promise)
    const backend = new WorkerWebGpuRuntimeBackend({
      deviceManager: manager,
      stateFactory: factory,
      stateDestroyer: destroyState,
    })

    const oldInitialization = backend.ensureState()
    manager.lose(1)
    manager.currentGeneration = 2
    const nextInitialization = backend.ensureState()
    const next = createState(2)
    secondPending.resolve(next)
    await expect(nextInitialization).resolves.toBe(next)
    const old = createState(1)
    firstPending.resolve(old)

    await expect(oldInitialization).rejects.toThrow('代际已失效')
    expect(destroyState).toHaveBeenCalledWith(old)
    expect(await backend.ensureState()).toBe(next)
    backend.destroy()
  })

  it('destroy 会释放 diffusion 与 VGPU target/effect 所属 renderer', async () => {
    const destroyDiffusion = vi.fn()
    const destroyGlow = vi.fn()
    const destroyBlur = vi.fn()
    const state = createState(1, destroyDiffusion, destroyGlow, destroyBlur)
    const manager = new FakeDeviceManager()
    const backend = new WorkerWebGpuRuntimeBackend({
      deviceManager: manager,
      stateFactory: async () => state,
    })
    await backend.ensureState()

    backend.destroy()
    backend.destroy()

    expect(destroyDiffusion).toHaveBeenCalledOnce()
    expect(destroyBlur).toHaveBeenCalledOnce()
    expect(destroyGlow).toHaveBeenCalledOnce()
    expect(manager.destroy).toHaveBeenCalledOnce()
  })

  it('恢复初始化会先释放旧 state，再建立唯一的新代际', async () => {
    const first = createState(1)
    const second = createState(2)
    const destroyState = vi.fn()
    const manager = new FakeDeviceManager()
    const factory = vi.fn()
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(async () => {
        manager.currentGeneration = 2
        return second
      })
    const backend = new WorkerWebGpuRuntimeBackend({
      deviceManager: manager,
      stateFactory: factory,
      stateDestroyer: destroyState,
    })
    await backend.ensureState()

    await expect(backend.initialize(true)).resolves.toMatchObject({ available: true })

    expect(manager.invalidate).toHaveBeenCalledOnce()
    expect(destroyState).toHaveBeenCalledWith(first)
    expect(await backend.ensureState()).toBe(second)
    expect(factory).toHaveBeenCalledTimes(2)
    backend.destroy()
  })
})
