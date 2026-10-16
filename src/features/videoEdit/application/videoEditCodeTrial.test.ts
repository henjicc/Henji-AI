import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { videoEditComposition } from '@/core/videoEdit/document'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'

const boundary = vi.hoisted(() => ({ present: vi.fn(), dispose: vi.fn(), construct: vi.fn() }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor() { boundary.construct() }
  present = boundary.present
  dispose = boundary.dispose
  async updateDocument() {}
} }))
function frames() { const document = createVideoEditTestDocument('试渲染'); return [{ document: videoEditComposition(document, document.sequences[0].id), frame: 0 }] }
function result() { return { presented: true, bitmap: { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap } }
beforeEach(() => { vi.clearAllMocks(); boundary.present.mockResolvedValue(result()); boundary.dispose.mockResolvedValue(undefined) })
afterEach(() => { vi.useRealTimers() })
it('等待中的中止立即返回，但重启请求仍等待前项；不创建多余renderer', async () => {
  let finish!: (value: ReturnType<typeof result>) => void
  boundary.present.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const input = frames(); const first = trialVideoEditCodeFrames(input, new AbortController().signal)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  const controller = new AbortController(); const cancelled = trialVideoEditCodeFrames(input, controller.signal)
  const assertion = expect(cancelled).rejects.toThrow(); controller.abort(); await assertion
  const restarted = trialVideoEditCodeFrames(input, new AbortController().signal)
  await Promise.resolve(); expect(boundary.construct).toHaveBeenCalledOnce()
  finish(result()); await first; await restarted; expect(boundary.construct).toHaveBeenCalledTimes(2)
})
it('活动请求中止释放队列，迟到bitmap关闭，下一项正常完成', async () => {
  let finish!: (value: ReturnType<typeof result>) => void
  boundary.present.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const input = frames(); const controller = new AbortController()
  const cancelled = trialVideoEditCodeFrames(input, controller.signal)
  const assertion = expect(cancelled).rejects.toThrow()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function')); controller.abort(); await assertion
  await trialVideoEditCodeFrames(input, new AbortController().signal)
  const late = result(); finish(late); await vi.waitFor(() => expect(late.bitmap.close).toHaveBeenCalledOnce())
})
it('单帧卡住30秒后释放队列；后续请求不会被永久阻塞', async () => {
  vi.useFakeTimers()
  boundary.present.mockImplementationOnce(() => new Promise(() => undefined))
  const input = frames(); const stalled = trialVideoEditCodeFrames(input, new AbortController().signal)
  const assertion = expect(stalled).rejects.toThrow('超过30秒')
  await vi.advanceTimersByTimeAsync(0); expect(boundary.present).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(30_000); await assertion
  await trialVideoEditCodeFrames(input, new AbortController().signal)
  expect(boundary.dispose).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0)
})
it('并发等待按序处理，不因等待数量拒绝产品条目，单项失败后继续', async () => {
  const input = frames(); const signal = new AbortController().signal
  boundary.present.mockRejectedValueOnce(new Error('单项失败'))
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => trialVideoEditCodeFrames(input, signal)))
  expect(results.map(result => result.status)).toEqual(['rejected', ...Array.from({ length: 7 }, () => 'fulfilled')])
  expect(boundary.construct).toHaveBeenCalledTimes(8); expect(boundary.dispose).toHaveBeenCalledTimes(8)
})

it('按序列帧率回传测量与结构位置，超预算不拒绝画面，预算内也保留复用反馈', async () => {
  const measurements: import('@/core/videoEdit/codeMaterial/performance').CodeFramePerformance[] = []
  const inputs = frames(); inputs[0].document.fps = 60
  const heaviest = { kind: 'repeat', cpuMs: 18, sourceSpan: { file: 'main.ts', start: 0, end: 8, startLine: 2, startColumn: 3, endLine: 2, endColumn: 11 } }
  boundary.present.mockImplementation(async () => ({ ...result(), codePerformance: [{ frame: 0, cpuMs: 20, gpuMs: 4, budgetMs: 1000 / 60, heaviest }] }))
  await trialVideoEditCodeFrames(inputs, new AbortController().signal, false, undefined, measurements)
  expect(measurements).toEqual([expect.objectContaining({ frame: 0, cpuMs: 20, gpuMs: 4, budgetMs: 1000 / 60, heaviest, preparation: expect.objectContaining({ sessionReused: false }), sampling: expect.objectContaining({ mode: 'repeat-frame' }) })])
  measurements.length = 0
  boundary.present.mockImplementation(async () => ({ ...result(), codePerformance: [{ frame: 0, cpuMs: 1, gpuMs: 2, budgetMs: 1000 / 60 }] }))
  await trialVideoEditCodeFrames(inputs, new AbortController().signal, false, undefined, measurements)
  expect(measurements).toEqual([expect.objectContaining({ frame: 0, cpuMs: 1, gpuMs: 2, budgetMs: 1000 / 60 })])
})

it('首次准备独立记录，前一帧预热后重画目标，不把整帧缓存当播放成本', async () => {
  const inputs = frames(); inputs[0].frame = 96
  const measurements: import('@/core/videoEdit/codeMaterial/performance').CodeFramePerformance[] = []
  const cold = { ...result(), codePerformance: [{ frame: 96, cpuMs: 10, gpuMs: 300, budgetMs: 33 }] }
  const neighbour = result()
  const steady = { ...result(), codePerformance: [{ frame: 96, cpuMs: 2, gpuMs: 8, budgetMs: 33 }] }
  boundary.present.mockResolvedValueOnce(cold).mockResolvedValueOnce(neighbour).mockResolvedValueOnce(steady)
  const kept = await trialVideoEditCodeFrames(inputs, new AbortController().signal, true, undefined, measurements)
  expect(boundary.present.mock.calls.map(call => call[0])).toEqual([96, 95, 96])
  expect(measurements[0]).toMatchObject({ cpuMs: 2, gpuMs: 8, preparation: { cpuMs: 10, gpuMs: 300, sessionReused: false }, sampling: { mode: 'adjacent-frame', precedingFrame: 95 } })
  expect(kept).toBe(steady.bitmap); expect(cold.bitmap.close).toHaveBeenCalledOnce(); expect(neighbour.bitmap.close).toHaveBeenCalledOnce()
  expect(steady.bitmap.close).not.toHaveBeenCalled(); kept!.close()
})

it('相邻诊断帧超预算不改变目标验收，明确标记未取得稳态而保留目标像素', async () => {
  const inputs = frames(); inputs[0].frame = 96
  const measurements: import('@/core/videoEdit/codeMaterial/performance').CodeFramePerformance[] = []
  const cold = { ...result(), codePerformance: [{ frame: 96, cpuMs: 10, gpuMs: 300, budgetMs: 33 }] }
  boundary.present.mockResolvedValueOnce(cold).mockRejectedValueOnce(new Error('相邻帧超出预算'))
  const kept = await trialVideoEditCodeFrames(inputs, new AbortController().signal, true, undefined, measurements)
  expect(kept).toBe(cold.bitmap)
  expect(measurements[0]).toMatchObject({ cpuMs: 10, gpuMs: 300, sampling: { mode: 'unavailable', error: '相邻帧超出预算' } })
  expect(cold.bitmap.close).not.toHaveBeenCalled(); kept!.close()
})

it('末帧和收集模式移交独立位图，销毁会话不提前关闭调用方画面', async () => {
  const first = result(); const last = result(); const input = frames()
  boundary.present.mockResolvedValueOnce(first).mockResolvedValueOnce(last)
  const kept = await trialVideoEditCodeFrames([...input, { ...input[0], frame: 15 }], new AbortController().signal, true)
  expect(kept).toBe(last.bitmap); expect(first.bitmap.close).toHaveBeenCalledOnce()
  expect(last.bitmap.close).not.toHaveBeenCalled(); expect(boundary.dispose).toHaveBeenCalledOnce()
  kept!.close()
  const a = result(); const b = result(); const collected: ImageBitmap[] = []
  boundary.present.mockResolvedValueOnce(a).mockResolvedValueOnce(b)
  expect(await trialVideoEditCodeFrames([...input, { ...input[0], frame: 30 }], new AbortController().signal, false, collected)).toBeUndefined()
  expect(collected).toEqual([a.bitmap, b.bitmap])
  for (const bitmap of collected) { expect(bitmap.close).not.toHaveBeenCalled(); bitmap.close() }
})

it('销毁会话失败不移交末帧，并释放已取得的位图', async () => {
  const pixels = result(); boundary.present.mockResolvedValueOnce(pixels)
  boundary.dispose.mockRejectedValueOnce(new Error('销毁失败'))
  await expect(trialVideoEditCodeFrames(frames(), new AbortController().signal, true)).rejects.toThrow('销毁失败')
  expect(pixels.bitmap.close).toHaveBeenCalledOnce()
})
