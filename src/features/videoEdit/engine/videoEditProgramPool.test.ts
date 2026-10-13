// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ memory: vi.fn(), created: 0, dispose: vi.fn(), prepare: vi.fn(), adopt: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ system: { memoryInfo: state.memory } }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }))
vi.mock('./videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor() { state.created++ }
  dispose = state.dispose
  prepareGpu = state.prepare
  adoptProject = state.adopt
} }))
import { retainVideoEditProgramWarmup, takeVideoEditProgram } from './videoEditProgramPool'
const releases: Array<() => void> = []
const retain = (): (() => void) => { const release = retainVideoEditProgramWarmup(); releases.push(release); return release }
beforeEach(() => {
  vi.useFakeTimers(); state.created = 0; state.dispose.mockReset().mockResolvedValue(undefined)
  state.prepare.mockReset().mockResolvedValue(undefined); state.adopt.mockReset()
  state.memory.mockReset().mockResolvedValue({ availableBytes: 4 * 1024 ** 3, totalBytes: 8 * 1024 ** 3 })
  HTMLCanvasElement.prototype.transferControlToOffscreen = vi.fn(() => ({} as OffscreenCanvas))
})
afterEach(async () => { releases.splice(0).forEach(release => release()); await vi.advanceTimersByTimeAsync(5001); vi.useRealTimers() })
it('StrictMode 重挂载只有一个资源，接管转移所有权，过期释放不影响已接管会话', async () => {
  retain()(); retain(); await vi.advanceTimersByTimeAsync(0)
  expect(state.created).toBe(1)
  const entry = takeVideoEditProgram('project', 'sequence')!
  expect(entry.ready).toBe(true); expect(state.adopt).toHaveBeenCalledWith('project')
  expect(takeVideoEditProgram('other', 'sequence')).toBeUndefined()
  releases.forEach(release => release()); await vi.advanceTimersByTimeAsync(5001)
  expect(state.dispose).not.toHaveBeenCalled()
})
it('离开工作区五秒后释放，重新进入可重新预建', async () => {
  const release = retain(); await vi.advanceTimersByTimeAsync(0); release()
  await vi.advanceTimersByTimeAsync(4999); expect(state.dispose).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1); expect(state.dispose).toHaveBeenCalledOnce()
  retain(); await vi.advanceTimersByTimeAsync(0); expect(state.created).toBe(2)
})
it('系统内存不足时回收空闲资源且不重建，恢复后才能预建', async () => {
  retain(); await vi.advanceTimersByTimeAsync(0)
  state.memory.mockResolvedValue({ availableBytes: 128 * 1024 ** 2, totalBytes: 8 * 1024 ** 3 })
  await vi.advanceTimersByTimeAsync(5000)
  expect(state.dispose).toHaveBeenCalledOnce(); expect(takeVideoEditProgram('p', 's')).toBeUndefined()
  await vi.advanceTimersByTimeAsync(5000); expect(state.created).toBe(1)
  state.memory.mockResolvedValue({ availableBytes: 4 * 1024 ** 3, totalBytes: 8 * 1024 ** 3 })
  await vi.advanceTimersByTimeAsync(5000); expect(state.created).toBe(2)
})
it('准备失败销毁资源，不交给节目；退出期间迟到的内存检查不创建 Worker', async () => {
  state.prepare.mockRejectedValueOnce(new Error('device lost'))
  retain(); await vi.advanceTimersByTimeAsync(0)
  expect(state.dispose).toHaveBeenCalledOnce(); expect(takeVideoEditProgram('p', 's')).toBeUndefined()
  releases.forEach(release => release()); await vi.advanceTimersByTimeAsync(5001)
  let resolve!: (memory: { availableBytes: number; totalBytes: number }) => void
  state.memory.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  retain()(); resolve({ availableBytes: 4 * 1024 ** 3, totalBytes: 8 * 1024 ** 3 })
  await vi.advanceTimersByTimeAsync(0); expect(state.created).toBe(1)
})

it('就绪后的设备失效会回收空闲会话，当前工作区不反复创建失败资源', async () => {
  retain(); await vi.advanceTimersByTimeAsync(0)
  state.prepare.mockRejectedValue(new Error('device lost'))
  await vi.advanceTimersByTimeAsync(5000)
  expect(state.dispose).toHaveBeenCalledOnce()
  expect(takeVideoEditProgram('p', 's')).toBeUndefined()
  await vi.advanceTimersByTimeAsync(10000); expect(state.created).toBe(1)
})
