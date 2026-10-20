import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { analyzeVideoEditMotionStructure } from './videoEditMotionReviewWorkerClient'
import { collectVideoEditMotionStructure } from '@/core/videoEdit/motionStructure'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditMotionReviewRequest, VideoEditMotionReviewResponse, VideoEditMotionReviewMessage } from '../engine/videoEditMotionReviewWorker'
import type { CodeAuthorProgram, CodeAuthorFrameObservation } from '@/core/videoEdit/codeAuthorProgram'
import * as glyphs from '../videoEditGlyphMetrics'
import { Worker as NodeWorker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { VideoEditSourceMapIndex } from '@/core/videoEdit/sourceMap'
import type { VideoMotionScan } from '@/core/media/motionEvidence'

class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((event: MessageEvent<VideoEditMotionReviewResponse>) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  request?: VideoEditMotionReviewRequest
  constructor() { TestWorker.instances.push(this) }
  postMessage(value: VideoEditMotionReviewMessage): void { if ('composition' in value) this.request = value }
  respond(): void { this.onmessage?.({ data: { result: collectVideoEditMotionStructure(this.request!.composition, this.request!.range) } } as MessageEvent<VideoEditMotionReviewResponse>) }
}
beforeEach(() => { TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const document = createVideoEditDocument('空白')
document.sequences = [createVideoEditSequence('主')]
const request = { composition: videoEditComposition(document, document.sequences[0].id), range: { from: 0, to: 30 }, policy: {} }
it('one worker owns a query and releases its listeners and resources after real kernel completion', async () => {
  const signal = new AbortController().signal, remove = vi.spyOn(signal, 'removeEventListener')
  const pending = analyzeVideoEditMotionStructure(request, signal)
  TestWorker.instances[0].respond()
  expect(await pending).toEqual({ records: [], sampledFrames: 0, sampledInstances: 0 })
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce()
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  expect(TestWorker.instances[0].onmessage).toBeNull()
})
it('cancels before creation or during work, ignores a late reply and does not affect another query', async () => {
  const cancelled = new AbortController(); cancelled.abort()
  await expect(analyzeVideoEditMotionStructure(request, cancelled.signal)).rejects.toThrow()
  expect(TestWorker.instances).toHaveLength(0)
  const controller = new AbortController()
  const first = analyzeVideoEditMotionStructure(request, controller.signal)
  const second = analyzeVideoEditMotionStructure(request, new AbortController().signal)
  const late = TestWorker.instances[0].onmessage!
  controller.abort(new Error('取消结构分析'))
  late(new MessageEvent<VideoEditMotionReviewResponse>('message', { data: { result: { records: [], sampledFrames: 0, sampledInstances: 0 } } }))
  await expect(first).rejects.toThrow('取消结构分析')
  TestWorker.instances[1].respond(); expect(await second).toHaveProperty('sampledFrames', 0)
  expect(TestWorker.instances.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true)
})
it.each(['error', 'message', 'post', 'domain'] as const)('%s failure releases the worker and rejects the query', async kind => {
  if (kind === 'post') vi.spyOn(TestWorker.prototype, 'postMessage').mockImplementationOnce(() => { throw new Error('发送失败') })
  const pending = analyzeVideoEditMotionStructure(request, new AbortController().signal)
  const worker = TestWorker.instances[0]
  if (kind === 'error') worker.onerror?.({ message: '线程失败' })
  if (kind === 'message') worker.onmessageerror?.()
  if (kind === 'domain') worker.onmessage?.(new MessageEvent<VideoEditMotionReviewResponse>('message', { data: { error: '范围超出预算' } }))
  await expect(pending).rejects.toThrow()
  expect(worker.terminate).toHaveBeenCalledOnce()
})
it('the real worker entry uses the same domain kernel and returns domain failures through the envelope', async () => {
  const posted: VideoEditMotionReviewResponse[] = []
  const scope = { postMessage: (value: VideoEditMotionReviewResponse) => posted.push(value), onmessage: undefined as unknown as (event: MessageEvent<VideoEditMotionReviewRequest>) => void }
  vi.stubGlobal('self', scope)
  await import('../engine/videoEditMotionReviewWorker')
  scope.onmessage(new MessageEvent('message', { data: request }))
  expect(posted[0]).toHaveProperty('result.sampledInstances', 0)
})
const observation = (composition = request.composition, frame = 0): CodeAuthorFrameObservation => ({ sequenceId: composition.id, revision: composition.revision, frame, clips: [] })
it('round-trips actual render observations and keeps the analysis worker alive until completion', async () => {
  const observe = vi.fn(async () => observation())
  const pending = analyzeVideoEditMotionStructure(request, new AbortController().signal, observe), worker = TestWorker.instances[0]
  const post = vi.spyOn(worker, 'postMessage')
  await worker.onmessage?.(new MessageEvent('message', { data: { observeFrame: { id: 7, composition: request.composition, frame: 0 } } }))
  expect(observe).toHaveBeenCalledWith(request.composition, 0)
  expect(post).toHaveBeenCalledWith({ observation: { id: 7, value: observation() } })
  expect(worker.terminate).not.toHaveBeenCalled()
  worker.respond(); await pending
  expect(worker.terminate).toHaveBeenCalledOnce()
})
it('rejects font changes before a late result and releases the worker', async () => {
  const pending = analyzeVideoEditMotionStructure(request, new AbortController().signal)
  glyphs.invalidateCodeTextMetrics(); TestWorker.instances[0].respond()
  await expect(pending).rejects.toThrow('字体已改变')
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce()
})
it.each(['failure', 'stale', 'missing'] as const)('rejects %s render evidence without fabricating geometry', async kind => {
  const observe = kind === 'missing' ? undefined : vi.fn(async () => {
    if (kind === 'failure') throw new Error('作者执行失败')
    return { ...observation(), revision: request.composition.revision + 1 }
  })
  const pending = analyzeVideoEditMotionStructure(request, new AbortController().signal, observe)
  const rejected = expect(pending).rejects.toThrow(kind === 'failure' ? '作者执行失败' : kind === 'stale' ? '画面已改变' : '正式渲染观察入口')
  await TestWorker.instances[0].onmessage?.(new MessageEvent('message', { data: { observeFrame: { id: 0, composition: request.composition, frame: 0 } } }))
  await rejected
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce()
})
it('ignores an in-flight observation after cancellation', async () => {
  let resolve!: (value: CodeAuthorFrameObservation) => void
  const observe = vi.fn(() => new Promise<CodeAuthorFrameObservation>(done => { resolve = done }))
  const controller = new AbortController()
  const pending = analyzeVideoEditMotionStructure(request, controller.signal, observe)
  const rejected = expect(pending).rejects.toThrow('取消观察')
  const worker = TestWorker.instances[0], post = vi.spyOn(worker, 'postMessage')
  const reading = worker.onmessage?.(new MessageEvent('message', { data: { observeFrame: { id: 1, composition: request.composition, frame: 0 } } }))
  controller.abort(new Error('取消观察')); resolve(observation()); await reading; await rejected
  expect(post).not.toHaveBeenCalled()
  expect(worker.terminate).toHaveBeenCalledOnce()
})
it('the browser bundle analyzes observed layers in a background thread and cancels running work', async () => {
  let observations = 0
  class ThreadWorker {
    static instances: ThreadWorker[] = []
    onmessage: ((event: MessageEvent<VideoEditMotionReviewResponse>) => void) | null = null
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
        parentPort.on('message', data => { if ('composition' in data) parentPort.postMessage({ started: true }); void self.onmessage({ data }); });`, { eval: true })
      let started!: () => void
      this.started = new Promise(resolve => { started = resolve })
      this.thread.on('message', (data: VideoEditMotionReviewResponse | { started: true }) => {
        if ('started' in data) started()
        else { if ('observeFrame' in data) observations++; this.onmessage?.(new MessageEvent('message', { data })) }
      })
      this.thread.on('error', error => this.onerror?.({ message: error.message }))
      this.thread.on('messageerror', () => this.onmessageerror?.())
      ThreadWorker.instances.push(this)
    }
    postMessage(value: unknown): void { this.thread.postMessage(value) }
    terminate(): void { this.stopped = this.thread.terminate() }
  }
  vi.stubGlobal('Worker', ThreadWorker)
  const document = createVideoEditDocument('线程复核'), sequence = createVideoEditSequence('主'); addLegacyVideoEditTracks(sequence); document.sequences = [sequence]
  const clip: VideoEditClip = { id: 'code', itemId: 'code-item', name: '代码', kind: 'code', track: 1, start: 0, duration: 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', code: { definitionId: 'd', versionId: 'v', parameters: {} } }
  sequence.clips = [clip]
  const program: CodeAuthorProgram = { apiVersion: 4, languageVersion: 4, name: '线程', kind: 'generator', mode: 'dynamic', seed: 0, parameters: [], types: {}, frames: [], hexColors: [], bundle: { code: '', map: '', locations: { layers: {} } } }
  const observe = async (composition: typeof request.composition, frame: number): Promise<CodeAuthorFrameObservation> => ({ ...observation(composition, frame), clips: [{ clipId: 'code', versionId: 'v', width: 1000, height: 1000, elements: [{ id: 'moving', name: '文字', bounds: [0, 0, 100, 100], matrix: [1, 0, 0, 1, frame * 100 / 30, 0], corners: [[frame * 100 / 30, 0], [frame * 100 / 30 + 100, 0], [frame * 100 / 30 + 100, 100], [frame * 100 / 30, 100]], parameterKeys: [], textParameterKeys: [] }] }] })
  try {
    const composition = videoEditComposition(document, sequence.id)
    const scan: VideoMotionScan = { startSeconds: 0, endSeconds: 2, samplingFps: 15, width: 320, height: 180, sampledFrames: 30,
      samples: Array.from({ length: 30 }, (_, i) => ({ fromSeconds: i / 15, toSeconds: (i + 1) / 15, speed: 6, zoom: 0, change: 0, cut: false, still: false })) }
    const pixels = new VideoEditSourceMapIndex().query(composition, { from: 0, to: 60 }, ['video']).map(entry => ({ entry, scan }))
    const result = await analyzeVideoEditMotionStructure({ composition, range: { from: 0, to: 60 }, programs: { v: program }, pixels, policy: {} }, new AbortController().signal, observe)
    expect(result.records).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'motion', basis: 'code_structure', peakSpeed: expect.closeTo(10, 4) })]))
    expect(result.records).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'motion', basis: 'video_pixels', peakSpeed: expect.closeTo(6, 4) })]))
    expect(observations).toBe(60); expect(result.sampledCodeFrames).toBe(60)
    await ThreadWorker.instances[0].stopped
    document.media = [{ id: 'input-media', kind: 'video', name: '输入', path: fileURLToPath(new URL('./input.mp4', import.meta.url)), width: 320, height: 180, durationSeconds: 2 }]
    document.items = [{ id: 'input-item', name: '输入', kind: 'video', mediaId: 'input-media' }]
    clip.code!.parameters = { picture: { kind: 'video', mediaId: 'input-media' } }
    const planned = await analyzeVideoEditMotionStructure({ composition: videoEditComposition(document, sequence.id), range: { from: 0, to: 60 }, policy: {}, planInputsOnly: true }, new AbortController().signal)
    expect(planned.inputPlacements).toHaveLength(1)
    expect(planned.inputPlacements![0].sourceTimes![29]).toBeCloseTo(29 / 30)
    expect(planned.inputPlacements![0].input).toEqual({ parameter: 'picture', kind: 'video', mediaId: 'input-media' })
    await ThreadWorker.instances[1].stopped
    clip.code!.parameters = {}
    clip.duration = 60000
    const controller = new AbortController()
    const pending = analyzeVideoEditMotionStructure({ composition: videoEditComposition(document, sequence.id), range: { from: 0, to: 60000 }, programs: { v: program }, policy: {} }, controller.signal, observe)
    const rejected = expect(pending).rejects.toThrow('取消实际代码分析')
    await ThreadWorker.instances[2].started
    controller.abort(new Error('取消实际代码分析')); await rejected
    expect(ThreadWorker.instances[2].stopped).toBeDefined(); await ThreadWorker.instances[2].stopped
  } finally { await Promise.all(ThreadWorker.instances.map(worker => worker.thread.terminate())) }
}, 15000)
