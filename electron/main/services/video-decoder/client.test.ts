import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { MainLoggerMeta } from '../logging/main-logger'
import { VideoDecoderService, type VideoDecoderChildProcess, type VideoDecoderServiceOptions } from './client'
import { encodeVideoDecoderFrame, VIDEO_DECODER_PROTOCOL_VERSION, VideoDecoderError, VideoDecoderFrameReader, type VideoDecoderEvent, type VideoDecoderHello } from './protocol'

type Message = { id: string; type: string; [key: string]: unknown }
type Handler = (message: Message, child: FakeChild) => void

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly received: Message[] = []
  exited = false

  constructor(readonly pid: number, handler: Handler) {
    super()
    const reader = new VideoDecoderFrameReader()
    this.stdin.on('data', (chunk: Buffer) => {
      for (const message of reader.push(chunk) as Message[]) {
        this.received.push(message)
        handler(message, this)
      }
    })
  }

  reply(id: string, result: unknown): void {
    this.stdout.write(encodeVideoDecoderFrame({ id, ok: true, result }))
  }

  fail(id: string, code: string, message: string): void {
    this.stdout.write(encodeVideoDecoderFrame({ id, ok: false, error: { code, message } }))
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return
    this.exited = true
    setImmediate(() => this.emit('exit', code, signal))
  }

  kill(): boolean {
    this.exit(null, 'SIGTERM')
    return true
  }
}

const HELLO: VideoDecoderHello = {
  service: 'henji-video-decoder',
  serviceVersion: '0.1.0',
  protocolVersion: VIDEO_DECODER_PROTOCOL_VERSION,
  pid: 0,
  ffmpeg: {
    version: 'n9.0.2-test',
    libavcodec: '63.4.100',
    libavformat: '63.1.100',
    libavutil: '61.2.100',
    license: 'GPL version 3 or later',
    gplEnabled: true,
    nonfreeEnabled: false,
    videoDecoders: ['av1', 'cfhd', 'dnxhd', 'h264', 'hevc', 'libdav1d', 'libvpx-vp9', 'mpeg2video', 'prores', 'vp9'],
    audioDecoders: ['aac'],
    requiredDecoders: ['h264', 'hevc', 'av1', 'libdav1d', 'vp9', 'libvpx-vp9', 'prores', 'dnxhd', 'cfhd', 'mpeg2video'],
    missingRequiredDecoders: [],
    hwDeviceTypes: ['d3d11va'],
  },
  d3d11: {
    available: true,
    adapter: { description: 'Test GPU', vendorId: '0x10de', deviceId: '0x2684', dedicatedVideoMemoryMiB: 24000, sharedSystemMemoryMiB: 0, luid: '0:1', software: false },
    featureLevel: '11.1',
    videoDecoderProfiles: { available: true, count: 3, named: ['h264', 'hevc_main10'] },
    adapters: [],
  },
  gpuReady: true,
}

const PROBE_RESULT = { path: 'D:\\a.mov', container: { formatName: 'mov', formatLongName: null, durationSeconds: 1, startTimeSeconds: 0, bitRate: null }, primaryVideoStreamIndex: 0, primaryAudioStreamIndex: null, streams: [] }

/** 默认原生行为：握手成功、probe 立即成功、shutdown 后退出。 */
function standardHandler(overrides: Partial<Record<string, Handler>> = {}): Handler {
  return (message, child) => {
    const custom = overrides[message.type]
    if (custom) return custom(message, child)
    if (message.type === 'hello') child.reply(message.id, { ...HELLO, pid: child.pid })
    else if (message.type === 'probe') child.reply(message.id, { ...PROBE_RESULT, path: message.path })
    else if (message.type === 'cancel') child.reply(message.id, { targetId: message.targetId, cancelled: true })
    else if (message.type === 'shutdown') {
      child.reply(message.id, { stopping: true })
      child.exit(0)
    }
  }
}

interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  meta?: MainLoggerMeta
}

function createHarness(handlers: Handler[] | Handler, options: Partial<VideoDecoderServiceOptions> = {}) {
  const logs: LogEntry[] = []
  const children: FakeChild[] = []
  const handlerFor = (index: number): Handler => (Array.isArray(handlers) ? handlers[Math.min(index, handlers.length - 1)] : handlers)
  const logger = {
    debug: (message: string, meta?: MainLoggerMeta) => logs.push({ level: 'debug', message, meta }),
    info: (message: string, meta?: MainLoggerMeta) => logs.push({ level: 'info', message, meta }),
    warn: (message: string, meta?: MainLoggerMeta) => logs.push({ level: 'warn', message, meta }),
    error: (message: string, meta?: MainLoggerMeta) => logs.push({ level: 'error', message, meta }),
  }
  const service = new VideoDecoderService({
    resolveExecutable: () => 'C:\\fake\\henji-video-decoder.exe',
    logger,
    spawn: () => {
      const child = new FakeChild(1000 + children.length, handlerFor(children.length))
      children.push(child)
      return child as unknown as VideoDecoderChildProcess
    },
    restart: { maxRestarts: 3, windowMs: 60_000, backoffMs: [5, 5, 5] },
    ...options,
  })
  const events = () => logs.map((entry) => entry.meta?.event)
  return { service, children, logs, events }
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('等待条件超时')
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(() => null, (reason: unknown) => reason)
  expect(error).toBeInstanceOf(VideoDecoderError)
  expect((error as VideoDecoderError).code).toBe(code)
}

describe('VideoDecoderService', () => {
  it('handshakes once, logs FFmpeg/decoder/D3D11 info and forwards native stderr logs', async () => {
    const { service, children, logs } = createHarness(standardHandler())
    const [first, second] = await Promise.all([service.ensureStarted(), service.probe('D:\\a.mov')])
    expect(first.ffmpeg.version).toBe('n9.0.2-test')
    expect(second.path).toBe('D:\\a.mov')
    expect(children).toHaveLength(1)
    expect(service.state).toBe('ready')
    expect(children[0].received.filter((message) => message.type === 'hello')).toHaveLength(1)

    const ready = logs.find((entry) => entry.meta?.event === 'video_decoder.service.ready')
    expect(ready?.level).toBe('info')
    expect(ready?.meta?.context).toMatchObject({
      ffmpegVersion: 'n9.0.2-test',
      requiredDecoders: ['h264', 'hevc', 'av1', 'libdav1d', 'vp9', 'libvpx-vp9', 'prores', 'dnxhd', 'cfhd', 'mpeg2video'],
      missingRequiredDecoders: [],
      d3d11: { adapter: 'Test GPU', featureLevel: '11.1' },
    })

    children[0].stderr.write('{"level":"warn","event":"probe.hdr_as_sdr","message":"HDR 按 SDR","context":{"path":"x"}}\nplain text line\n')
    await waitFor(() => logs.some((entry) => entry.meta?.event === 'video_decoder.native.raw_output'))
    const forwarded = logs.find((entry) => entry.meta?.event === 'video_decoder.native.probe.hdr_as_sdr')
    expect(forwarded).toMatchObject({ level: 'warn', message: 'HDR 按 SDR', meta: { context: { path: 'x', pid: 1000 } } })
  })

  it('matches concurrent responses by id even when they arrive out of order and split across chunks', async () => {
    const held: Message[] = []
    const { service, children } = createHarness(standardHandler({
      probe: (message, child) => {
        held.push(message)
        if (held.length < 3) return
        // 逆序、逐字节回写，验证拆帧与按 ID 匹配。
        const bytes = Buffer.concat(held.reverse().map((item) => encodeVideoDecoderFrame({ id: item.id, ok: true, result: { ...PROBE_RESULT, path: item.path } })))
        for (const byte of bytes) child.stdout.write(Buffer.from([byte]))
      },
    }))
    const results = await Promise.all(['D:\\1.mp4', 'D:\\2.mov', 'D:\\3.mxf'].map((file) => service.probe(file)))
    expect(results.map((result) => result.path)).toEqual(['D:\\1.mp4', 'D:\\2.mov', 'D:\\3.mxf'])
    expect(children).toHaveLength(1)
  })

  it('times out a request, cancels it natively, ignores the late response and stays ready', async () => {
    const late: { reply?: () => void } = {}
    const { service, children, events } = createHarness(standardHandler({
      probe: (message, child) => {
        if (message.path === 'D:\\slow.mov') late.reply = () => child.reply(message.id, PROBE_RESULT)
        else child.reply(message.id, { ...PROBE_RESULT, path: message.path })
      },
    }))
    await expectCode(service.probe('D:\\slow.mov', { timeoutMs: 20 }), 'TIMEOUT')
    const slow = children[0].received.find((message) => message.path === 'D:\\slow.mov')
    await waitFor(() => children[0].received.some((message) => message.type === 'cancel'))
    expect(children[0].received.find((message) => message.type === 'cancel')?.targetId).toBe(slow?.id)
    expect(events()).toContain('video_decoder.request.timeout')
    late.reply?.()
    expect((await service.probe('D:\\fast.mov')).path).toBe('D:\\fast.mov')
    expect(service.state).toBe('ready')
    expect(children).toHaveLength(1)
  })

  it('cancels through AbortSignal and rejects pre-aborted requests without sending them', async () => {
    const { service, children } = createHarness(standardHandler({ probe: () => undefined }))
    await service.ensureStarted()
    const controller = new AbortController()
    const pending = service.probe('D:\\a.mov', { signal: controller.signal })
    await waitFor(() => children[0].received.some((message) => message.type === 'probe'))
    controller.abort()
    await expectCode(pending, 'CANCELLED')
    await waitFor(() => children[0].received.some((message) => message.type === 'cancel'))

    const aborted = new AbortController()
    aborted.abort()
    await expectCode(service.probe('D:\\b.mov', { signal: aborted.signal }), 'CANCELLED')
    expect(children[0].received.filter((message) => message.type === 'probe')).toHaveLength(1)
  })

  it('detects a crash, fails in-flight requests and restarts per policy', async () => {
    const { service, children, events } = createHarness([
      standardHandler({ probe: (_message, child) => child.exit(3221225477) }),
      standardHandler(),
    ])
    await expectCode(service.probe('D:\\crash.mov'), 'PROCESS_EXITED')
    expect(events()).toContain('video_decoder.service.exited')
    expect(events()).toContain('video_decoder.service.restart_scheduled')
    await waitFor(() => service.state === 'ready')
    expect(children).toHaveLength(2)
    expect((await service.probe('D:\\ok.mov')).path).toBe('D:\\ok.mov')
  })

  it('stops restarting after the limit and recovers after the window passes', async () => {
    let now = 1_000
    const crashOnHello: Handler = (_message, child) => child.exit(1)
    const { service, children, events } = createHarness([crashOnHello, crashOnHello, crashOnHello, standardHandler()], {
      restart: { maxRestarts: 2, windowMs: 10_000, backoffMs: [1, 1] },
      now: () => now,
    })
    await expectCode(service.ensureStarted(), 'PROCESS_EXITED')
    await waitFor(() => service.state === 'failed')
    expect(children).toHaveLength(3)
    expect(events()).toContain('video_decoder.service.restart_exhausted')
    await expectCode(service.probe('D:\\a.mov'), 'UNAVAILABLE')
    expect(children).toHaveLength(3)

    now += 10_001
    expect((await service.probe('D:\\a.mov')).path).toBe('D:\\a.mov')
    expect(children).toHaveLength(4)
  })

  it('reports start failure when the executable cannot be spawned, then restarts', async () => {
    let attempts = 0
    const service = new VideoDecoderService({
      resolveExecutable: () => 'C:\\missing.exe',
      logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
      restart: { backoffMs: [1] },
      spawn: () => {
        attempts += 1
        if (attempts > 1) return new FakeChild(attempts, standardHandler()) as unknown as VideoDecoderChildProcess
        // 与 Node 行为一致：可执行文件无法启动时异步触发 error，且不会触发 exit。
        const child = new FakeChild(attempts, () => undefined)
        setImmediate(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })))
        return child as unknown as VideoDecoderChildProcess
      },
    })
    await expectCode(service.ensureStarted(), 'START_FAILED')
    await waitFor(() => service.state === 'ready')
    expect(attempts).toBe(2)
  })

  it('reports unavailable without spawning when the executable is not installed', async () => {
    let spawned = 0
    const service = new VideoDecoderService({
      resolveExecutable: () => null,
      logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
      spawn: () => {
        spawned += 1
        throw new Error('should not spawn')
      },
    })
    await expectCode(service.probe('D:\\a.mov'), 'UNAVAILABLE')
    expect(service.state).toBe('unavailable')
    expect(spawned).toBe(0)
  })

  it('rejects a protocol-incompatible handshake and kills the process', async () => {
    const { service, children, events } = createHarness([
      standardHandler({ hello: (message, child) => child.reply(message.id, { ...HELLO, protocolVersion: 99 }) }),
      standardHandler(),
    ])
    await expectCode(service.ensureStarted(), 'HANDSHAKE_FAILED')
    expect(events()).toContain('video_decoder.service.handshake_failed')
    await waitFor(() => children[0].exited)
    await waitFor(() => service.state === 'ready')
  })

  it('kills and restarts on a malformed frame', async () => {
    const { service, children, events } = createHarness([
      standardHandler({ probe: (_message, child) => child.stdout.write(Buffer.from([0xff, 0xff, 0xff, 0xff])) }),
      standardHandler(),
    ])
    await expectCode(service.probe('D:\\a.mov'), 'PROCESS_EXITED')
    expect(events()).toContain('video_decoder.protocol.error')
    await waitFor(() => service.state === 'ready')
    expect(children).toHaveLength(2)
  })

  it('shuts down gracefully without restarting and rejects later requests', async () => {
    const { service, children, events } = createHarness(standardHandler())
    await service.ensureStarted()
    await service.shutdown()
    expect(children[0].received.some((message) => message.type === 'shutdown')).toBe(true)
    expect(service.state).toBe('stopped')
    expect(events()).toContain('video_decoder.service.stopped')
    expect(events()).not.toContain('video_decoder.service.restart_scheduled')
    await expectCode(service.probe('D:\\a.mov'), 'STOPPED')
    expect(children).toHaveLength(1)
  })

  it('force-kills on shutdown when the process ignores the request', async () => {
    const { service, children } = createHarness(standardHandler({ shutdown: () => undefined }), { shutdownTimeoutMs: 10 })
    await service.ensureStarted()
    await service.shutdown()
    expect(children[0].exited).toBe(true)
  })

  it('maps native error codes', async () => {
    const { service } = createHarness(standardHandler({ probe: (message, child) => child.fail(message.id, 'OPEN_FAILED', '无法打开文件') }))
    await expectCode(service.probe('D:\\missing.mov'), 'OPEN_FAILED')
  })

  it('registers the client pid, dispatches native events and sends notifications without awaiting replies', async () => {
    const { service, children } = createHarness(standardHandler({
      start_test_stream: (message, child) => {
        child.reply(message.id, { streamId: message.streamId, slots: [{ slot: 0, handle: '1234' }] })
        child.stdout.write(encodeVideoDecoderFrame({ event: 'frame', streamId: message.streamId, slot: 0, frameIndex: 0, timestampUs: 0 }))
      },
      stats: (message, child) => child.reply(message.id, { streams: [] }),
    }), { clientPid: 4242 })
    const received: VideoDecoderEvent[] = []
    const unsubscribe = service.onEvent((event) => received.push(event))
    expect(service.notify({ type: 'release_frame', streamId: 's', slot: 0 })).toBe(false)
    await service.startTestStream({ streamId: 's', format: 'nv12', width: 3840, height: 2160, fps: 60 })
    expect(children[0].received.find((message) => message.type === 'hello')?.clientPid).toBe(4242)
    await waitFor(() => received.length === 1)
    expect(received[0]).toMatchObject({ event: 'frame', streamId: 's', slot: 0 })
    expect(service.notify({ type: 'release_frame', streamId: 's', slot: 0 })).toBe(true)
    await waitFor(() => children[0].received.some((message) => message.type === 'release_frame'))
    unsubscribe()
    children[0].stdout.write(encodeVideoDecoderFrame({ event: 'stream_ended', streamId: 's', reason: 'completed', message: null, counters: {} }))
    await service.stats()
    expect(received).toHaveLength(1)
  })

  it('sends decoder session commands and dispatches schedule events in arrival order', async () => {
    const { service, children } = createHarness(standardHandler({
      open_decoder: (message, child) => child.reply(message.id, { streamId: message.streamId, format: 'nv12', slots: [{ slot: 0, handle: '1234' }], decoder: { decoderName: 'h264' } }),
      frame_at: (message, child) => {
        // 命中时帧事件先于响应写出。
        child.stdout.write(encodeVideoDecoderFrame({ event: 'frame', streamId: message.streamId, slot: 0, frameIndex: 0, timestampUs: 2_000_000, ptsUs: 2_000_000, durationUs: 16666, request: { kind: 'frame_at', id: message.ticket } }))
        child.reply(message.id, { ticket: message.ticket, found: true, ptsUs: 2_000_000, seeked: true, decodeMs: 4 })
      },
      schedule: (message, child) => {
        child.reply(message.id, { scheduleId: message.scheduleId, count: (message.times as number[]).length })
        child.stdout.write(encodeVideoDecoderFrame({ event: 'frame_missing', streamId: message.streamId, scheduleId: message.scheduleId, index: 0, reason: 'no_picture' }))
        child.stdout.write(encodeVideoDecoderFrame({ event: 'schedule_done', streamId: message.streamId, scheduleId: message.scheduleId, reason: 'completed', message: null, counters: { delivered: 0 } }))
      },
      cancel_schedule: (message, child) => child.reply(message.id, { cancelled: true }),
    }))
    const received: VideoDecoderEvent[] = []
    service.onEvent((event) => received.push(event))
    await service.openDecoder({ streamId: 'd', path: 'D:\\a.mov', purpose: 'seek', hardware: 'off' })
    expect(children[0].received.find((message) => message.type === 'open_decoder')).toMatchObject({ streamId: 'd', path: 'D:\\a.mov', purpose: 'seek', hardware: 'off' })
    await expect(service.frameAt('d', 2, 't1')).resolves.toMatchObject({ ticket: 't1', found: true })
    expect(received[0]).toMatchObject({ event: 'frame', request: { kind: 'frame_at', id: 't1' }, ptsUs: 2_000_000 })
    await expect(service.schedule({ streamId: 'd', scheduleId: 's1', times: [-1] })).resolves.toEqual({ scheduleId: 's1', count: 1 })
    await waitFor(() => received.length === 3)
    expect(received.slice(1).map((event) => event.event)).toEqual(['frame_missing', 'schedule_done'])
    await expect(service.cancelSchedule('d', 's1')).resolves.toEqual({ cancelled: true })
  })

  it('emits lifecycle events so stream owners can drop handles of a crashed process', async () => {
    const { service, children } = createHarness(standardHandler())
    const lifecycle: string[] = []
    service.onLifecycle((event) => lifecycle.push(`${event.type}:${event.pid}`))
    await service.ensureStarted()
    children[0].exit(1)
    await waitFor(() => lifecycle.length === 3)
    expect(lifecycle).toEqual(['ready:1000', 'exited:1000', 'ready:1001'])
  })
})

describe('声音会话与二进制附件', () => {
  function attachment(id: string, result: unknown, bytes: Buffer): Buffer {
    const header = Buffer.alloc(4); header.writeUInt32LE(bytes.length, 0)
    return Buffer.concat([encodeVideoDecoderFrame({ id, ok: true, result, attachment: bytes.length }), header, bytes])
  }

  it('带 attachment 的消息挂上紧随其后的原始字节，分块到达也能拼回；不带的消息不受影响', () => {
    const pcm = Buffer.from(new Float32Array([0.5, -0.25, 1, 0]).buffer)
    const stream = Buffer.concat([encodeVideoDecoderFrame({ event: 'stream_ended', streamId: 'vf-1' }), attachment('vd-9', { frames: 2 }, pcm), encodeVideoDecoderFrame({ id: 'vd-10', ok: true, result: 1 })])
    const reader = new VideoDecoderFrameReader()
    const messages: unknown[] = []
    for (let offset = 0; offset < stream.length; offset += 5) messages.push(...reader.push(stream.subarray(offset, offset + 5)))
    expect(messages).toHaveLength(3)
    const read = messages[1] as { binary: Buffer; result: unknown }
    expect(read.result).toEqual({ frames: 2 })
    expect([...new Float32Array(read.binary.buffer, read.binary.byteOffset, 4)]).toEqual([0.5, -0.25, 1, 0])
    expect(messages[2]).toEqual({ id: 'vd-10', ok: true, result: 1 })
  })

  it('附件长度与声明不符、或声明无效时是协议错误', () => {
    const header = Buffer.alloc(4); header.writeUInt32LE(3, 0)
    expect(() => new VideoDecoderFrameReader().push(Buffer.concat([encodeVideoDecoderFrame({ id: 'a', ok: true, attachment: 4 }), header, Buffer.alloc(3)]))).toThrow('附件长度不符')
    expect(() => new VideoDecoderFrameReader().push(encodeVideoDecoderFrame({ id: 'a', ok: true, attachment: -1 }))).toThrow('附件长度无效')
  })

  it('openAudio/readAudio/closeAudio 发送对应命令，读取结果带上附件数据；缺少附件时报协议错误', async () => {
    const pcm = Buffer.from(new Float32Array([0.25, 0.75]).buffer)
    const { service, children } = createHarness(standardHandler({
      open_audio: (message, child) => child.reply(message.id, { found: true, audioId: message.audioId, audioStream: 0, streamIndex: 1, codec: 'pcm_s24le', decoderName: 'pcm_s24le', sampleRate: 48000, sourceSampleRate: 48000, channels: 1, channelLayout: 'mono', resampler: 'none', startSeconds: 0, endSeconds: 3, setupMs: 1 }),
      read_audio: (message, child) => {
        if (message.frames === 1) child.reply(message.id, { audioId: message.audioId, startFrame: message.startFrame, frames: 1, channels: 1, seeked: false, decodeMs: 0 })
        else child.stdout.write(attachment(message.id, { audioId: message.audioId, startFrame: message.startFrame, frames: 2, channels: 1, seeked: true, decodeMs: 1 }, pcm))
      },
      close_audio: (message, child) => child.reply(message.id, { closed: true }),
    }))
    const opened = await service.openAudio({ audioId: 'va-1', path: 'D:/a.mxf', sampleRate: 48000 })
    expect(opened).toMatchObject({ found: true, sampleRate: 48000, channels: 1 })
    const read = await service.readAudio('va-1', -1, 2)
    expect(read).toMatchObject({ startFrame: -1, frames: 2, seeked: true })
    expect([...new Float32Array(read.data.buffer, read.data.byteOffset, 2)]).toEqual([0.25, 0.75])
    await expectCode(service.readAudio('va-1', 0, 1), 'PROTOCOL_ERROR')
    expect(await service.closeAudio('va-1')).toEqual({ closed: true })
    expect(children[0].received.filter((message) => message.type.endsWith('_audio')).map((message) => message.type)).toEqual(['open_audio', 'read_audio', 'read_audio', 'close_audio'])
    expect(children[0].received.find((message) => message.type === 'open_audio')).toMatchObject({ audioId: 'va-1', path: 'D:/a.mxf', sampleRate: 48000 })
    await service.shutdown()
  })
})
