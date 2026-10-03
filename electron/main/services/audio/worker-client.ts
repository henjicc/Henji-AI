import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { AudioWaveformWorkerOptions, AudioWaveformWorkerRequest, AudioWaveformChannel, AudioWaveformPyramidOutput } from './types'

interface WorkerReply { channels?: AudioWaveformChannel[]; pyramid?: AudioWaveformPyramidOutput['pyramid'] }

export class AudioWaveformWorker {
  private readonly worker: Worker
  private id = 0
  private pending?: { id: number; resolve: (reply: WorkerReply) => void; reject: (error: Error) => void }
  private closed = false
  private closePromise?: Promise<void>
  constructor(workerPath: string | URL = path.join(__dirname, 'audio-waveform-worker.cjs')) {
    this.worker = new Worker(workerPath, { name: 'henji-audio-waveform' })
    this.worker.on('message', (raw: { id: number; ok: boolean; message?: string } & WorkerReply) => {
      const pending = this.pending
      if (!pending || raw.id !== pending.id) return
      this.pending = undefined
      if (!raw.ok) pending.reject(new Error(raw.message ?? '音频聚合失败。'))
      else pending.resolve(raw)
    })
    this.worker.on('error', error => this.fail(error))
    this.worker.on('exit', code => { if (!this.closed) { this.closed = true; this.fail(new Error(`音频 Worker 意外退出（${code}）。`)) } })
  }
  private fail(error: Error): void { this.pending?.reject(error); this.pending = undefined }
  private call(message: Omit<AudioWaveformWorkerRequest, 'id'>): Promise<WorkerReply> {
    if (this.closed) return Promise.reject(new Error('音频 Worker 已关闭。'))
    if (this.pending) return Promise.reject(new Error('音频 Worker 仅允许一个在途采样块。'))
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject }
      try { this.worker.postMessage({ ...message, id }, message.bytes ? [message.bytes.buffer as ArrayBuffer] : []) }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  async start(options: AudioWaveformWorkerOptions): Promise<void> { await this.call({ type: 'start', options }) }
  async push(bytes: Uint8Array): Promise<void> {
    if (bytes.length > 1024 * 1024) throw new Error('波形采样块超过资源上限。')
    await this.call({ type: 'chunk', bytes: Uint8Array.from(bytes) })
  }
  async finish(): Promise<AudioWaveformChannel[]> {
    const { channels } = await this.call({ type: 'finish' })
    if (!channels) throw new Error('音频 Worker 未返回波形。')
    return channels
  }
  async finishPyramid(): Promise<AudioWaveformPyramidOutput> {
    const { channels, pyramid } = await this.call({ type: 'finish' })
    if (!channels || !pyramid) throw new Error('音频 Worker 未返回多级波形。')
    return { channels, pyramid }
  }
  dispose(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true
    this.fail(new DOMException('操作已取消', 'AbortError'))
    this.closePromise = this.worker.terminate().then(() => undefined)
    return this.closePromise
  }
}
