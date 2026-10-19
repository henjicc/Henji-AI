import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { buildVideoEditSpeechSubtitles } from './videoEditSpeechSubtitleWorkerClient'
import { buildSpeechSubtitles } from '@/core/videoEdit/speechSubtitles'
import { SpeechSubtitleTestWorker as TestWorker } from '@/tests/speechSubtitleWorkerTestKit'
import type { SpeechSubtitleWorkerResponse } from '../engine/videoEditSpeechSubtitleWorker'
import { Worker as NodeWorker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const original = '请打开后台设置并保存。'.repeat(80)
const timings = { granularity: 'word' as const, items: Array.from(original).map((text, index) => ({ text, startMs: index * 100, endMs: index * 100 + 100 })) }
const clip = { id: 'voice', start: 90, duration: 3000, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }
const rate = { numerator: 30, denominator: 1 }

beforeEach(() => { TestWorker.instances = []; TestWorker.autoRun = false; vi.stubGlobal('Worker', TestWorker) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('long requests preserve real word sources, trim, reverse and rate mapping through the thread envelope', async () => {
  TestWorker.autoRun = true
  const mapped = { ...clip, duration: 400, sourceInUs: 30000000, reverse: true, speed: { numerator: 2, denominator: 1 } }
  const options = { maxCharacters: 10, minDurationSeconds: 0 }
  const actual = await buildVideoEditSpeechSubtitles(original, timings, mapped, rate, options, undefined, [], 'clip')
  const expected = await buildSpeechSubtitles(original, timings, mapped, rate, options, undefined, [], 'clip')
  const comparable = (value: typeof actual) => value.map(({ caption: { id: _id, ...caption }, ...cue }) => ({ caption, ...cue }))
  expect(comparable(actual)).toEqual(comparable(expected))
  expect(actual.length).toBeGreaterThan(0)
  expect(actual.some(cue => cue.caption.speech?.words.length)).toBe(true)
  expect(TestWorker.instances).toHaveLength(1)
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce()
  expect(TestWorker.instances[0].onmessage).toBeNull()
})

it('small cues stay inline, but a one-sided long input still runs off-thread', async () => {
  expect(await buildVideoEditSpeechSubtitles('请', { ...timings, items: timings.items.slice(0, 1) }, clip, rate)).toHaveLength(1)
  expect(TestWorker.instances).toHaveLength(0)
  TestWorker.autoRun = true
  await buildVideoEditSpeechSubtitles('请', { ...timings, items: [{ text: '请'.repeat(10000), startMs: 0, endMs: 1000 }] }, clip, rate)
  expect(TestWorker.instances).toHaveLength(1)
})

it('aborting an active request terminates its computation, removes listeners and ignores late results', async () => {
  const controller = new AbortController()
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  const pending = buildVideoEditSpeechSubtitles(original, timings, clip, rate, {}, controller.signal)
  const worker = TestWorker.instances[0], late = worker.onmessage!
  const reason = new Error('用户取消')
  controller.abort(reason)
  late(new MessageEvent<SpeechSubtitleWorkerResponse>('message', { data: { result: [] } }))
  await expect(pending).rejects.toBe(reason)
  expect(worker.terminate).toHaveBeenCalledOnce()
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  expect(worker.onmessage).toBeNull()
})

it('an already cancelled request creates no worker', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(buildVideoEditSpeechSubtitles(original, timings, clip, rate, {}, controller.signal)).rejects.toThrow()
  expect(TestWorker.instances).toHaveLength(0)
})

it.each(['worker', 'message', 'post', 'domain'] as const)('%s failures reject and release the worker so a retry can succeed', async mode => {
  if (mode === 'post') vi.spyOn(TestWorker.prototype, 'postMessage').mockImplementationOnce(() => { throw new Error('传递失败') })
  const pending = buildVideoEditSpeechSubtitles(original, timings, clip, rate)
  const worker = TestWorker.instances[0]
  if (mode === 'worker') worker.onerror?.({ message: '线程失败' })
  if (mode === 'message') worker.onmessageerror?.()
  if (mode === 'domain') worker.onmessage?.({ data: { error: '时间戳无效' } } as MessageEvent<SpeechSubtitleWorkerResponse>)
  await expect(pending).rejects.toThrow()
  expect(worker.terminate).toHaveBeenCalledOnce()
  TestWorker.autoRun = true
  expect((await buildVideoEditSpeechSubtitles(original, timings, clip, rate)).length).toBeGreaterThan(0)
})

it('concurrent requests are isolated when one is cancelled', async () => {
  const controller = new AbortController()
  const cancelled = buildVideoEditSpeechSubtitles(original, timings, clip, rate, {}, controller.signal)
  const completed = buildVideoEditSpeechSubtitles(original, timings, { ...clip, id: 'other' }, rate)
  controller.abort()
  await expect(cancelled).rejects.toThrow()
  await TestWorker.instances[1].respond()
  expect((await completed).every(cue => cue.caption.clipId === 'other')).toBe(true)
  expect(TestWorker.instances.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true)
})

it('the actual worker entry runs the kernel and reports validation errors through the same envelope', async () => {
  const posted: SpeechSubtitleWorkerResponse[] = []
  const scope = { postMessage: (value: SpeechSubtitleWorkerResponse) => { posted.push(value) }, onmessage: undefined as unknown as (event: MessageEvent) => Promise<void> }
  vi.stubGlobal('self', scope)
  await import('../engine/videoEditSpeechSubtitleWorker')
  await scope.onmessage({ data: { original, timings, clip, rate, options: {}, pauses: [], textScope: 'source' } } as MessageEvent)
  expect(posted[0]).toMatchObject({ result: expect.arrayContaining([expect.objectContaining({ caption: expect.objectContaining({ clipId: 'voice' }) })]) })
  await scope.onmessage({ data: { original, timings: { ...timings, items: [] }, clip, rate } } as MessageEvent)
  expect(posted[1]).toEqual({ error: '没有可用于对齐的时间戳。' })
})

it('a real background thread completes the browser bundle and is stopped during expensive alignment without blocking the caller', async () => {
  // Node supplies only the transport shim. Compile the real browser Worker, including
  // its ESM dependency, instead of substituting the alignment or subtitle algorithm.
  class ThreadWorker {
    static instances: ThreadWorker[] = []
    onmessage: ((event: MessageEvent<SpeechSubtitleWorkerResponse>) => void) | null = null
    onerror: ((event: { message: string }) => void) | null = null
    onmessageerror: (() => void) | null = null
    started: Promise<void>
    stopped?: Promise<number>
    thread: NodeWorker
    constructor(url: URL) {
      const bundle = buildSync({ entryPoints: [fileURLToPath(url)], bundle: true, write: false, platform: 'browser', format: 'cjs', logLevel: 'silent' }).outputFiles[0].text
      this.thread = new NodeWorker(`const { parentPort } = require('node:worker_threads');
        globalThis.self = { postMessage: value => parentPort.postMessage(value) };
        ${bundle}
        parentPort.on('message', data => { parentPort.postMessage({ started: true }); void self.onmessage({ data }); });`, { eval: true })
      let markStarted!: () => void
      this.started = new Promise(resolve => { markStarted = resolve })
      this.thread.on('message', (data: SpeechSubtitleWorkerResponse | { started: true }) => {
        if ('started' in data) markStarted()
        else this.onmessage?.(new MessageEvent<SpeechSubtitleWorkerResponse>('message', { data }))
      })
      this.thread.on('error', error => this.onerror?.({ message: error.message }))
      this.thread.on('messageerror', () => this.onmessageerror?.())
      ThreadWorker.instances.push(this)
    }
    postMessage(value: unknown): void { this.thread.postMessage(value) }
    terminate(): void { this.stopped = this.thread.terminate() }
  }
  vi.stubGlobal('Worker', ThreadWorker)
  try {
    const result = await buildVideoEditSpeechSubtitles(original, timings, clip, rate)
    expect(result.length).toBeGreaterThan(0)
    expect(result.every(cue => cue.caption.clipId === 'voice')).toBe(true)
    await ThreadWorker.instances[0].stopped
    const controller = new AbortController()
    const hardText = '甲'.repeat(12000) + '乙'.repeat(12000)
    const hardRecognition = '乙'.repeat(12000) + '甲'.repeat(12000)
    const pending = buildVideoEditSpeechSubtitles(hardText, { granularity: 'char', items: Array.from(hardRecognition, (text, i) => ({ text, startMs: i * 100, endMs: i * 100 + 100 })) }, clip, rate, {}, controller.signal)
    const rejected = expect(pending).rejects.toThrow('取消实际计算')
    await ThreadWorker.instances[1].started
    // Let the caller process an event while the other thread performs the hard LCS.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    controller.abort(new Error('取消实际计算'))
    await rejected
    expect(ThreadWorker.instances[1].stopped).toBeDefined()
    await ThreadWorker.instances[1].stopped
  } finally {
    await Promise.all(ThreadWorker.instances.map(worker => worker.thread.terminate()))
  }
}, 15000)
