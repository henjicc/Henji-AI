import { expect, it, vi } from 'vitest'
import type { WebTimePublishOptions } from './publication'
import type { WebCacheRegistrations } from './registration'
import type { WebSourcePage } from './page'
import type { WebCacheCapabilityGate } from './capability'
import type { WebCacheLocks } from './locks'
import { WebCacheExportWriter } from './exportWriter'

const boundary = vi.hoisted(() => ({ fail: false, gate: Promise.resolve(), received: [] as number[], dispose: vi.fn(), open: vi.fn(async () => undefined) }))
vi.mock('../web-replay/player/gpuCapture', () => ({ GpuFrameCapture: class { open = boundary.open; dispose = boundary.dispose } }))
vi.mock('./publication', () => ({ publishWebTimeSegment: async (options: WebTimePublishOptions) => {
  await boundary.gate
  for await (const frame of options.frames(options.signal!, options.selectors!)) {
    boundary.received.push(frame.time)
    if (boundary.fail) throw new Error('磁盘写入失败')
  }
} }))

function setup(view = { width: 100, height: 100, region: [0, 0, 100, 100], scale: 1 }, rate = 1, duration = 4) {
  boundary.received.length = 0; boundary.fail = false; boundary.gate = Promise.resolve(); boundary.dispose.mockClear(); boundary.open.mockReset()
  const controller = new AbortController(), environment = { signature: 'env', current: async () => true, close: vi.fn() }
  const registration = { current: true, signal: controller.signal, batch: {}, environment: async () => environment }
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, published = vi.fn()
  const read = vi.fn(async (time: number) => ({ time, boxes: null }))
  const captureExport = vi.fn(async (time: number, _ticket: string, _reader: unknown, _selectors: unknown, _signal: unknown, _scale: unknown, readBack: () => boolean) =>
    ({ boxes: null, ...(readBack() ? { reliable: read(time) } : {}) }))
  const page = { streamId: 'export-page', contentHash: 'hash', duration, signal: controller.signal, capturePath: { captureMode: 'html-in-canvas' }, view, captureExport } as unknown as WebSourcePage
  const writer = new WebCacheExportWriter({ registrations: { get: () => registration } as unknown as WebCacheRegistrations,
    capability: { availableGeneration: 0, check: async () => ({ available: true }) } as unknown as WebCacheCapabilityGate, locks: {} as WebCacheLocks,
    cacheRoot: () => 'cache', published, logger })
  const request = { streamId: page.streamId, time: 0, ticket: 'export', precision: 'exact' as const, cacheWrite: true,
    cacheGrid: { rate: { numerator: rate, denominator: 1 }, phase: { numerator: '0', denominator: '1' } } }
  // 会话在后台打开，首幅照常实时取帧；之后一轮事件循环会话就绪。
  const prime = async (): Promise<void> => { expect(await writer.capture(page, request)).toBeUndefined(); await tick() }
  return { writer, page, request, captureExport, read, published, logger, environment, prime }
}
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

it('导出帧交付即返回，可靠帧在后台进入发布器；缺段不重演，写入失败只结束本段', async () => {
  const { writer, page, request, captureExport, published, logger, prime } = setup()
  try {
    expect(await writer.capture(page, { ...request, cacheWrite: false })).toBeUndefined()
    await prime()
    expect(await writer.capture(page, { ...request, time: 1 })).toBeUndefined()
    expect(captureExport).not.toHaveBeenCalled()
    expect(await writer.capture(page, request)).toMatchObject({ provenance: 'live' })
    expect(await writer.capture(page, { ...request, time: 1 })).toMatchObject({ provenance: 'live' })
    await vi.waitFor(() => expect(published).toHaveBeenCalledOnce())
    expect(boundary.received).toEqual([0, 1])
    boundary.fail = true
    expect(await writer.capture(page, { ...request, time: 2 })).toMatchObject({ provenance: 'live' })
    await vi.waitFor(() => expect(logger.debug).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'web_source.export_cache.skipped' })))
    await tick()
    expect(await writer.capture(page, { ...request, time: 3 })).toBeUndefined()
    expect(captureExport.mock.calls.map(([time]) => time)).toEqual([0, 1, 2])
    expect(published).toHaveBeenCalledOnce()
    let finish!: () => void
    captureExport.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { finish = resolve })
      return { boxes: null }
    })
    const cancelled = writer.capture(page, request)
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(writer.cancel(page.streamId, request.ticket)).toBe(true)
    expect(await cancelled).toMatchObject({ dropped: true })
    // 取消的这一幅段内还没取到：段立即放弃，不等下一幅来发现缺口。
    await vi.waitFor(() => expect(logger.debug).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ context: expect.objectContaining({ reason: '精确导出网页取帧已取消' }) })))
    finish()
  } finally {
    writer.dispose()
    await vi.waitFor(() => expect(boundary.dispose).toHaveBeenCalledOnce())
  }
})

it('编码器卡住时导出照常交付；积压超过上限放弃本段，按退避跳过下一段再试', async () => {
  // 8192² 平面444每幅约 201MB，积压上限只容两幅。
  const { writer, page, request, captureExport, published, logger, prime } = setup({ width: 8192, height: 8192, region: [0, 0, 8192, 8192], scale: 1 }, 5, 10)
  let open!: () => void
  boundary.gate = new Promise(resolve => { open = resolve })
  try {
    await prime()
    for (const time of [0, .2, .4]) expect(await writer.capture(page, { ...request, time })).toMatchObject({ provenance: 'live' })
    expect(boundary.received).toEqual([])
    expect(logger.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'web_source.export_cache.behind' }))
    expect(await writer.capture(page, { ...request, time: .6 })).toBeUndefined()
    expect(await writer.capture(page, { ...request, time: 2 })).toBeUndefined()
    expect(captureExport).toHaveBeenCalledTimes(3)
    expect(await writer.capture(page, { ...request, time: 4 })).toMatchObject({ provenance: 'live' })
    expect(captureExport).toHaveBeenCalledTimes(4)
    open()
    await vi.waitFor(() => expect(logger.debug).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'web_source.export_cache.skipped' })))
    expect(published).not.toHaveBeenCalled()
  } finally { writer.dispose() }
})

it('读回最多同时两幅，第三幅不再占用浏览器纹理；预热中排满只放弃本段，预热后才退避', async () => {
  const { writer, page, request, read, logger, prime } = setup(undefined, 5, 10)
  read.mockImplementation(() => new Promise(() => undefined))
  try {
    await prime()
    for (const time of [0, .2, .4]) expect(await writer.capture(page, { ...request, time })).toMatchObject({ provenance: 'live' })
    expect(read).toHaveBeenCalledTimes(2)
    expect(logger.info).not.toHaveBeenCalled()
  } finally { writer.dispose() }
  const warmed = setup(undefined, 5, 10)
  warmed.read.mockImplementationOnce(async time => ({ time, boxes: null }))
  warmed.read.mockImplementation(() => new Promise(() => undefined))
  try {
    await warmed.prime()
    for (const time of [0, .2, .4, .6]) expect(await warmed.writer.capture(warmed.page, { ...request, time })).toMatchObject({ provenance: 'live' })
    expect(warmed.read).toHaveBeenCalledTimes(3)
    expect(warmed.logger.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'web_source.export_cache.behind', context: expect.objectContaining({ readings: 2 }) }))
  } finally { warmed.writer.dispose() }
})

it('关闭来源时等收齐帧的段编码发布完，再交还页面资源', async () => {
  const { writer, page, request, published, environment, prime } = setup()
  let open!: () => void
  boundary.gate = new Promise(resolve => { open = resolve })
  await prime()
  expect(await writer.capture(page, request)).toMatchObject({ provenance: 'live' })
  expect(await writer.capture(page, { ...request, time: 1 })).toMatchObject({ provenance: 'live' })
  let closed = false
  const closing = writer.close(page.streamId)!.then(() => { closed = true })
  await tick()
  expect(closed).toBe(false)
  expect(boundary.dispose).not.toHaveBeenCalled()
  open()
  await closing
  expect(published).toHaveBeenCalledOnce()
  expect(boundary.received).toEqual([0, 1])
  expect(environment.close).toHaveBeenCalledOnce()
  expect(boundary.dispose).toHaveBeenCalledOnce()
})

it('硬件链路还没实探时不让导出等：本幅照常实时取帧并在后台实探，通过后下一段写入缓存', async () => {
  const { page, request, logger } = setup()
  let probed!: () => void
  const capability = { availableGeneration: undefined as number | undefined, check: vi.fn(() => new Promise(resolve => { probed = () => { capability.availableGeneration = 0; resolve({ available: true }) } })) }
  const registration = { current: true, signal: page.signal, batch: {}, environment: async () => ({ signature: 'env', current: async () => true, close: vi.fn() }) }
  const writer = new WebCacheExportWriter({ registrations: { get: () => registration } as unknown as WebCacheRegistrations,
    capability: capability as unknown as WebCacheCapabilityGate, locks: {} as WebCacheLocks, cacheRoot: () => 'cache', published: vi.fn(), logger })
  try {
    expect(await writer.capture(page, request)).toBeUndefined()
    expect(capability.check).toHaveBeenCalledOnce()
    probed()
    await vi.waitFor(() => expect(capability.availableGeneration).toBe(0))
    expect(await writer.capture(page, { ...request, time: 1 })).toBeUndefined()
    await tick()
    expect(await writer.capture(page, { ...request, time: 2 })).toMatchObject({ provenance: 'live' })
    await vi.waitFor(() => expect(boundary.received).toEqual([2]))
  } finally { writer.dispose() }
})

it('读回失败放弃本段并退避留日志；交付后没读回的一幅同样立即放弃本段', async () => {
  const { writer, page, request, captureExport, read, logger, prime } = setup(undefined, 1, 10)
  try {
    await prime()
    read.mockRejectedValueOnce(new Error('网页快照身份校验失败或已失效'))
    expect(await writer.capture(page, request)).toMatchObject({ provenance: 'live' })
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'web_source.export_cache.read_failed', error: expect.any(Error), context: expect.objectContaining({ skipSegments: 1 }) })))
    expect(await writer.capture(page, { ...request, time: 2 })).toBeUndefined()
    captureExport.mockImplementationOnce(async () => ({ boxes: null }))
    expect(await writer.capture(page, { ...request, time: 4 })).toMatchObject({ provenance: 'live' })
    await vi.waitFor(() => expect(logger.debug).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ context: expect.objectContaining({ segment: 2, reason: '精确导出网页画面没有进入缓存' }) })))
    expect(await writer.capture(page, { ...request, time: 5 })).toBeUndefined()
    expect(captureExport).toHaveBeenCalledTimes(2)
  } finally { writer.dispose() }
})

it('读回窗口打不开时记住失败，本页不再每幅重开', async () => {
  const { writer, page, request, logger, environment } = setup()
  boundary.open.mockRejectedValue(new Error('重演取帧窗口不能用 WebGPU'))
  try {
    for (const time of [0, 1, 2]) { expect(await writer.capture(page, { ...request, time })).toBeUndefined(); await tick() }
    expect(boundary.open).toHaveBeenCalledOnce()
    expect(environment.close).toHaveBeenCalledOnce()
    expect(logger.warn).toHaveBeenCalledOnce()
  } finally { writer.dispose() }
})
