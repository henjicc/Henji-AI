import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ sharedTexture: {} }))
import { WebCacheCapabilityGate } from './capability'
import { WebCacheSubmissions } from './submissions'

const logger = { info: vi.fn(), warn: vi.fn() }

it('GPU 信息补全不使实探失效，设备、驱动或活动显卡变化才作废', async () => {
  let finish!: (value: string) => void
  const gate = new WebCacheCapabilityGate(() => new Promise<string>(resolve => { finish = resolve }), logger, 'win32')
  const device = { vendorId: 1, deviceId: 2, active: true, driverVersion: '1' }
  gate.updateGpuInfo({ gpuDevice: [device] })
  const checking = gate.check()
  gate.updateGpuInfo({ gpuDevice: [{ ...device, deviceString: 'GPU' }], auxAttributes: { initializationTime: 123 } })
  finish('cuda_planar')
  expect(await checking).toMatchObject({ available: true, generation: 0 })
  gate.updateGpuInfo({ gpuDevice: [{ ...device, driverVersion: '2' }] })
  expect(gate.availableGeneration).toBeUndefined()
  const changed = gate.check()
  finish('cuda_planar')
  expect(await changed).toMatchObject({ available: true, generation: 1 })
  gate.updateGpuInfo({ gpuDevice: [{ ...device, driverVersion: '2', active: false }] })
  expect(gate.availableGeneration).toBeUndefined()
})

it('暂停中的能力实探随任务取消，取消不形成设备失败冷却', async () => {
  const submissions = new WebCacheSubmissions(logger), controller = new AbortController()
  const hold = submissions.hold('playing')
  const probe = vi.fn(async (control?: import('./capability').WebCacheProbeControl): Promise<string> =>
    control ? control.submissions.run(async () => 'cuda_planar', control.signal) : 'cuda_planar')
  const gate = new WebCacheCapabilityGate(probe, logger, 'win32')
  const cancelled = expect(gate.check({ submissions, signal: controller.signal })).rejects.toThrow('取消实探')
  controller.abort(new Error('取消实探'))
  await cancelled
  expect(submissions.state.submitted).toBe(0)
  hold.resume()
  expect(await gate.check({ submissions, signal: new AbortController().signal })).toMatchObject({ available: true })
  expect(probe).toHaveBeenCalledTimes(2)
})

it('共享实探的等待者可独立取消，发起者取消后其他段等清理完成再实探', async () => {
  const submissions = new WebCacheSubmissions(logger), hold = submissions.hold('playing')
  const probe = vi.fn(async (control?: import('./capability').WebCacheProbeControl): Promise<string> =>
    control!.submissions.run(async () => 'cuda_planar', control!.signal))
  const gate = new WebCacheCapabilityGate(probe, logger, 'win32')
  const first = new AbortController(), second = new AbortController(), third = new AbortController()
  const cancelledFirst = expect(gate.check({ submissions, signal: first.signal })).rejects.toThrow('取消发起段')
  const cancelledSecond = expect(gate.check({ submissions, signal: second.signal })).rejects.toThrow('取消等待段')
  const survivor = gate.check({ submissions, signal: third.signal })
  second.abort(new Error('取消等待段')); await cancelledSecond
  expect(probe).toHaveBeenCalledTimes(1)
  first.abort(new Error('取消发起段')); await cancelledFirst
  hold.resume()
  expect(await survivor).toMatchObject({ available: true })
  expect(probe).toHaveBeenCalledTimes(2)
  expect(submissions.state.submitted).toBe(1)
})

it('能力探测并发合并，资源不足冷却后重试，通过结果只在当前设备代次复用', async () => {
  let now = 0
  const probe = vi.fn(async (): Promise<string> => 'cuda_planar').mockRejectedValueOnce(new Error('NVENC resources'))
  const gate = new WebCacheCapabilityGate(probe, logger, 'win32', () => now)
  const first = await Promise.all([gate.check(), gate.check()])
  expect(first[0]).toEqual(first[1])
  expect(first[0]).toMatchObject({ available: false, reason: 'probe-failed' })
  await gate.check()
  expect(probe).toHaveBeenCalledTimes(1)
  now = 30_000
  expect(await gate.check()).toMatchObject({ available: true })
  await gate.check()
  expect(probe).toHaveBeenCalledTimes(2)
  gate.invalidate()
  expect(await gate.check()).toMatchObject({ available: true, generation: 1 })
  expect(probe).toHaveBeenCalledTimes(3)
})

it('设备在实探途中变化不能发布迟到的成功，且不重叠启动探测', async () => {
  let finish!: (value: string) => void
  const probe = vi.fn(() => new Promise<string>(resolve => { finish = resolve }))
  const gate = new WebCacheCapabilityGate(probe, logger, 'win32')
  const before = gate.check()
  gate.invalidate()
  const during = gate.check()
  expect(probe).toHaveBeenCalledTimes(1)
  finish('cuda_planar')
  expect(await before).toMatchObject({ available: false, reason: 'environment-changed' })
  expect(await during).toMatchObject({ available: false })
  const next = gate.check()
  finish('cuda_planar')
  expect(await next).toMatchObject({ available: true, generation: 1 })
  const mac = new WebCacheCapabilityGate(probe, logger, 'darwin')
  expect(await mac.check()).toMatchObject({ available: false, reason: 'platform' })
  expect(probe).toHaveBeenCalledTimes(2)
})
