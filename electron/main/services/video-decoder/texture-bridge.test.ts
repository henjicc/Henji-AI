import { describe, expect, it, vi } from 'vitest'
import type { ImportSharedTextureOptions, SendSharedTextureOptions, SharedTextureImported, WebFrameMain } from 'electron'
import type { MainLoggerMeta } from '../logging/main-logger'
import type { VideoDecoderLifecycleEvent } from './client'
import type { VideoDecoderEvent, VideoDecoderStreamStarted, VideoDecoderTestStreamRequest } from './protocol'
import {
  encodeNtHandle,
  parseVideoFrameTestStreamRequest,
  VIDEO_FRAMES_STREAM_ENDED_CHANNEL,
  VideoFrameBridge,
  type SharedTextureApi,
  type VideoFrameBridgeService,
  type VideoFrameTarget,
} from './texture-bridge'

function started(request: VideoDecoderTestStreamRequest, slots = 3): VideoDecoderStreamStarted {
  return {
    streamId: request.streamId,
    format: request.format,
    codedSize: { width: request.width, height: request.height },
    visibleRect: { x: 0, y: 0, width: request.width, height: request.height },
    colorSpace: { primaries: 'bt709', transfer: 'srgb', matrix: 'bt709', range: 'limited' },
    fps: request.fps,
    keyedMutex: true,
    slots: Array.from({ length: slots }, (_, slot) => ({ slot, handle: String(1000 + slot * 4) })),
    pattern: { width: request.width },
    setupMs: 3,
  }
}

function createService() {
  let eventListener: ((event: VideoDecoderEvent) => void) | null = null
  let lifecycleListener: ((event: VideoDecoderLifecycleEvent) => void) | null = null
  const notifications: Array<{ streamId: string; slot: number }> = []
  const stopped: string[] = []
  const closedHandles: string[][] = []
  let beforeStartResolves: ((streamId: string) => void) | null = null
  const service: VideoFrameBridgeService = {
    state: 'ready',
    startTestStream: vi.fn(async (request: VideoDecoderTestStreamRequest) => {
      beforeStartResolves?.(request.streamId)
      return started(request)
    }),
    stopStream: vi.fn(async (streamId: string) => {
      stopped.push(streamId)
      return { streamId, stopped: true, final: null }
    }),
    notify: vi.fn((notification) => {
      notifications.push({ streamId: notification.streamId, slot: notification.slot })
      return true
    }),
    onEvent: (listener) => {
      eventListener = listener
      return () => { eventListener = null }
    },
    onLifecycle: (listener) => {
      lifecycleListener = listener
      return () => { lifecycleListener = null }
    },
    closeClientHandles: vi.fn(async (handles: string[]) => {
      closedHandles.push(handles)
      return { closed: handles.length, failed: [] }
    }),
    stats: vi.fn(async () => ({ pid: 1, cpuMs: 0, handleCount: 0, gpuLocalMemory: null, streams: [] })),
  }
  return {
    service,
    notifications,
    stopped,
    closedHandles,
    emit: (event: VideoDecoderEvent) => eventListener?.(event),
    lifecycle: (event: VideoDecoderLifecycleEvent) => lifecycleListener?.(event),
    frame: (streamId: string, slot: number, frameIndex = slot) => eventListener?.({ event: 'frame', streamId, slot, frameIndex, timestampUs: frameIndex * 16667 }),
    beforeStartResolves: (callback: (streamId: string) => void) => { beforeStartResolves = callback },
  }
}

interface FakeImport {
  options: ImportSharedTextureOptions
  released: boolean
  allReleased: () => void
}

function createSharedTexture(send: (options: SendSharedTextureOptions, meta: unknown) => Promise<void> = async () => undefined) {
  const imports: FakeImport[] = []
  const sends: Array<{ options: SendSharedTextureOptions; meta: unknown }> = []
  const api: SharedTextureApi = {
    importSharedTexture: (options) => {
      const entry: FakeImport = { options, released: false, allReleased: () => options.allReferencesReleased?.() }
      imports.push(entry)
      return { textureId: String(imports.length), release: () => { entry.released = true } } as unknown as SharedTextureImported
    },
    sendSharedTexture: (options, ...args) => {
      sends.push({ options, meta: args[0] })
      return send(options, args[0])
    },
  }
  return { api, imports, sends }
}

function createTarget(id = 7) {
  let destroyed = false
  let goneListener: ((reason: string) => void) | null = null
  const sent: Array<{ channel: string; payload: unknown }> = []
  const mainFrame = { frameTreeNodeId: 1 } as unknown as WebFrameMain
  const target: VideoFrameTarget = {
    id,
    isDestroyed: () => destroyed,
    mainFrame,
    send: (channel, payload) => sent.push({ channel, payload }),
    onGone: (listener) => {
      goneListener = listener
      return () => { goneListener = null }
    },
  }
  return { target, sent, mainFrame, destroy: () => { destroyed = true }, gone: (reason: string) => goneListener?.(reason), hasGoneListener: () => goneListener !== null }
}

function createLogger() {
  const entries: Array<{ level: string; event?: string; context?: Record<string, unknown> }> = []
  const log = (level: string) => (_message: string, meta?: MainLoggerMeta): void => {
    entries.push({ level, event: meta?.event, context: meta?.context as Record<string, unknown> | undefined })
  }
  return { logger: { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') }, entries }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const request = { route: 'vf-route-1', format: 'nv12' as const, width: 3840, height: 2160, fps: 60 }

describe('VideoFrameBridge', () => {
  it('imports each frame by its slot handle, sends it to the requesting frame and recycles the slot after all references are released', async () => {
    const native = createService()
    const shared = createSharedTexture()
    const { target, mainFrame } = createTarget()
    const bridge = new VideoFrameBridge({ service: native.service, sharedTexture: shared.api, logger: createLogger().logger, overdueCheckIntervalMs: 0 })
    const info = await bridge.openTestStream(target, request)
    expect(info).toMatchObject({ streamId: 'vf-1', route: 'vf-route-1', format: 'nv12', poolSize: 3, codedSize: { width: 3840, height: 2160 } })

    native.frame('vf-1', 2, 5)
    expect(shared.imports).toHaveLength(1)
    const textureInfo = shared.imports[0].options.textureInfo
    expect(textureInfo).toMatchObject({ pixelFormat: 'nv12', codedSize: { width: 3840, height: 2160 }, timestamp: 5 * 16667 })
    expect(textureInfo.handle.ntHandle?.readBigUInt64LE(0)).toBe(1008n)
    expect(shared.sends[0].options.frame).toBe(mainFrame)
    expect(shared.sends[0].meta).toEqual({ route: 'vf-route-1', streamId: 'vf-1', frameIndex: 5, timestampUs: 5 * 16667 })
    await flush()
    expect(shared.imports[0].released).toBe(true)
    expect(native.notifications).toEqual([])

    shared.imports[0].allReleased()
    expect(native.notifications).toEqual([{ streamId: 'vf-1', slot: 2 }])
    const stats = await bridge.stats()
    expect(stats.streams[0]).toMatchObject({ delivered: 1, released: 1, outstanding: 0, sendFailures: 0 })
    expect(stats.unreleasedImports).toBe(0)
  })

  it('keeps frames that arrive before the start response is processed and imports them once the stream is registered', async () => {
    const native = createService()
    const shared = createSharedTexture()
    native.beforeStartResolves((streamId) => native.frame(streamId, 0, 0))
    const bridge = new VideoFrameBridge({ service: native.service, sharedTexture: shared.api, logger: createLogger().logger, overdueCheckIntervalMs: 0 })
    await bridge.openTestStream(createTarget().target, request)
    expect(shared.imports).toHaveLength(1)
    expect(native.notifications).toEqual([])
  })

  it('still releases the main reference and later the slot when sending times out', async () => {
    const native = createService()
    const shared = createSharedTexture(async () => { throw new Error('transfer shared texture timed out after 1000ms') })
    const { logger, entries } = createLogger()
    const bridge = new VideoFrameBridge({ service: native.service, sharedTexture: shared.api, logger, overdueCheckIntervalMs: 0 })
    await bridge.openTestStream(createTarget().target, request)
    native.frame('vf-1', 1)
    await flush()
    expect(shared.imports[0].released).toBe(true)
    expect(entries.some((entry) => entry.event === 'video_frames.frame.send_failed')).toBe(true)
    shared.imports[0].allReleased()
    expect(native.notifications).toEqual([{ streamId: 'vf-1', slot: 1 }])
    expect((await bridge.stats()).streams[0]).toMatchObject({ sendFailures: 1, delivered: 0 })
  })

  it('returns the slot without importing when the import itself fails', async () => {
    const native = createService()
    const shared = createSharedTexture()
    shared.api.importSharedTexture = () => { throw new Error('Unable to duplicate handle.') }
    const bridge = new VideoFrameBridge({ service: native.service, sharedTexture: shared.api, logger: createLogger().logger, overdueCheckIntervalMs: 0 })
    await bridge.openTestStream(createTarget().target, request)
    native.frame('vf-1', 0)
    expect(native.notifications).toEqual([{ streamId: 'vf-1', slot: 0 }])
    expect((await bridge.stats()).streams[0].importFailures).toBe(1)
  })

  it('stops importing a closing stream, stops it natively and does not hand slots back for the closed pool', async () => {
    const native = createService()
    const shared = createSharedTexture()
    const bridge = new VideoFrameBridge({ service: native.service, sharedTexture: shared.api, logger: createLogger().logger, overdueCheckIntervalMs: 0 })
    const { target, hasGoneListener } = createTarget()
    await bridge.openTestStream(target, request)
    native.frame('vf-1', 0)
    expect(await bridge.closeStream('vf-1', 'requested', 99)).toBe(false)
    expect(await bridge.closeStream('vf-1', 'requested', target.id)).toBe(true)
    expect(native.stopped).toEqual(['vf-1'])
    expect(hasGoneListener()).toBe(false)
    native.frame('vf-1', 1)
    expect(shared.imports).toHaveLength(1)
    expect(native.notifications).toEqual([{ streamId: 'vf-1', slot: 1 }])
    shared.imports[0].allReleased()
    expect(native.notifications).toHaveLength(1)
    expect((await bridge.stats()).unreleasedImports).toBe(0)
  })

  it('closes all streams of a page that navigated, crashed or was destroyed', async () => {
    const native = createService()
    const shared = createSharedTexture()
    const bridge = new VideoFrameBridge({ service: native.service, sharedTexture: shared.api, logger: createLogger().logger, overdueCheckIntervalMs: 0 })
    const page = createTarget(1)
    const other = createTarget(2)
    await bridge.openTestStream(page.target, request)
    await bridge.openTestStream(page.target, { ...request, format: 'rgbaf16' })
    await bridge.openTestStream(other.target, request)
    page.gone('navigated')
    await flush()
    expect(native.stopped.sort()).toEqual(['vf-1', 'vf-2'])
    expect((await bridge.stats()).streams.map((stream) => stream.streamId)).toEqual(['vf-3'])

    other.destroy()
    native.frame('vf-3', 0)
    await flush()
    expect(shared.imports).toHaveLength(0)
    expect(native.stopped).toContain('vf-3')
    await expect(bridge.openTestStream(other.target, request)).rejects.toThrow('目标窗口已关闭')
  })

  it('logs frames whose references are held past the overdue limit', async () => {
    let now = 0
    const native = createService()
    const shared = createSharedTexture()
    const { logger, entries } = createLogger()
    const bridge = new VideoFrameBridge({ service: native.service, sharedTexture: shared.api, logger, now: () => now, releaseOverdueMs: 3000, overdueCheckIntervalMs: 0 })
    await bridge.openTestStream(createTarget().target, request)
    native.frame('vf-1', 0, 42)
    now = 2999
    bridge.checkOverdue()
    expect(entries.filter((entry) => entry.event === 'video_frames.release.overdue')).toHaveLength(0)
    now = 3500
    bridge.checkOverdue()
    bridge.checkOverdue()
    const overdue = entries.filter((entry) => entry.event === 'video_frames.release.overdue')
    expect(overdue).toHaveLength(1)
    expect(overdue[0].context).toMatchObject({ streamId: 'vf-1', slot: 0, frameIndex: 42 })
    expect((await bridge.stats()).streams[0].overdueReleases).toBe(1)
  })

  it('auto-stops streams the native side finished and tells the page', async () => {
    const native = createService()
    const bridge = new VideoFrameBridge({ service: native.service, sharedTexture: createSharedTexture().api, logger: createLogger().logger, overdueCheckIntervalMs: 0 })
    const page = createTarget()
    await bridge.openTestStream(page.target, request)
    native.emit({ event: 'stream_ended', streamId: 'vf-1', reason: 'completed', message: null, counters: { produced: 3, skipped: 0, released: 3, duplicateReleases: 0, outstanding: 0, renderUsAverage: 1 } })
    await flush()
    expect(page.sent).toEqual([{ channel: VIDEO_FRAMES_STREAM_ENDED_CHANNEL, payload: { streamId: 'vf-1', route: 'vf-route-1', reason: 'completed', message: null } }])
    expect(native.stopped).toEqual(['vf-1'])
  })

  it('hands handles of a crashed service process to the next process for closing', async () => {
    const native = createService()
    const bridge = new VideoFrameBridge({ service: native.service, sharedTexture: createSharedTexture().api, logger: createLogger().logger, overdueCheckIntervalMs: 0 })
    const page = createTarget()
    await bridge.openTestStream(page.target, request)
    native.lifecycle({ type: 'exited', pid: 10 })
    expect(page.sent[0].payload).toMatchObject({ streamId: 'vf-1', reason: 'service_exited' })
    let stats = await bridge.stats()
    expect(stats.streams).toHaveLength(0)
    expect(stats.orphanHandles).toBe(3)
    native.frame('vf-1', 0)
    native.lifecycle({ type: 'ready', pid: 11 })
    await flush()
    expect(native.closedHandles).toEqual([['1000', '1004', '1008']])
    stats = await bridge.stats()
    expect(stats.orphanHandles).toBe(0)
  })

  it('refuses formats the channel cannot carry unless explicitly allowed for diagnostics', async () => {
    const native = createService()
    const bridge = new VideoFrameBridge({ service: native.service, sharedTexture: createSharedTexture().api, logger: createLogger().logger, overdueCheckIntervalMs: 0 })
    await expect(bridge.openTestStream(createTarget().target, { ...request, format: 'p010le' })).rejects.toThrow('p010le')
    await expect(bridge.openTestStream(createTarget().target, { ...request, format: 'nv16' })).rejects.toThrow('nv16')
    expect(native.service.startTestStream).not.toHaveBeenCalled()
    const diagnostics = new VideoFrameBridge({ service: native.service, sharedTexture: createSharedTexture().api, logger: createLogger().logger, overdueCheckIntervalMs: 0, allowUnsupportedFormats: true })
    await diagnostics.openTestStream(createTarget().target, { ...request, format: 'p010le' })
    expect(native.service.startTestStream).toHaveBeenCalledTimes(1)
  })
})

describe('texture bridge helpers', () => {
  it('encodes NT handles as 8-byte little endian and rejects malformed values', () => {
    expect([...encodeNtHandle('4660')]).toEqual([0x34, 0x12, 0, 0, 0, 0, 0, 0])
    expect(() => encodeNtHandle('0x10')).toThrow()
    expect(() => encodeNtHandle('-1')).toThrow()
  })

  it('validates open requests from the renderer', () => {
    expect(parseVideoFrameTestStreamRequest({ ...request, poolSize: 8 })).toEqual({ ...request, poolSize: 8, maxFrames: undefined, keyedMutex: undefined })
    for (const invalid of [null, { ...request, route: 'bad route' }, { ...request, format: 'yuv444' }, { ...request, width: 3840.5 }, { ...request, fps: 0 }, { ...request, poolSize: 1 }, { ...request, keyedMutex: 'yes' }]) {
      expect(() => parseVideoFrameTestStreamRequest(invalid)).toThrow()
    }
  })
})
