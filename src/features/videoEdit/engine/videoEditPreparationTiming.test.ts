import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginVideoEditGpuFrame, enableVideoEditRenderDiagnostics, probeVideoEditTask, takeVideoEditGpuFrame, videoEditDeliveryStages, videoEditGpuSpanStages, videoEditGpuTimer, videoEditLagSummary, videoEditPreparationSnapshot } from './videoEditPreparationTiming'

afterEach(() => { enableVideoEditRenderDiagnostics(false); videoEditLagSummary(); vi.useRealTimers() })

function timestampDevice(features: string[]) {
  const passes: unknown[] = []
  const encoder = { beginComputePass: vi.fn((descriptor: unknown) => { passes.push(descriptor); return { end: () => {} } }), resolveQuerySet: vi.fn(), copyBufferToBuffer: vi.fn(), finish: () => ({}) }
  const read = { mapAsync: vi.fn(async () => {}), getMappedRange: () => new BigUint64Array([1_000_000n, 4_000_000n, 5_000_000n, 7_500_000n]).buffer, unmap: () => {}, destroy: () => {} }
  return { passes, encoder, device: { features: new Set(features), createQuerySet: vi.fn(() => ({})), createBuffer: vi.fn(() => read), createCommandEncoder: () => encoder, queue: { submit: vi.fn() } } }
}

describe('剪辑渲染诊断', () => {
  it('关闭时不起探针、不建 GPU 计时器，任务标签直接执行', () => {
    vi.useFakeTimers()
    const { device } = timestampDevice(['timestamp-query'])
    expect(videoEditGpuTimer(device)).toBeUndefined()
    expect(device.createQuerySet).not.toHaveBeenCalled()
    expect(probeVideoEditTask('lookahead.update', () => 7)).toBe(7)
    vi.advanceTimersByTime(100)
    expect(vi.getTimerCount()).toBe(0)
    expect(Object.keys(videoEditPreparationSnapshot()).filter(key => key.startsWith('lag.'))).toEqual([])
  })

  it('设备不支持时间戳时退化为不计时', () => {
    enableVideoEditRenderDiagnostics(true)
    const { device } = timestampDevice([])
    expect(videoEditGpuTimer(device)).toBeUndefined()
    expect(device.createQuerySet).not.toHaveBeenCalled()
  })

  it('作者入口与合成提交的打点在帧尾解析成 gpu.* 分段', async () => {
    enableVideoEditRenderDiagnostics(true)
    const { device, encoder, passes } = timestampDevice(['timestamp-query'])
    const timer = videoEditGpuTimer(device)!
    const author = timer.begin('author'); timer.end(author)
    const composite = timer.begin('composite', encoder); timer.end(composite, encoder)
    timer.finishFrame(encoder)
    expect(passes).toHaveLength(4)
    expect(device.queue.submit).toHaveBeenCalledTimes(2)
    expect(encoder.resolveQuerySet).toHaveBeenCalledWith(expect.anything(), 0, 4, expect.anything(), 0)
    expect(await takeVideoEditGpuFrame()).toEqual({ 'gpu.author': 3, 'gpu.composite': 2.5, 'gpu.frame': 6.5 })
    expect(takeVideoEditGpuFrame()).toBeUndefined()
  })

  it('没上屏的请求留下的作者段不算进下一帧', async () => {
    enableVideoEditRenderDiagnostics(true)
    const { device, encoder } = timestampDevice(['timestamp-query'])
    const timer = videoEditGpuTimer(device)!
    beginVideoEditGpuFrame()
    const stale = timer.begin('author'); timer.end(stale)
    const unfinished = timer.begin('author')
    beginVideoEditGpuFrame()
    timer.end(unfinished)
    const composite = timer.begin('composite', encoder); timer.end(composite, encoder)
    timer.finishFrame(encoder)
    expect(encoder.resolveQuerySet).toHaveBeenCalledWith(expect.anything(), 0, 2, expect.anything(), 0)
    expect(Object.keys(await takeVideoEditGpuFrame() ?? {})).toEqual(['gpu.composite', 'gpu.frame'])
  })

  it('迟滞汇总按计数累计，超出归属保留条数时标出截断', () => {
    vi.useFakeTimers()
    let clock = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    enableVideoEditRenderDiagnostics(true)
    for (let index = 0; index < 600; index++) { clock += 14; vi.advanceTimersByTime(4) }
    const summary = videoEditLagSummary()
    expect(summary).toMatchObject({ stalls: 600, attributionTruncated: true })
    expect(summary.totalMs).toBeGreaterThan(600 * 9.9)
    expect(summary.worst).toHaveLength(8)
    expect(videoEditLagSummary()).toMatchObject({ stalls: 0, attributionTruncated: false })
    now.mockRestore()
  })

  it('没写入或倒序的时间戳不计入', () => {
    expect(videoEditGpuSpanStages([0n, 5n, 9n, 3n], [{ label: 'author', begin: 0, end: 1 }, { label: 'composite', begin: 2, end: 3 }, { label: 'author', begin: 1 }])).toEqual({})
  })

  it('投递延迟按探针记下的阻塞拆出任务标签', () => {
    vi.useFakeTimers()
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    enableVideoEditRenderDiagnostics(true)
    now.mockReturnValue(1)
    probeVideoEditTask('lookahead.update', () => { now.mockReturnValue(21) })
    now.mockReturnValue(30)
    vi.advanceTimersByTime(4)
    const sentAt = performance.timeOrigin + 2, receivedAt = performance.timeOrigin + 30
    const stages = videoEditDeliveryStages(sentAt, receivedAt)
    expect(stages['lag.delivery']).toBeCloseTo(28)
    expect(stages['lag.blocked']).toBeCloseTo(26)
    expect(stages['lag.blocked.task.lookahead.update']).toBeCloseTo(20)
    expect(stages['lag.blocked.unlabeled']).toBeCloseTo(6)
    expect(videoEditLagSummary()).toMatchObject({ stalls: 1, maxMs: 26, attributionTruncated: false })
    now.mockRestore()
  })
})
