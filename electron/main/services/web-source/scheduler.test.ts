import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WebTimePublishOptions } from './publication'
import type { WebSourcePage } from './page'
import type { WebCacheRegistration } from './registration'
import type { WebCacheSegmentLease } from './locks'
import os from 'node:os'
import { WebCacheScheduler } from './scheduler'
import { WebSnapshotUnsupported } from './snapshotFrames'

const boundary = vi.hoisted(() => ({ attempts: [] as Array<{ index: number; width: number; times: number[]; selectors: readonly string[] }>, close: vi.fn(), fail: false, reliableError: undefined as Error | undefined, stateful: false, color: 0, captures: [] as number[][], pause: undefined as (() => Promise<void>) | undefined }))
vi.mock('../web-replay/player/gpuCapture', () => ({ GpuFrameCapture: class {
  targetContents = { id: 10, mainFrame: {}, isDestroyed: () => false }
  async open() {} async dispose() {}
} }))
vi.mock('./page', () => ({ WebSourcePage: class {
  times: number[] = []
  color = boundary.color
  constructor() { boundary.captures.push(this.times) }
  async open() {} close = boundary.close
  async captureReliable(time: number) {
    if (boundary.reliableError) throw boundary.reliableError
    if (this.times.length && time <= this.times[this.times.length - 1]) throw new Error('不能倒退')
    this.times.push(time)
    return { time, frame: { width: 8, height: 4, bitmap: () => Buffer.alloc(96, boundary.stateful ? this.times.length : time + this.color) }, isCurrent: () => true, validate: async () => true }
  }
} }))
vi.mock('./publication', () => ({ webCacheVariantKey: () => 'variant', publishWebTimeSegment: vi.fn(async (options: WebTimePublishOptions) => {
  const attempt = { index: options.segment.index, width: options.width, times: [] as number[], selectors: options.selectors ?? [] }
  boundary.attempts.push(attempt)
  for await (const frame of options.frames(options.signal!, attempt.selectors)) {
    attempt.times.push(frame.time)
    await boundary.pause?.()
    if (boundary.fail) { boundary.fail = false; throw new Error('NVENC资源不足') }
    options.signal?.throwIfAborted()
  }
  await options.beforePublish?.()
  return {}
}) }))

const grid = { rate: { numerator: 1, denominator: 1 }, phase: { numerator: '0', denominator: '1' } }
const live: WebCacheScheduler[] = []
beforeEach(() => { vi.useFakeTimers(); boundary.attempts = []; boundary.captures = []; boundary.fail = false; boundary.reliableError = undefined; boundary.stateful = false; boundary.color = 0; boundary.pause = undefined; boundary.close.mockClear() })
afterEach(async () => { for (const scheduler of live.splice(0)) { scheduler.dispose(); await scheduler.drained() } vi.useRealTimers() })

function fixture(duration: number | null = 2) {
  const controller = new AbortController(), environment = { signature: 'env', isCurrent: () => true, current: vi.fn(async () => true), close: vi.fn() }
  const registration = { batch: { source: { contentHash: 'hash' } }, current: true, signal: controller.signal, environment: vi.fn(async () => environment) } as unknown as WebCacheRegistration
  const source = { streamId: 'source', folder: { root: 'original-partition' }, view: { width: 3840, height: 2160, region: [0, 0, 3840, 2160], scale: 1 }, duration, capturePath: { captureMode: 'html-in-canvas' } } as WebSourcePage
  const options = { registrations: { get: () => registration }, capability: { check: async () => ({ available: true }) },
    activity: { acquire: async () => ({ current: () => true, release: async () => undefined }) },
    locks: { withSegmentLock: async <T>(_key: string, work: (lease: WebCacheSegmentLease) => Promise<T>, signal: AbortSignal) => work({ signal } as WebCacheSegmentLease) },
    cacheRoot: () => os.tmpdir(), canScan: vi.fn(async () => true), published: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }
  const scheduler = new WebCacheScheduler(options as unknown as ConstructorParameters<typeof WebCacheScheduler>[0]); live.push(scheduler)
  const demand = (time = 0, latest = false, boxes = ['.a']) => scheduler.demand(source, { streamId: 'source', time, latest, boxes, cacheGrid: grid })
  return { scheduler, demand, controller, environment, registration, options }
}

it('当前与邻段优先预览档，暂停才补高档；未知时长不会扩展无限扫描', async () => {
  const { scheduler, demand } = fixture(null)
  demand(4)
  await scheduler.drained()
  expect(boundary.attempts.map(attempt => [attempt.index, attempt.width])).toEqual([[2, 2560], [0, 2560], [1, 2560], [2, 2560], [3, 2560], [1, 3840], [2, 3840]])
  expect(boundary.attempts[0].times).toEqual([4, 5])
  await vi.advanceTimersByTimeAsync(60_000)
  expect(boundary.attempts).toHaveLength(7)
})

it('资源失败释放槽位并从段首向前重演；源撤销取消排队且关闭环境', async () => {
  const { scheduler, demand, controller, environment, options } = fixture()
  boundary.fail = true
  demand(0, true)
  await scheduler.drained()
  expect(boundary.attempts[0].times).toEqual([0])
  expect(boundary.close).toHaveBeenCalledOnce()
  expect(options.published).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(30_000); await scheduler.drained()
  expect(boundary.attempts[1].times).toEqual([0, 1])
  expect(options.published).toHaveBeenCalledOnce()
  controller.abort()
  expect(environment.close).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(boundary.attempts).toHaveLength(2)
})

it('页面不支持可靠快照：移除同内容全部变体，不退槽不重试，新需求也不再开录', async () => {
  const { scheduler, demand, options } = fixture()
  boundary.reliableError = new WebSnapshotUnsupported('网页文档滚动需要普通绘制')
  demand(0)
  await scheduler.drained()
  const attempts = boundary.attempts.length
  expect(attempts).toBeGreaterThan(0)
  await vi.advanceTimersByTimeAsync(120_000)
  demand(1)
  await vi.advanceTimersByTimeAsync(120_000)
  await scheduler.drained()
  expect(boundary.attempts.length).toBe(attempts)
  expect(options.logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'web_source.scheduler.unsupported' }))
  expect(options.logger.warn).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'web_source.scheduler.throttled' }))
})

it('初始化环境期间撤销时关闭迟到环境；录制中新增几何需求不能误标完成', async () => {
  const first = fixture()
  let resolve!: (environment: typeof first.environment) => void
  vi.mocked(first.registration.environment).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  first.demand()
  await vi.advanceTimersByTimeAsync(0)
  first.controller.abort(); resolve(first.environment)
  await first.scheduler.drained()
  expect(first.environment.close).toHaveBeenCalledOnce()
  expect(boundary.attempts).toHaveLength(0)
  const second = fixture()
  boundary.pause = async () => { boundary.pause = undefined; second.demand(0, true, ['.a', '.b']) }
  second.demand(0, true)
  await second.scheduler.drained()
  expect(boundary.attempts.map(attempt => attempt.selectors)).toEqual([['.a'], ['.a', '.b']])
})

it('多槽交叠不一致不发布该组，仅该来源降为同页从零顺序录制', async () => {
  const { scheduler, demand, options } = fixture(4.1)
  boundary.stateful = true
  demand(0, true)
  await scheduler.drained()
  expect(options.logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'web_source.scheduler.overlap_failed' }))
  // 首段成功后扩槽，失败组没有提交；单页重新录制三段。
  expect(options.published).toHaveBeenCalledTimes(4)
  expect(boundary.captures.at(-1)).toEqual([0, 1, 2, 3, 4])
  expect(boundary.attempts.map(attempt => attempt.index)).toEqual([0, 0, 1, 0, 1, 2])
  expect(boundary.close).toHaveBeenCalledTimes(boundary.captures.length)
})

it('多槽某槽失败唤醒交叠等待者，全部退槽释放，冷却后保留可重试能力', async () => {
  const { scheduler, demand, options } = fixture(2.1)
  let failed = false
  boundary.pause = async () => {
    if (!failed && boundary.attempts.length > 1) { failed = true; boundary.fail = true }
  }
  demand(0, true)
  await scheduler.drained()
  expect(options.published).toHaveBeenCalledOnce()
  expect(boundary.close).toHaveBeenCalledTimes(boundary.captures.length)
  expect(options.logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'web_source.scheduler.throttled' }))
  boundary.pause = undefined
  await vi.advanceTimersByTimeAsync(30_000); await scheduler.drained()
  expect(options.published.mock.calls.length).toBeGreaterThan(1)
  expect(options.logger.warn).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'web_source.scheduler.overlap_failed' }))
})

it('跨组新页面相互一致但与已发布边界不同，也必须拒绝并顺序重录', async () => {
  const { scheduler, demand, options } = fixture(6.1)
  let published = 0
  options.published.mockImplementation(() => { if (++published === 3) boundary.color = 20 })
  demand(0, true)
  await scheduler.drained()
  expect(options.logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'web_source.scheduler.overlap_failed' }))
  expect(options.published).toHaveBeenCalledTimes(7)
  expect(boundary.captures.at(-1)).toEqual([0, 1, 2, 3, 4, 5, 6])
})

it('新增几何清空就绪集合后，降级仍重录此前全部已发布段', async () => {
  const { scheduler, demand, options } = fixture(8.1)
  demand(0, true)
  await scheduler.drained()
  const published = options.published.mock.calls.length
  boundary.color = 20
  demand(6, true, ['.a', '.b'])
  await scheduler.drained()
  expect(options.published.mock.calls.length - published).toBe(5)
  expect(boundary.attempts.slice(-5).map(attempt => attempt.index)).toEqual([0, 1, 2, 3, 4])
  expect(boundary.captures.at(-1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
})

it('前台抢占期间显存紧张就释放本组会话：段重新排队、不退槽，前台结束后从段首重演', async () => {
  const { scheduler, demand, options } = fixture(2)
  const activity = options.activity as { active?: boolean }
  activity.active = true
  const memoryTight = vi.fn(async () => ({ tight: true, context: { budgetBytes: 512, currentUsageBytes: 0 } }))
  Object.assign(options, { memoryTight })
  let paused!: () => void
  const recording = new Promise<void>(resolve => { paused = resolve })
  boundary.pause = () => { paused(); return new Promise(resolve => setTimeout(resolve, 3_000)) }
  demand(0)
  await recording
  await vi.advanceTimersByTimeAsync(2_100)
  expect(memoryTight).toHaveBeenCalled()
  expect(options.logger.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'web_source.record.released' }))
  boundary.pause = undefined; activity.active = false
  await vi.advanceTimersByTimeAsync(5_000)
  await scheduler.drained()
  expect(boundary.attempts.filter(attempt => attempt.index === 0).length).toBeGreaterThanOrEqual(2)
  expect(boundary.attempts.filter(attempt => attempt.index === 0).at(-1)?.times[0]).toBe(0)
  expect(options.logger.warn).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'web_source.scheduler.throttled' }))
})
