import { afterEach, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditGpuDeviceLostError, VideoEditGpuFrameError } from './videoEditGpuFailure'
import { VideoEditGpuFrameFences } from './videoEditGpuFrameFence'

afterEach(() => { vi.useRealTimers() })
function fixture(mapAsync: () => Promise<void>, lost: Promise<{ reason?: string; message?: string }> = new Promise(() => {})) {
  const buffers: Array<{ mapAsync: () => Promise<void>; unmap: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = []
  const device = { lost, createBuffer: vi.fn(() => { const buffer = { mapAsync, unmap: vi.fn(), destroy: vi.fn() }; buffers.push(buffer); return buffer }) } as unknown as GpuDevice
  const onLost = vi.fn()
  const encoder = { clearBuffer: vi.fn() }
  return { fences: new VideoEditGpuFrameFences(device, onLost), device, onLost, encoder, buffers }
}
const named = (name: string): Error => Object.assign(new Error(name), { name })

it('栅栏编进提交，结束后复用同一个缓冲', async () => {
  const { fences, encoder, buffers, device } = fixture(async () => {})
  await fences.arm(encoder).wait()
  expect(encoder.clearBuffer).toHaveBeenCalledWith(buffers[0], 0, 4)
  expect(buffers[0].unmap).toHaveBeenCalledOnce()
  await fences.arm(encoder).wait()
  expect(device.createBuffer).toHaveBeenCalledOnce()
})

it('映射中止且设备丢失：当帧报设备丢失，不依赖丢失回调先到', async () => {
  const { fences, encoder, onLost, buffers } = fixture(async () => { throw named('AbortError') }, Promise.resolve({ reason: 'unknown', message: '驱动已重置' }))
  const failure = await fences.arm(encoder).wait().catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(VideoEditGpuDeviceLostError)
  expect((failure as VideoEditGpuDeviceLostError).detail).toBe('驱动已重置')
  expect(onLost).toHaveBeenCalledWith('驱动已重置')
  expect(buffers[0].destroy).toHaveBeenCalledOnce()
})

it('设备丢失时映射报操作错误也判定为设备丢失（规范未规定映射失败的错误名）', async () => {
  const { fences, encoder } = fixture(async () => { throw named('OperationError') }, Promise.resolve({ reason: 'unknown', message: '驱动已重置' }))
  await expect(fences.arm(encoder).wait()).rejects.toBeInstanceOf(VideoEditGpuDeviceLostError)
})

it('设备被自己销毁不算丢失', async () => {
  const { fences, encoder, onLost } = fixture(async () => { throw named('AbortError') }, Promise.resolve({ reason: 'destroyed' }))
  await expect(fences.arm(encoder).wait()).rejects.toMatchObject({ name: 'AbortError' })
  expect(onLost).not.toHaveBeenCalled()
})

it('关闭时被取消的映射不算丢失，也不等设备丢失', async () => {
  let reject!: (error: Error) => void
  const { fences, encoder, onLost } = fixture(() => new Promise((_, rejected) => { reject = rejected }))
  const waiting = fences.arm(encoder).wait()
  fences.dispose()
  reject(named('AbortError'))
  await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
  expect(onLost).not.toHaveBeenCalled()
})

it.each([['AbortError', 2000], ['OperationError', 100]])('%s 而设备没有丢失：有上界地报帧失败，不会一直等', async (name, bound) => {
  vi.useFakeTimers()
  const { fences, encoder, onLost } = fixture(async () => { throw named(name as string) })
  let failure: unknown
  void fences.arm(encoder).wait().catch((error: unknown) => { failure = error })
  await vi.advanceTimersByTimeAsync((bound as number) - 1)
  expect(failure).toBeUndefined()
  await vi.advanceTimersByTimeAsync(1)
  expect(failure).toBeInstanceOf(VideoEditGpuFrameError)
  expect(failure).toMatchObject({ source: 'composite', faults: [name] })
  expect(onLost).not.toHaveBeenCalled()
})
