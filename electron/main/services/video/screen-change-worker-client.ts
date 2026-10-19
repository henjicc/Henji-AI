import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { ScreenChangeOptions, ScreenChangeScan } from '../../../../src/core/videoEdit/screenChanges'
import { screenChangeScanSchema } from '../../../../src/core/media/screenChangeEvidence'
import type { ScreenChangeWorkerRequest } from './screen-change-worker'

export class ScreenChangeWorker {
  private readonly worker: Worker
  private id = 0
  private pending?: { id: number; resolve: (value: unknown) => void; reject: (error: Error) => void }
  private closed = false
  private closing?: Promise<void>
  constructor(options: ScreenChangeOptions, workerPath: string | URL = path.join(__dirname, 'video-screen-change-worker.cjs')) {
    this.worker = new Worker(workerPath, { name: 'henji-video-screen-change', workerData: options })
    this.worker.on('message', (reply: { id: number; ok: boolean; message?: string; scan?: unknown }) => {
      const pending = this.pending
      if (!pending || pending.id !== reply.id) return
      this.pending = undefined
      if (reply.ok) pending.resolve(reply.scan)
      else pending.reject(new Error(reply.message ?? '局部画面分析失败。'))
    })
    this.worker.on('error', error => this.fail(error))
    this.worker.on('exit', code => { if (!this.closed) { this.closed = true; this.fail(new Error(`局部画面分析进程意外退出（${code}）。`)) } })
  }
  private fail(error: Error): void { this.pending?.reject(error); this.pending = undefined }
  private call(request: Omit<Extract<ScreenChangeWorkerRequest, { type: 'chunk' }>, 'id'> | Omit<Extract<ScreenChangeWorkerRequest, { type: 'finish' }>, 'id'>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('局部画面分析进程已关闭。'))
    if (this.pending) return Promise.reject(new Error('局部画面分析仅允许一个在途采样块。'))
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject }
      try { this.worker.postMessage({ ...request, id }, request.type === 'chunk' ? [request.bytes.buffer as ArrayBuffer] : []) }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  async push(bytes: Uint8Array): Promise<void> {
    if (bytes.length > 1024 * 1024) throw new Error('局部变化采样块超过资源上限。')
    await this.call({ type: 'chunk', bytes: Uint8Array.from(bytes) })
  }
  async finish(): Promise<ScreenChangeScan> { return screenChangeScanSchema.parse(await this.call({ type: 'finish' })) }
  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true; this.fail(new DOMException('局部变化分析已取消。', 'AbortError'))
    this.closing = this.worker.terminate().then(() => undefined)
    return this.closing
  }
}
