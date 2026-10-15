import type { AudioContentAnalysis } from '@/core/audioAnalysis/contentAnalysis'
import type { BeatAnalysisResult } from '@/core/audioAnalysis/beatAnalysis'
import type { BeatWorkerRequest, BeatWorkerResponse } from '@/core/audioAnalysis/beatWorker'

export function analyzeVideoEditBeatsOffThread(sampleRate: number, blocks: AsyncIterable<Float32Array[]>, signal: AbortSignal): Promise<BeatAnalysisResult>
export function analyzeVideoEditBeatsOffThread(sampleRate: number, blocks: AsyncIterable<Float32Array[]>, signal: AbortSignal, fps: number): Promise<AudioContentAnalysis>
export async function analyzeVideoEditBeatsOffThread(sampleRate: number, blocks: AsyncIterable<Float32Array[]>, signal: AbortSignal, fps?: number): Promise<BeatAnalysisResult | AudioContentAnalysis> {
  signal.throwIfAborted()
  const worker = new Worker(new URL('../../../core/audioAnalysis/beatWorker.ts', import.meta.url), { type: 'module' })
  let failure: Error | undefined
  let pending: { resolve: (value: BeatWorkerResponse) => void; reject: (error: unknown) => void } | undefined
  let rejectCancelled: (reason: unknown) => void = () => {}
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject })
  // A cancellation may arrive before a PCM read begins.
  void cancelled.catch(() => {})
  const abort = (): void => { const reason = signal.reason ?? new DOMException('已取消', 'AbortError'); pending?.reject(reason); rejectCancelled(reason); worker.terminate() }
  const failed = (error: Error): void => { failure = error; pending?.reject(error); pending = undefined; rejectCancelled(error) }
  worker.onmessage = (event: MessageEvent<BeatWorkerResponse>): void => {
    if (event.data.kind === 'error') failed(new Error(event.data.message))
    else pending?.resolve(event.data)
    pending = undefined
  }
  worker.onerror = event => failed(new Error(event.message))
  worker.onmessageerror = () => failed(new Error('节拍分析数据传递失败，请重试。'))
  signal.addEventListener('abort', abort, { once: true })
  const send = (request: BeatWorkerRequest): Promise<BeatWorkerResponse> => new Promise((resolve, reject) => {
    signal.throwIfAborted(); if (failure) { reject(failure); return }
    pending = { resolve, reject }
    worker.postMessage(request, request.kind === 'block' ? request.planes.map(plane => plane.buffer as ArrayBuffer) : [])
  })
  try {
    await send({ kind: 'begin', sampleRate, ...(fps === undefined ? {} : { fps }) })
    const iterator = blocks[Symbol.asyncIterator]()
    try {
      for (;;) {
        const block = await Promise.race([iterator.next(), cancelled])
        if (block.done) break
        await send({ kind: 'block', planes: block.value })
      }
    } finally { void iterator.return?.().catch(() => {}) }
    const result = await send({ kind: 'finish' })
    if (result.kind !== 'result' && result.kind !== 'content') throw new Error('节拍结果不完整，请重试。')
    signal.throwIfAborted(); return result.result
  } finally { signal.removeEventListener('abort', abort); worker.terminate() }
}
