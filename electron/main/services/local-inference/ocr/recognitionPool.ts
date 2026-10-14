import { Worker } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { recognitionBatches, RECOGNITION_BATCH_POLICY, type RecognitionBatchPolicy, type CropRecognizer, type RecognizedText, type RecognitionNormalization } from './recognition'

/** ORT's Node binding runs synchronously inside setImmediate. Actual batch concurrency needs worker threads. */
export class OcrRecognitionPool {
  private readonly workers: Worker[] = []
  private shared?: SharedArrayBuffer
  private closed = false
  private running = false
  constructor(readonly modelPath: string, private readonly alphabet: readonly string[], private readonly normalization: RecognitionNormalization = 'rgb-half', private readonly workerPath = path.join(__dirname, 'ocr-recognition-worker.cjs'), private readonly count = Math.min(3, Math.max(1, Math.floor(availableParallelism() / 2))), private readonly threads = Math.min(3, Math.max(1, Math.floor(availableParallelism() / count))), private readonly policy: RecognitionBatchPolicy = RECOGNITION_BATCH_POLICY) {}
  readonly recognize: CropRecognizer = async (rgb, width, crops, signal) => {
    signal.throwIfAborted()
    if (!crops.length) return []
    if (this.closed || this.running) throw new Error('文字识别线程池不可用。')
    this.running = true
    const abort = (): void => { void this.dispose() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      const count = crops.length < 12 ? 1 : this.count
      while (this.workers.length < count) {
        const worker = new Worker(this.workerPath, { workerData: { modelPath: this.modelPath, alphabet: this.alphabet, normalization: this.normalization, threads: this.threads, policy: this.policy }, name: 'henji-ocr-recognition' })
        // Keep an idle startup/runtime failure observable and make the whole pool fail closed.
        worker.on('error', () => { void this.dispose() })
        this.workers.push(worker)
      }
      if (this.shared?.byteLength !== rgb.byteLength) this.shared = new SharedArrayBuffer(rgb.byteLength)
      new Uint8Array(this.shared).set(rgb)
      const groups = Array.from({ length: count }, () => [] as number[]), loads = new Array<number>(count).fill(0)
      for (const batch of recognitionBatches(crops, this.policy).reverse()) {
        const target = loads.indexOf(Math.min(...loads))
        groups[target].push(...batch); loads[target] += batch.length * Math.max(...batch.map(i => crops[i].tensorWidth))
      }
      const results: RecognizedText[] = new Array(crops.length)
      await Promise.all(groups.map(async (indices, index) => {
        if (!indices.length) return
        const worker = this.workers[index]
        const result = await new Promise<RecognizedText[]>((resolve, reject) => {
          const clean = (): void => { worker.off('message', message); worker.off('error', error); worker.off('exit', exit) }
          const message = (value: { result?: RecognizedText[]; error?: string }): void => { clean(); if (value.error || !value.result) reject(new Error(value.error ?? '文字识别没有返回结果。')); else resolve(value.result) }
          const error = (value: Error): void => { clean(); reject(value) }
          const exit = (): void => error(new Error('文字识别线程已结束。'))
          worker.once('message', message); worker.once('error', error); worker.once('exit', exit)
          worker.postMessage({ rgb: this.shared, width, crops: indices.map(i => crops[i]) })
        })
        if (result.length !== indices.length) throw new Error('文字识别批大小不匹配。')
        indices.forEach((i, n) => { results[i] = result[n] })
      }))
      signal.throwIfAborted()
      return results
    } catch (error) { await this.dispose(); signal.throwIfAborted(); throw error }
    finally { signal.removeEventListener('abort', abort); this.running = false }
  }
  async dispose(): Promise<void> {
    this.closed = true; this.shared = undefined
    await Promise.allSettled(this.workers.splice(0).map(worker => worker.terminate()))
  }
}
