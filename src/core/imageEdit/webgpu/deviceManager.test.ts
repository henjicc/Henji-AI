import { describe, expect, it, vi } from 'vitest'
import type {
  GpuAdapter,
  GpuDevice,
} from '../worker/webgpuRuntimeSupport'
import {
  ImageEditWebGpuDeviceManager,
  ImageEditWebGpuInitializationInvalidatedError,
  ImageEditWebGpuRecoveryCooldownError,
} from './deviceManager'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function createDevice(): {
  device: GpuDevice
  lose: (reason?: string) => void
  destroy: ReturnType<typeof vi.fn>
} {
  const lost = deferred<{ reason?: string; message?: string }>()
  const destroy = vi.fn()
  const device = {
    lost: lost.promise,
    destroy,
  } as unknown as GpuDevice
  return {
    device,
    destroy,
    lose: (reason = 'test-device-lost') => lost.resolve({ reason }),
  }
}

function createProvider(requestDevice: () => Promise<GpuDevice>) {
  const adapter = { requestDevice: vi.fn(requestDevice) } as unknown as GpuAdapter
  const requestAdapter = vi.fn(async () => adapter)
  return {
    adapter,
    requestAdapter,
    provider: {
      requestAdapter,
      getPreferredCanvasFormat: () => 'bgra8unorm',
    },
  }
}

describe('ImageEditWebGpuDeviceManager', () => {
  it('并发 acquire 使用 singleflight 且只生成一个设备代际', async () => {
    const pending = deferred<GpuDevice>()
    const gpu = createDevice()
    const { provider, requestAdapter, adapter } = createProvider(() => pending.promise)
    const manager = new ImageEditWebGpuDeviceManager({ getProvider: () => provider })

    const first = manager.acquire()
    const second = manager.acquire()
    pending.resolve(gpu.device)
    const [firstManaged, secondManaged] = await Promise.all([first, second])

    expect(firstManaged).toBe(secondManaged)
    expect(firstManaged.generation).toBe(1)
    expect(requestAdapter).toHaveBeenCalledOnce()
    expect(adapter.requestDevice).toHaveBeenCalledOnce()
    manager.destroy()
  })

  it('初始化期间 invalidate 会销毁迟到设备且禁止挂回旧状态', async () => {
    const pending = deferred<GpuDevice>()
    const gpu = createDevice()
    const { provider } = createProvider(() => pending.promise)
    const manager = new ImageEditWebGpuDeviceManager({ getProvider: () => provider })

    const acquisition = manager.acquire()
    manager.invalidate()
    pending.resolve(gpu.device)

    await expect(acquisition).rejects.toBeInstanceOf(
      ImageEditWebGpuInitializationInvalidatedError
    )
    expect(gpu.destroy).toHaveBeenCalledOnce()
    expect(manager.getRecoveryStatus()).toMatchObject({ state: 'idle', generation: 0 })
    manager.destroy()
  })

  it('旧设备迟到的 lost 不会清掉新一代设备', async () => {
    const firstGpu = createDevice()
    const secondGpu = createDevice()
    const devices = [firstGpu.device, secondGpu.device]
    const { provider } = createProvider(async () => {
      const device = devices.shift()
      if (!device) throw new Error('测试设备耗尽')
      return device
    })
    const manager = new ImageEditWebGpuDeviceManager({ getProvider: () => provider })
    const first = await manager.acquire()
    manager.invalidate()
    const second = await manager.acquire()

    firstGpu.lose('old-device-lost')
    await Promise.resolve()

    expect(first.generation).toBe(1)
    expect(second.generation).toBe(2)
    expect(manager.isCurrent(second.generation)).toBe(true)
    expect(manager.getRecoveryStatus().state).toBe('ready')
    manager.destroy()
  })

  it('连续 device lost 触发有界冷却，冷却结束后才允许恢复', async () => {
    let now = 1_000
    const gpus = Array.from({ length: 4 }, createDevice)
    const devices = gpus.map((entry) => entry.device)
    const { provider, adapter } = createProvider(async () => {
      const device = devices.shift()
      if (!device) throw new Error('测试设备耗尽')
      return device
    })
    const onLost = vi.fn()
    const manager = new ImageEditWebGpuDeviceManager({
      getProvider: () => provider,
      now: () => now,
      recovery: { maxLosses: 3, lossWindowMs: 1_000, cooldownMs: 500 },
    })
    manager.onDeviceLost(onLost)

    for (let index = 0; index < 3; index += 1) {
      await manager.acquire()
      gpus[index].lose(`loss-${index + 1}`)
      await Promise.resolve()
      now += 10
    }

    expect(manager.getRecoveryStatus()).toMatchObject({
      state: 'cooldown',
      recentLosses: 3,
    })
    await expect(manager.acquire()).rejects.toBeInstanceOf(
      ImageEditWebGpuRecoveryCooldownError
    )
    expect(adapter.requestDevice).toHaveBeenCalledTimes(3)
    expect(onLost).toHaveBeenCalledTimes(3)

    now += 500
    const recovered = await manager.acquire()
    expect(recovered.generation).toBe(4)
    expect(adapter.requestDevice).toHaveBeenCalledTimes(4)
    manager.destroy()
  })

  it('destroy 只释放当前设备一次并拒绝后续 acquire', async () => {
    const gpu = createDevice()
    const { provider } = createProvider(async () => gpu.device)
    const manager = new ImageEditWebGpuDeviceManager({ getProvider: () => provider })
    await manager.acquire()

    manager.destroy()
    manager.destroy()

    expect(gpu.destroy).toHaveBeenCalledOnce()
    await expect(manager.acquire()).rejects.toThrow('已销毁')
  })
})
