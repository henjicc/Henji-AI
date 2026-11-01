import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { WebCacheReader } from './reader'
import { WebCacheCapabilityGate } from './capability'
import { webCacheVariantKey } from './publication'
import type { WebCacheRegistrations } from './registration'
import type { WebSourcePage } from './page'
import type { WebCacheSegments } from './segments'
import type { VideoDecoderService } from '../video-decoder/client'
import type { VideoFrameBridge, VideoFrameDelivery } from '../video-decoder/texture-bridge'
import type { VideoFrameAtRequest } from '../../../../src/platform/contracts/videoFrameTypes'

it('精确请求不读缓存；跨段共享、几何缺失与取消按同一读取生命周期处理', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-reader-')), controller = new AbortController()
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
  const grid = { rate: { numerator: 1, denominator: 1 }, phase: { numerator: '0', denominator: '1' } }
  const page = { streamId: 'web-page', route: 'renderer', contentHash: 'a'.repeat(64), duration: 4, signal: controller.signal,
    view: { width: 7, height: 5, region: [0, 0, 7, 5], scale: 1 }, target: { id: 1, onGone: () => () => undefined } } as unknown as WebSourcePage
  let environmentValid = true
  const environment = { signature: 'env', isCurrent: () => environmentValid && !controller.signal.aborted, current: async () => environmentValid && !controller.signal.aborted, close: vi.fn() }
  const registration = { batch: { source: { contentHash: page.contentHash } }, signal: controller.signal, current: true, environment: vi.fn(async () => environment) }
  const service = { onLifecycle: () => () => undefined, setDecoderSegment: vi.fn(async () => undefined) } as unknown as VideoDecoderService
  const capture = vi.fn(async (_targetId: number, request: VideoFrameAtRequest, delivery?: VideoFrameDelivery) => {
    expect(delivery).toMatchObject({ route: page.route, width: 7, height: 5 })
    expect(delivery!.accept(request.time * 1e6)).toBe(true)
    return { found: true, ticket: request.ticket }
  })
  const opened = vi.fn(async () => ({ streamId: 'decoder', visibleRect: { width: 8, height: 6 }, decoder: { hardware: true, path: 'cuda_planar' } }))
  const bridge = { openSharedDecoder: opened, frameAt: capture, closeStream: vi.fn(async () => true), cancelFrameAt: vi.fn(() => true) } as unknown as VideoFrameBridge
  const discard = vi.fn(async () => true), touch = vi.fn(async () => undefined), retry = vi.fn()
  const releaseSegment = vi.fn(async () => undefined)
  const segments = { hold: async () => ({ root, lease: { signal: controller.signal, discard }, release: releaseSegment }), touch } as unknown as WebCacheSegments
  const capability = new WebCacheCapabilityGate(async () => 'cuda_planar', logger, 'win32')
  await capability.check()
  const reader = new WebCacheReader({ registrations: { get: () => registration } as unknown as WebCacheRegistrations, service, bridge, segments, capability, logger, retry })
  const key = webCacheVariantKey(page.contentHash, { view: page.view, grid, deviceScaleFactor: 1, environmentSignature: 'env', chromium: process.versions.chrome })
  try {
    for (const index of [0, 1]) {
      const directory = path.join(root, `${key}-${index}`)
      await fs.mkdir(directory)
      const geometry = JSON.stringify({ firstFrame: index * 2, boxes: [{ div: [0, 0, 7, 5] }, { div: [1, 0, 7, 5] }] })
      await fs.writeFile(path.join(directory, 'video.mp4'), 'video')
      await fs.writeFile(path.join(directory, 'geometry.json'), geometry)
      await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ version: 1, variantKey: key, contentHash: page.contentHash, grid,
        segment: { index, firstFrame: index * 2, frameCount: 2 }, width: 7, height: 5, codedWidth: 8, codedHeight: 6,
        video: { size: 5, sha256: 'b'.repeat(64) }, geometry: { size: Buffer.byteLength(geometry), sha256: 'c'.repeat(64) } }))
    }
    const request = { streamId: page.streamId, time: 0, ticket: 'exact', cacheGrid: grid, latest: true }
    expect(await reader.capture(page, request)).toBeUndefined()
    expect(opened).not.toHaveBeenCalled()
    reader.prepare(page); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    for (const time of [0, 2, 1]) {
      expect(await reader.capture(page, { ...request, time, ticket: String(time), precision: 'web-cache', boxes: ['div'] })).toMatchObject({ provenance: 'web-cache', pixelWidth: 7, pixelHeight: 5, boxes: { div: [time === 1 ? 1 : 0, 0, 7, 5] } })
    }
    expect(opened).toHaveBeenCalledTimes(1)
    expect(service.setDecoderSegment).toHaveBeenCalledTimes(2)
    const second = { ...page, streamId: 'second-page', target: { ...page.target, id: 2 } } as WebSourcePage
    reader.prepare(second); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(await reader.capture(second, { ...request, streamId: second.streamId, precision: 'web-cache' })).toMatchObject({ pixelWidth: 7 })
    expect(opened).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls.at(-1)?.[0]).toBe(2)
    expect(capture.mock.calls.at(-1)?.[2]).toMatchObject({ streamId: second.streamId, target: { id: 2 }, ticket: 'exact' })
    expect(touch).toHaveBeenCalledTimes(3)
    const releasedBeforeMissing = releaseSegment.mock.calls.length
    expect(await reader.capture(page, { ...request, precision: 'web-cache', boxes: ['missing'] })).toBeUndefined()
    expect(bridge.closeStream).toHaveBeenCalledTimes(1)
    expect(releaseSegment).toHaveBeenCalledTimes(releasedBeforeMissing + 1)
    opened.mockClear(); vi.mocked(bridge.closeStream).mockClear()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledTimes(4)
    environmentValid = false
    reader.prepare(page); reader.prepare(page)
    expect(registration.environment).toHaveBeenCalledTimes(3)
    expect(environment.close).toHaveBeenCalledTimes(1)
    environmentValid = true
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(await reader.capture(page, { ...request, precision: 'web-cache' })).toMatchObject({ pixelWidth: 7 })
    let release!: () => void
    capture.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve }); return { found: false, ticket: 'cancel' } })
    const pending = reader.capture(page, { ...request, precision: 'web-cache', ticket: 'cancel' })
    await vi.waitFor(() => expect(release).toBeDefined())
    reader.cancel(page.streamId, 'cancel'); release()
    expect(await pending).toMatchObject({ dropped: true })
    expect(discard).not.toHaveBeenCalled()
    reader.close(page.streamId)
    expect(await reader.capture(second, { ...request, streamId: second.streamId, precision: 'web-cache' })).toMatchObject({ pixelWidth: 7 })
    expect(opened).toHaveBeenCalledTimes(1)
    expect(bridge.closeStream).not.toHaveBeenCalled()
    let switched!: () => void
    vi.mocked(service.setDecoderSegment).mockImplementationOnce(async (_stream, _file, options) => {
      expect(options?.signal).toBeUndefined()
      await new Promise<void>(resolve => { switched = resolve })
      return { streamId: _stream }
    })
    const changing = reader.capture(second, { ...request, streamId: second.streamId, time: 2, ticket: 'switch', precision: 'web-cache' })
    await vi.waitFor(() => expect(switched).toBeDefined())
    reader.cancel(second.streamId, 'switch'); switched()
    expect(await changing).toMatchObject({ dropped: true })
    const before = vi.mocked(service.setDecoderSegment).mock.calls.length
    expect(await reader.capture(second, { ...request, streamId: second.streamId, time: 0, precision: 'web-cache' })).toMatchObject({ pixelWidth: 7 })
    expect(service.setDecoderSegment).toHaveBeenCalledTimes(before + 1)
    expect(opened).toHaveBeenCalledTimes(1)
    let failSwitch!: (error: Error) => void
    vi.mocked(service.setDecoderSegment).mockImplementationOnce(async () => new Promise<{ streamId: string }>((_resolve, reject) => { failSwitch = reject }))
    const failed = reader.capture(second, { ...request, streamId: second.streamId, time: 2, ticket: 'failed-switch', precision: 'web-cache' })
    await vi.waitFor(() => expect(failSwitch).toBeDefined())
    reader.cancel(second.streamId, 'failed-switch'); failSwitch(new Error('timeout'))
    expect(await failed).toMatchObject({ dropped: true })
    expect(bridge.closeStream).toHaveBeenCalledTimes(1)
    expect(await reader.capture(second, { ...request, streamId: second.streamId, time: 0, precision: 'web-cache' })).toMatchObject({ pixelWidth: 7 })
    expect(opened).toHaveBeenCalledTimes(2)
  } finally { reader.dispose(); await fs.rm(root, { recursive: true, force: true }) }
})
