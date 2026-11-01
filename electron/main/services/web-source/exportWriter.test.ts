import { expect, it, vi } from 'vitest'
import type { WebTimePublishOptions } from './publication'
import type { WebCacheRegistrations } from './registration'
import type { WebSourcePage } from './page'
import type { WebCacheCapabilityGate } from './capability'
import type { WebCacheLocks } from './locks'
import { WebCacheExportWriter } from './exportWriter'

const boundary = vi.hoisted(() => ({ fail: false, received: [] as number[], dispose: vi.fn() }))
vi.mock('../web-replay/player/gpuCapture', () => ({ GpuFrameCapture: class { async open() {} dispose = boundary.dispose } }))
vi.mock('./publication', () => ({ publishWebTimeSegment: async (options: WebTimePublishOptions) => {
  for await (const frame of options.frames(options.signal!, options.selectors!)) {
    boundary.received.push(frame.time)
    if (boundary.fail) throw new Error('磁盘写入失败')
  }
} }))

it('导出连续可靠帧直接进入发布器，缺段不重演、写入失败不使已交付画面失败', async () => {
  const controller = new AbortController(), environment = { signature: 'env', current: async () => true, close: vi.fn() }
  const registration = { current: true, signal: controller.signal, batch: {}, environment: async () => environment }
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, published = vi.fn()
  const captureReliable = vi.fn(async (time: number) => ({ time, boxes: null }))
  const page = { streamId: 'export-page', contentHash: 'hash', duration: 4, signal: controller.signal, capturePath: { captureMode: 'html-in-canvas' },
    view: { width: 100, height: 100, region: [0, 0, 100, 100], scale: 1 }, captureReliable } as unknown as WebSourcePage
  const writer = new WebCacheExportWriter({ registrations: { get: () => registration } as unknown as WebCacheRegistrations,
    capability: { availableGeneration: 0, check: async () => ({ available: true }) } as unknown as WebCacheCapabilityGate, locks: {} as WebCacheLocks,
    cacheRoot: () => 'cache', published, logger })
  const request = { streamId: page.streamId, time: 0, ticket: 'export', precision: 'exact' as const, cacheWrite: true,
    cacheGrid: { rate: { numerator: 1, denominator: 1 }, phase: { numerator: '0', denominator: '1' } } }
  try {
    expect(await writer.capture(page, { ...request, cacheWrite: false })).toBeUndefined()
    expect(await writer.capture(page, { ...request, time: 1 })).toBeUndefined()
    expect(captureReliable).not.toHaveBeenCalled()
    expect(await writer.capture(page, request)).toMatchObject({ provenance: 'live' })
    expect(await writer.capture(page, { ...request, time: 1 })).toMatchObject({ provenance: 'live' })
    expect(boundary.received).toEqual([0, 1])
    expect(published).toHaveBeenCalledOnce()
    boundary.fail = true
    expect(await writer.capture(page, { ...request, time: 2 })).toMatchObject({ provenance: 'live' })
    expect(await writer.capture(page, { ...request, time: 3 })).toBeUndefined()
    expect(captureReliable.mock.calls.map(([time]) => time)).toEqual([0, 1, 2])
    expect(published).toHaveBeenCalledOnce()
    boundary.fail = false
    let finish!: () => void
    captureReliable.mockImplementationOnce(async time => {
      await new Promise<void>(resolve => { finish = resolve })
      return { time, boxes: null }
    })
    const cancelled = writer.capture(page, request)
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(writer.cancel(page.streamId, request.ticket)).toBe(true)
    expect(await cancelled).toMatchObject({ dropped: true })
    finish()
  } finally {
    writer.dispose()
    await vi.waitFor(() => expect(boundary.dispose).toHaveBeenCalledOnce())
    expect(environment.close).toHaveBeenCalledOnce()
  }
})

it('硬件链路还没实探时不让导出等：本幅照常实时取帧并在后台实探，通过后下一段写入缓存', async () => {
  boundary.received.length = 0
  const controller = new AbortController(), environment = { signature: 'env', current: async () => true, close: vi.fn() }
  const registration = { current: true, signal: controller.signal, batch: {}, environment: async () => environment }
  const captureReliable = vi.fn(async (time: number) => ({ time, boxes: null }))
  const page = { streamId: 'probe-page', contentHash: 'hash', duration: 4, signal: controller.signal, capturePath: { captureMode: 'html-in-canvas' },
    view: { width: 100, height: 100, region: [0, 0, 100, 100], scale: 1 }, captureReliable } as unknown as WebSourcePage
  let probed!: () => void
  const capability = { availableGeneration: undefined as number | undefined, check: vi.fn(() => new Promise(resolve => { probed = () => { capability.availableGeneration = 0; resolve({ available: true }) } })) }
  const writer = new WebCacheExportWriter({ registrations: { get: () => registration } as unknown as WebCacheRegistrations,
    capability: capability as unknown as WebCacheCapabilityGate, locks: {} as WebCacheLocks, cacheRoot: () => 'cache', published: vi.fn(), logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } })
  const request = { streamId: page.streamId, time: 0, ticket: 'export', precision: 'exact' as const, cacheWrite: true,
    cacheGrid: { rate: { numerator: 1, denominator: 1 }, phase: { numerator: '0', denominator: '1' } } }
  try {
    expect(await writer.capture(page, request)).toBeUndefined()
    expect(capability.check).toHaveBeenCalledOnce()
    probed()
    await vi.waitFor(() => expect(capability.availableGeneration).toBe(0))
    expect(await writer.capture(page, { ...request, time: 1 })).toBeUndefined()
    expect(await writer.capture(page, { ...request, time: 2 })).toMatchObject({ provenance: 'live' })
    expect(boundary.received).toEqual([2])
  } finally { writer.dispose() }
})
