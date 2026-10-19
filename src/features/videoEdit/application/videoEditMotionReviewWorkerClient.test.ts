import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { analyzeVideoEditMotionStructure } from './videoEditMotionReviewWorkerClient'
import { collectVideoEditMotionStructure } from '@/core/videoEdit/motionStructure'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditMotionReviewRequest, VideoEditMotionReviewResponse, VideoEditMotionReviewMessage } from '../engine/videoEditMotionReviewWorker'
import * as glyphs from '../videoEditGlyphMetrics'
import { layoutCodeText } from '@/core/videoEdit/codeMaterial/textLayout'
import type { CodeTextMeasureRequest } from '@/core/videoEdit/codeMaterial/contract'
import { Worker as NodeWorker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
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
const textRequest: CodeTextMeasureRequest = { text: '测量', fontFamily: 'sans-serif', fontStyle: 'normal', fontWeight: 400, fontSize: 20, letterSpacing: 0, lineHeight: 1.2, maxWidth: 0, wrap: false, maxLines: 0 }
it('routes text measurement through the production host and keeps the worker alive until its final result', async () => {
  const layout = layoutCodeText(textRequest, () => 73)
  vi.spyOn(glyphs, 'measureCodeText').mockReturnValue(layout)
  const pending = analyzeVideoEditMotionStructure(request, new AbortController().signal), worker = TestWorker.instances[0]
  const post = vi.spyOn(worker, 'postMessage')
  worker.onmessage?.(new MessageEvent('message', { data: { measureText: { id: 7, request: textRequest } } }))
  expect(glyphs.measureCodeText).toHaveBeenCalledWith(textRequest)
  expect(post).toHaveBeenCalledWith({ measurement: { id: 7, layout } })
  expect(worker.terminate).not.toHaveBeenCalled()
  worker.respond(); await pending
  expect(worker.terminate).toHaveBeenCalledOnce()
})
it('rejects font changes before a late result or a measurement reply and releases the worker', async () => {
  const pending = analyzeVideoEditMotionStructure(request, new AbortController().signal)
  glyphs.invalidateCodeTextMetrics(); TestWorker.instances[0].respond()
  await expect(pending).rejects.toThrow('字体已改变')
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce()
})
it('fails closed on unavailable text metrics and ignores text requests received after cancellation', async () => {
  vi.spyOn(glyphs, 'measureCodeText').mockImplementation(() => { throw new Error('正式字体不可用') })
  const pending = analyzeVideoEditMotionStructure(request, new AbortController().signal)
  TestWorker.instances[0].onmessage?.(new MessageEvent('message', { data: { measureText: { id: 0, request: textRequest } } }))
  await expect(pending).rejects.toThrow('正式字体不可用')
  const controller = new AbortController(), cancelled = analyzeVideoEditMotionStructure(request, controller.signal), worker = TestWorker.instances[1], late = worker.onmessage!
  const post = vi.spyOn(worker, 'postMessage'); controller.abort()
  late(new MessageEvent('message', { data: { measureText: { id: 1, request: textRequest } } }))
  await expect(cancelled).rejects.toThrow()
  expect(post).not.toHaveBeenCalled()
  expect(glyphs.measureCodeText).toHaveBeenCalledTimes(1)
})
it('the browser bundle evaluates real code in a background thread, round-trips host text metrics and cancels running work', async () => {
  let measurements = 0
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
        else { if ('measureText' in data) measurements++; this.onmessage?.(new MessageEvent('message', { data })) }
      })
      this.thread.on('error', error => this.onerror?.({ message: error.message }))
      this.thread.on('messageerror', () => this.onmessageerror?.())
      ThreadWorker.instances.push(this)
    }
    postMessage(value: unknown): void { this.thread.postMessage(value) }
    terminate(): void { this.stopped = this.thread.terminate() }
  }
  vi.stubGlobal('Worker', ThreadWorker)
  vi.spyOn(glyphs, 'measureCodeText').mockImplementation(value => layoutCodeText(value, text => text.length * 20))
  const document = createVideoEditDocument('线程复核'), sequence = createVideoEditSequence('主'); addLegacyVideoEditTracks(sequence); document.sequences = [sequence]
  const clip: VideoEditClip = { id: 'code', itemId: 'code-item', name: '代码', kind: 'code', track: 1, start: 0, duration: 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', code: { definitionId: 'd', versionId: 'v', parameters: {} } }
  sequence.clips = [clip]
  const compile = (body: string) => compileCodeMaterial(`export default {apiVersion:1,languageVersion:3,name:"线程",kind:"generator",mode:"dynamic",width:1000,height:1000,durationSeconds:2000,seed:0,parameters:{},render(ctx){${body}}}`)
  try {
    const program = compile('return [text({id:"moving",x:ctx.time*100,y:10,text:"真实线程",fontSize:20})];')
    const composition = videoEditComposition(document, sequence.id)
    const scan: VideoMotionScan = { startSeconds: 0, endSeconds: 2, samplingFps: 15, width: 320, height: 180, sampledFrames: 30,
      samples: Array.from({ length: 30 }, (_, i) => ({ fromSeconds: i / 15, toSeconds: (i + 1) / 15, speed: 6, zoom: 0, change: 0, cut: false, still: false })) }
    const pixels = new VideoEditSourceMapIndex().query(composition, { from: 0, to: 60 }, ['video']).map(entry => ({ entry, scan }))
    const result = await analyzeVideoEditMotionStructure({ composition, range: { from: 0, to: 60 }, programs: { v: program }, pixels, policy: {} }, new AbortController().signal)
    expect(result.records).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'motion', basis: 'code_structure', peakSpeed: expect.closeTo(10, 4) })]))
    expect(result.records).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'motion', basis: 'video_pixels', peakSpeed: expect.closeTo(6, 4) })]))
    expect(measurements).toBe(1); expect(result.sampledCodeFrames).toBe(60)
    await ThreadWorker.instances[0].stopped
    clip.duration = 60000
    const heavy = compile('return repeat(4096,i=>rect({id:"particle",x:ctx.time+i/10,y:10,width:100,height:100}));')
    const controller = new AbortController()
    const pending = analyzeVideoEditMotionStructure({ composition: videoEditComposition(document, sequence.id), range: { from: 0, to: 60000 }, programs: { v: heavy }, policy: {} }, controller.signal)
    const rejected = expect(pending).rejects.toThrow('取消实际代码分析')
    await ThreadWorker.instances[1].started
    controller.abort(new Error('取消实际代码分析')); await rejected
    expect(ThreadWorker.instances[1].stopped).toBeDefined(); await ThreadWorker.instances[1].stopped
  } finally { await Promise.all(ThreadWorker.instances.map(worker => worker.thread.terminate())) }
}, 15000)
