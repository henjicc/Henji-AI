import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ value: '', set: vi.fn(), warn: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ settings: {
  get: async () => state.value ? { value: state.value } : undefined,
  set: state.set,
} }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: state.warn }) }))
beforeEach(() => { vi.resetModules(); state.value = ''; state.warn.mockClear(); state.set.mockReset().mockImplementation(async (_key: string, value: string) => { state.value = value }); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

it('按内容指纹保存和重开，内容变化不复用旧观测，样本数量有界', async () => {
  const cache = await import('./videoEditRenderPerformance')
  await cache.loadVideoEditRenderPerformance()
  for (let frame = 0; frame < 650; frame++) cache.recordVideoEditRenderPerformance('content', 60, frame < 50 ? 100 : 5)
  expect(cache.readVideoEditRenderPerformance('content')).toEqual({ sampleFrames: 600, droppedFrames: 0, p90Ms: 5 })
  expect(state.set).not.toHaveBeenCalled()
  await cache.flushVideoEditRenderPerformance()
  vi.resetModules()
  const reopened = await import('./videoEditRenderPerformance')
  await reopened.loadVideoEditRenderPerformance()
  expect(reopened.readVideoEditRenderPerformance('content')?.sampleFrames).toBe(600)
  expect(reopened.readVideoEditRenderPerformance('changed-content')).toBeUndefined()
})

it('写入失败保留内存结果并记日志，未采样的停止不覆盖本机缓存', async () => {
  const cache = await import('./videoEditRenderPerformance')
  await cache.flushVideoEditRenderPerformance()
  expect(state.set).not.toHaveBeenCalled()
  state.set.mockRejectedValueOnce(new Error('磁盘不可用'))
  cache.recordVideoEditRenderPerformance('content', 30, null)
  await cache.flushVideoEditRenderPerformance()
  expect(cache.readVideoEditRenderPerformance('content')?.droppedFrames).toBe(1)
  expect(state.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'video_edit.render_cache.measurement_save_failed' }))
})
