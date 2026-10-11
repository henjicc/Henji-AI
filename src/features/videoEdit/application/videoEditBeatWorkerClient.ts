import type { BeatAnalysisResult } from '@/core/audioAnalysis/beatAnalysis'
import type { BeatWorkerRequest, BeatWorkerResponse } from '@/core/audioAnalysis/beatWorker'

export async function analyzeVideoEditBeatsOffThread(sampleRate: number, blocks: AsyncIterable<Float32Array[]>, signal: AbortSignal): Promise<BeatAnalysisResult> {
  signal.throwIfAborted()
  const worker = new Worker(new URL('../../../core/audioAnalysis/beatWorker.ts', import.meta.url), { type: 'module' })
  let failure: Error | undefined
  let pending: { resolve: (value: BeatWorkerResponse) => void; reject: (error: unknown) => void } | undefined
  const abort = (): void => { pending?.reject(signal.reason ?? new DOMException('已取消', 'AbortError')); worker.terminate() }
  worker.onmessage = (event: MessageEvent<BeatWorkerResponse>): void => {
    if (event.data.kind === 'error') { failure = new Error(event.data.message); pending?.reject(failure) }
    else pending?.resolve(event.data)
    pending = undefined
  }
  worker.onerror = event => { failure = new Error(event.message); pending?.reject(failure); pending = undefined }
  worker.onmessageerror = () => { failure = new Error('节拍分析数据传递失败，请重试。'); pending?.reject(failure); pending = undefined }
  signal.addEventListener('abort', abort, { once: true })
  const send = (request: BeatWorkerRequest): Promise<BeatWorkerResponse> => new Promise((resolve, reject) => {
    signal.throwIfAborted(); if (failure) { reject(failure); return }
    pending = { resolve, reject }
    worker.postMessage(request, request.kind === 'block' ? request.planes.map(plane => plane.buffer as ArrayBuffer) : [])
  })
  try {
    await send({ kind: 'begin', sampleRate })
    for await (const planes of blocks) await send({ kind: 'block', planes })
    const result = await send({ kind: 'finish' })
    if (result.kind !== 'result') throw new Error('节拍结果不完整，请重试。')
    signal.throwIfAborted(); return result.result
  } finally { signal.removeEventListener('abort', abort); worker.terminate() }
}
