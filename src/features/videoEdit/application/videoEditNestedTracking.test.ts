import { createVideoEditTestDocument as createVideoEditDocument } from '../../../core/videoEdit/testFixtures'
import { EventEmitter } from 'node:events'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { createVideoEditSequence, type VideoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditSequenceTrackingSource } from '@/core/videoEdit/trackingSource'
import type { TrackingDefinition, TrackingFrameEvent, TrackingStatus } from '@/platform/contracts/tracking'
import { VideoEditTrackingFrames } from './videoEditTrackingFrames'
import { TrackingFrameBroker } from '../../../../electron/main/services/tracking/frameBroker'
import { RenderedTrackingFrames } from '../../../../electron/main/services/local-inference/tracking/renderedFrames'
import { LocalInferenceHost, type LocalInferenceChild } from '../../../../electron/main/services/local-inference/host'
import type { LocalInferenceEvent, LocalInferenceRequest } from '../../../../electron/main/services/local-inference/protocol'
import { runTracking } from '../../../../electron/main/services/local-inference/tracking/trackJob'
import { TrackingService } from '../../../../electron/main/services/tracking/service'
import type { ContentDiskCache } from '../../../../electron/main/services/media/content-disk-cache'

const pixels = vi.hoisted(() => ({ frames: [] as number[], dispose: vi.fn(), pause: undefined as (() => Promise<void>) | undefined }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor(readonly composition: VideoEditComposition) {}
  async setRenderDivisor() {}
  async present(frame: number, _sequential: boolean, _scrub: boolean, _deadline: unknown, _submitted: unknown, size: { width: number; height: number }) {
    await pixels.pause?.()
    pixels.frames.push(frame); return { rgb: new Uint8Array(size.width * size.height * 3).fill(frame) }
  }
  async dispose() { pixels.dispose() }
} }))
afterEach(() => { pixels.frames.length = 0; pixels.dispose.mockClear(); pixels.pause = undefined; vi.useRealTimers() })

function fixture() {
  const document = createVideoEditDocument('跟踪'); const child = createVideoEditSequence('子序列')
  child.width = 64; child.height = 36; child.frameRate = { numerator: 60, denominator: 1 }
  document.sequences.push(child)
  document.items.push({ id: 'nested', kind: 'sequence', name: '嵌套', sequenceId: child.id })
  const clip = { ...makeVideoEditItemClip(document, 'nested', document.sequences[0].id, { frame: 0 }), duration: 5, speed: { numerator: 2, denominator: 1 } }
  document.sequences[0].clips.push(clip)
  return { document, child, clip }
}

it('嵌套层从离屏帧经有界桥到真实跟踪循环/.htrk，单步后续跟、纠错与子内容失效', async () => {
  const { document, clip, child: sequence } = fixture()
  const broker = new TrackingFrameBroker(); const files = new Map<string, Uint8Array>(); const events: TrackingStatus[] = []
  let composition!: VideoEditComposition
  const sender = { id: 1, send: (event: TrackingFrameEvent) => renderer.handle(event), onClosed: () => () => {} }
  const renderer = new VideoEditTrackingFrames(() => composition, async reply => { broker.reply(1, reply) }, () => {})
  class Child extends EventEmitter implements LocalInferenceChild {
    readonly controllers = new Map<string, AbortController>()
    readonly source = new RenderedTrackingFrames((id, requestId, request) => this.emit('message', { type: 'frames', id, requestId, request } satisfies LocalInferenceEvent))
    kill(): boolean { return true }
    postMessage(message: LocalInferenceRequest): void {
      if (message.type === 'frames') { this.source.reply(message.id, message.reply); return }
      if (message.type === 'cancel') { this.controllers.get(message.id)?.abort(); return }
      if (message.type !== 'track') throw new Error('只允许跟踪任务')
      const controller = new AbortController(); this.controllers.set(message.job.id, controller)
      void runTracking(message.job, {
        openModel: async () => ({ provider: 'cpu', run: async () => {
          const conf = new Float32Array(256); conf[136] = 1
          return { output1: { data: conf, dims: [1, 1, 16, 16] }, output2: { data: new Float32Array(512).fill(.25), dims: [1, 2, 16, 16] }, output3: { data: new Float32Array(512), dims: [1, 2, 16, 16] } }
        } }),
        frames: request => this.source.frames(message.job.id, request, controller.signal),
        readFile: async path => files.get(path), writeFile: async (path, bytes) => { files.set(path, bytes) },
        deflate: bytes => deflateRawSync(bytes), inflate: bytes => inflateRawSync(bytes), signal: controller.signal, log: () => {}, progress: () => {},
      }).then(result => this.emit('message', { type: 'done', id: message.job.id, result } satisfies LocalInferenceEvent), error => this.emit('message', { type: 'failed', id: message.job.id, code: 'inference', message: String(error) } satisfies LocalInferenceEvent)).finally(() => this.controllers.delete(message.job.id))
    }
  }
  const child = new Child(); const host = new LocalInferenceHost({ fork: () => child, log: () => {} })
  const identity = vi.fn(async () => { throw new Error('合成源不应读文件身份') }); const probe = vi.fn(async () => { throw new Error('合成源不应调用ffprobe') })
  const service = new TrackingService({ identity, probe, ffmpegPath: async () => '', ensureModel: async () => [{ name: 'vittrack', path: 'model-double' }], providers: ['cpu'],
    results: { locate: async (key: string) => files.has(key) ? key : undefined, prepareTemporary: async (key: string) => `${key}.tmp`, adopt: async (key: string, temp: string) => { files.set(key, files.get(temp)!); files.delete(temp); return key } } as unknown as ContentDiskCache,
    readHead: async (path, bytes) => files.get(path)!.subarray(0, bytes), track: (job, progress, frames) => host.track(job, progress, frames), candidates: async () => { throw new Error('此用例不取候选') }, cancel: id => host.cancel(id), emit: event => { events.push(event.status) }, log: () => {},
  })
  const define = (): TrackingDefinition => { const resolved = videoEditSequenceTrackingSource(document, clip)!; composition = resolved.composition; return { source: resolved.source, method: 'box', prompts: [{ timeUs: 0, box: [.2, .2, .25, .25] }] } }
  const run = async (definition: TrackingDefinition, limit?: number): Promise<TrackingStatus> => {
    if (typeof definition.source === 'string') throw new Error('必须是合成源')
    const previous = events.length
    await service.run(definition, { startUs: 0, endUs: 333334 }, { direction: 'forward', ...(limit ? { limit } : {}) }, broker.provider(definition.source, sender))
    await vi.waitFor(() => expect(events.slice(previous).some(status => status.state === 'ready' || status.state === 'failed')).toBe(true))
    expect(events.at(-1)?.state).toBe('ready'); return events.at(-1)!
  }
  try {
    const definition = define(); const partial = await run(definition, 1)
    expect(partial.result?.endUs).toBe(66667)
    const resumed = await run(definition)
    expect(resumed.result?.endUs).toBe(366667)
    expect(pixels.frames).toContain(20); expect(identity).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled()
    const before = pixels.frames.length; expect((await service.status(definition)).state).toBe('ready'); expect(pixels.frames).toHaveLength(before)
    const correction: TrackingDefinition = { ...definition, prompts: [...definition.prompts, { timeUs: 100000, box: [.3, .2, .25, .25] }] }
    expect((await service.status(correction)).state).toBe('idle'); await run(correction)
    expect(pixels.frames).toContain(6)
    sequence.width = 66; const updated = define()
    expect(updated.source).not.toEqual(definition.source); expect((await service.status(updated)).state).toBe('idle')
    await run(updated); expect(pixels.dispose).toHaveBeenCalledTimes(4)
  } finally { service.dispose(); host.dispose(); renderer.dispose() }
})

it('主进程帧桥拒绝跨窗口、超额、错误尺寸；取消/关闭/超时释放且迟到帧不复活', async () => {
  vi.useFakeTimers()
  const { document, clip } = fixture(); const source = videoEditSequenceTrackingSource(document, clip)!.source
  const broker = new TrackingFrameBroker(100); const sent: TrackingFrameEvent[] = []
  let closed = (): void => {}
  const sender = { id: 7, send: (event: TrackingFrameEvent) => { sent.push(event) }, onClosed: (listener: () => void) => { closed = listener; return () => {} } }
  const provider = broker.provider(source, sender); const request = { first: 0, count: 1, width: 2, height: 2 }
  const controller = new AbortController()
  const read = provider('a', request, controller.signal)
  const event = sent[0]; if (event.kind !== 'frames') throw new Error('未发出帧请求')
  expect(() => broker.reply(8, { id: event.id, frames: [new Uint8Array(12)] })).toThrow('发起窗口')
  broker.reply(7, { id: event.id, frames: [new Uint8Array(12)] }); await expect(read).resolves.toHaveLength(1)
  controller.abort(); expect(sent.at(-1)).toEqual({ kind: 'release', jobId: 'a' })
  broker.reply(7, { id: event.id, frames: [new Uint8Array(1)] })
  await expect(provider('oversize', { first: 0, count: 8, width: 1280, height: 1280 }, new AbortController().signal)).rejects.toThrow('批次')
  const wrong = provider('wrong', request, new AbortController().signal); const rejected = expect(wrong).rejects.toThrow('尺寸')
  const wrongEvent = sent.at(-1)!; if (wrongEvent.kind !== 'frames') throw new Error('未发出帧请求')
  broker.reply(7, { id: wrongEvent.id, frames: [new Uint8Array(1)] }); await rejected
  closed()
  const cancelling = new AbortController(); const cancelled = provider('cancel', request, cancelling.signal)
  const cancelledCheck = expect(cancelled).rejects.toThrow('结束'); cancelling.abort(); await cancelledCheck
  const exiting = provider('exit', request, new AbortController().signal); const exitingCheck = expect(exiting).rejects.toThrow('结束')
  closed(); await exitingCheck
  const timing = provider('timeout', request, new AbortController().signal); const timingCheck = expect(timing).rejects.toThrow('结束')
  await vi.advanceTimersByTimeAsync(100); await timingCheck
  expect(sent.filter(event => event.kind === 'release')).toHaveLength(5)
})

it('utility 分批限制传输字节，停止后不请求后续批次，错误/迟到帧不会被消费', async () => {
  const requested: number[] = []; const controller = new AbortController()
  const client: RenderedTrackingFrames = new RenderedTrackingFrames((id, requestId, request) => {
    requested.push(request.count)
    client.reply(id, { id: requestId, frames: Array.from({ length: request.count }, () => new Uint8Array(request.width * request.height * 3)) })
  })
  let consumed = 0
  for await (const _frame of client.frames('job', { first: 0, count: 32, width: 1280, height: 1280 }, controller.signal)) { consumed++ }
  expect(requested).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2]); expect(consumed).toBe(32)
  const waiting = new RenderedTrackingFrames(() => {})
  const pending = waiting.frames('cancel', { first: 0, count: 1, width: 1, height: 1 }, controller.signal).next()
  const assertion = expect(pending).rejects.toThrow('取消'); controller.abort(); await assertion
})

it('离屏渲染等待期间释放会话，迟到像素不回复后台且解码会话销毁', async () => {
  const { document, clip } = fixture(); const { source, composition } = videoEditSequenceTrackingSource(document, clip)!
  let finish!: () => void
  pixels.pause = () => new Promise<void>(resolve => { finish = resolve })
  const reply = vi.fn(async () => {})
  const renderer = new VideoEditTrackingFrames(() => composition, reply, () => {})
  renderer.handle({ kind: 'frames', id: 'read', jobId: 'job', source, request: { first: 0, count: 1, width: 64, height: 36 } })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  for (const id of ['overlap', 'still-busy']) {
    renderer.handle({ kind: 'frames', id, jobId: 'job', source, request: { first: 1, count: 1, width: 64, height: 36 } })
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith(expect.objectContaining({ id, error: expect.stringContaining('重叠') })))
  }
  reply.mockClear()
  renderer.handle({ kind: 'release', jobId: 'job' }); finish()
  for (let i = 0; i < 10; i++) await Promise.resolve()
  expect(reply).not.toHaveBeenCalled(); expect(pixels.dispose).toHaveBeenCalledOnce()
})

it('推理宿主拒绝重叠请求后仍保留原请求占用，取消时不转发迟到帧', async () => {
  class Child extends EventEmitter implements LocalInferenceChild {
    readonly sent: LocalInferenceRequest[] = []
    postMessage(message: LocalInferenceRequest) { this.sent.push(message) }
    kill() { return true }
  }
  const child = new Child(); const host = new LocalInferenceHost({ fork: () => child, log: () => {} })
  let finish!: (frames: Uint8Array[]) => void
  const provider = vi.fn(() => new Promise<Uint8Array[]>(resolve => { finish = resolve }))
  const pair = fixture(); const descriptor = videoEditSequenceTrackingSource(pair.document, pair.clip)!.source
  const pending = host.candidates({ id: 'job', source: descriptor, models: [], ffmpegPath: '', containerStartUs: 0, fps: 30, frame: 0, points: [], providers: ['cpu'] }, provider)
  const request = { first: 0, count: 1, width: 1, height: 1 }
  for (const requestId of ['first', 'second', 'third']) child.emit('message', { type: 'frames', id: 'job', requestId, request } satisfies LocalInferenceEvent)
  await vi.waitFor(() => expect(child.sent.filter(message => message.type === 'frames')).toHaveLength(2))
  expect(provider).toHaveBeenCalledOnce()
  host.cancel('job'); child.emit('message', { type: 'done', id: 'job', result: { provider: 'cpu', size: 1, candidates: [] } } satisfies LocalInferenceEvent)
  await pending; finish([new Uint8Array(3)])
  for (let i = 0; i < 5; i++) await Promise.resolve()
  expect(child.sent.filter(message => message.type === 'frames')).toHaveLength(2)
  host.dispose()
})
