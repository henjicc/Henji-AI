import { AudioContentAnalyzer } from '@/core/audioAnalysis/contentAnalysis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { analyzeVideoEditBeatsOffThread } from './videoEditBeatWorkerClient'
import { BeatAnalyzer } from '@/core/audioAnalysis/beatAnalysis'
import type { BeatWorkerRequest, BeatWorkerResponse } from '@/core/audioAnalysis/beatWorker'
class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((event: MessageEvent<BeatWorkerResponse>) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  requests: BeatWorkerRequest[] = []
  transfers: Transferable[][] = []
  analyzer?: BeatAnalyzer | AudioContentAnalyzer
  constructor() { TestWorker.instances.push(this) }
  postMessage(request: BeatWorkerRequest, transfers: Transferable[]) {
    this.requests.push(request); this.transfers.push(transfers)
    queueMicrotask(() => {
      if (request.kind === 'begin') this.analyzer = request.fps === undefined ? new BeatAnalyzer(request.sampleRate) : new AudioContentAnalyzer(request.sampleRate, request.fps)
      if (request.kind === 'block') this.analyzer!.append(request.planes)
      const response: BeatWorkerResponse = request.kind === 'finish' ? this.analyzer instanceof AudioContentAnalyzer ? { kind: 'content', result: this.analyzer.finish() } : { kind: 'result', result: this.analyzer!.finish() } : { kind: 'received' }
      this.onmessage?.({ data: response } as MessageEvent<BeatWorkerResponse>)
    })
  }
}
beforeEach(() => { TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker) })
afterEach(() => { vi.unstubAllGlobals() })
it('分块等待确认、PCM 转移并结束 Worker', async () => {
  const planes = [new Float32Array(1000)], blocks = async function* () { yield planes; yield [new Float32Array(2000)] }
  expect(await analyzeVideoEditBeatsOffThread(48000, blocks(), new AbortController().signal)).toEqual({ beats: [], onsets: [], tempo: null })
  const worker = TestWorker.instances[0]
  expect(worker.requests.map(request => request.kind)).toEqual(['begin', 'block', 'block', 'finish']); expect(worker.transfers[1]).toEqual([planes[0].buffer]); expect(worker.terminate).toHaveBeenCalledOnce()
})
it('取消等待时终止计算且不再请求 PCM', async () => {
  const controller = new AbortController(), blocks = async function* () { controller.abort(); yield [new Float32Array(2)] }
  await expect(analyzeVideoEditBeatsOffThread(48000, blocks(), controller.signal)).rejects.toThrow(); expect(TestWorker.instances[0].terminate).toHaveBeenCalled()
  expect(TestWorker.instances[0].requests.map(request => request.kind)).toEqual(['begin'])
})
it('混音等待期间 Worker 出错，下次发送也明确失败，不挂起任务', async () => {
  const blocks = async function* () { TestWorker.instances[0].onerror?.({ message: 'worker failed' }); yield [new Float32Array(2)] }
  await expect(analyzeVideoEditBeatsOffThread(48000, blocks(), new AbortController().signal)).rejects.toThrow('worker failed'); expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce()
})

it('PCM 读取挂起时 Worker 错误立即结束任务', async () => {
  const blocks: AsyncIterable<Float32Array[]> = { [Symbol.asyncIterator]: () => ({ next: () => { queueMicrotask(() => TestWorker.instances[0].onerror?.({ message: 'worker crashed' })); return new Promise(() => {}) } }) }
  await expect(analyzeVideoEditBeatsOffThread(48000, blocks, new AbortController().signal, 30)).rejects.toThrow('worker crashed')
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce()
})

it('内容分析模式返回帧数据，取消挂起的解码立即终止 Worker', async () => {
  const blocks = async function* () { yield [new Float32Array(48000)] }
  expect(await analyzeVideoEditBeatsOffThread(48000, blocks(), new AbortController().signal, 30)).toMatchObject({ bpm: 0, beats: [], levels: Array(30).fill(0) })
  const controller = new AbortController()
  const stalled: AsyncIterable<Float32Array[]> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }
  const pending = analyzeVideoEditBeatsOffThread(48000, stalled, controller.signal, 30)
  await Promise.resolve(); controller.abort(new Error('已取消分析'))
  await expect(pending).rejects.toThrow('已取消分析')
  expect(TestWorker.instances.at(-1)!.terminate).toHaveBeenCalled()
})
