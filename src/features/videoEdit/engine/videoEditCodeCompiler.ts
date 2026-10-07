import { CODE_MATERIAL_LIMITS, CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialProgram, CodeMaterialErrorCode, CodeSourceSpan } from '@/core/videoEdit/codeMaterial/contract'

export type CodeCompilerResponse = { id: number; cacheHit?: boolean } & ({ program: CodeMaterialProgram } | { error: { code: CodeMaterialErrorCode; message: string; sourceSpan?: CodeSourceSpan } })
export interface CodeCompilerWorker {
  onmessage: ((event: MessageEvent<CodeCompilerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(message: { id: number; source: string }): void
  terminate(): void
}
interface Pending { resolve: (program: CodeMaterialProgram) => void; reject: (error: Error) => void; clean: () => void }
/** Browser Worker is for thread isolation and bounded failure recovery; the AST
 * whitelist remains the execution boundary. No author JS enters this worker. */
export class VideoEditCodeCompiler {
  private worker?: CodeCompilerWorker
  private readonly pending = new Map<number, Pending>()
  private readonly jobs = new Set<number>()
  private next = 0
  private disposed = false
  private cacheHits = 0
  private workerStarts = 0
  constructor(private readonly createWorker: () => CodeCompilerWorker = () => new Worker(new URL('./videoEditCodeCompiler.worker.ts', import.meta.url), { type: 'module' }), private readonly timeoutMs = 5000) {}
  private acquire(): CodeCompilerWorker {
    if (this.worker) return this.worker
    const worker = this.createWorker(); this.worker = worker
    this.workerStarts++
    worker.onmessage = event => {
      if (this.worker !== worker) return
      const response = event.data
      if (!this.jobs.delete(response.id)) return
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id); pending.clean()
      if ('error' in response) pending.reject(new CodeMaterialError(response.error.code, response.error.message, response.error.sourceSpan))
      else { if (response.cacheHit) this.cacheHits++; pending.resolve(response.program) }
    }
    worker.onerror = event => { event.preventDefault?.(); if (this.worker === worker) this.reset(new Error(`源码检查线程失败：${event.message}`)) }
    worker.onmessageerror = () => { if (this.worker === worker) this.reset(new Error('源码检查结果无法读取，请重试。')) }
    return worker
  }
  private reset(error: Error): void {
    this.worker?.terminate(); this.worker = undefined
    for (const pending of this.pending.values()) { pending.clean(); pending.reject(error) }
    this.pending.clear()
    this.jobs.clear()
  }
  compile(source: string, signal?: AbortSignal): Promise<CodeMaterialProgram> {
    if (this.disposed) return Promise.reject(new Error('源码检查会话已关闭。'))
    if (signal?.aborted) return Promise.reject(new DOMException('源码检查已取消。', 'AbortError'))
    if (typeof source !== 'string' || source.length > CODE_MATERIAL_LIMITS.sourceBytes || new TextEncoder().encode(source).byteLength > CODE_MATERIAL_LIMITS.sourceBytes) return Promise.reject(new CodeMaterialError('SOURCE_LIMIT', '源码最多64KiB。'))
    if (this.jobs.size >= 8) return Promise.reject(new CodeMaterialError('BUDGET', '源码检查队列已满，请等待当前检查完成。'))
    let worker: CodeCompilerWorker
    try { worker = this.acquire() } catch (error) { return Promise.reject(error) }
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id); pending.clean(); pending.reject(new DOMException('源码检查已取消。', 'AbortError'))
        if (!this.pending.size) { this.worker?.terminate(); this.worker = undefined; this.jobs.clear() }
      }
      const timer = setTimeout(() => { if (this.pending.has(id)) this.reset(new Error('源码检查超过时限，已释放线程；最后有效版本保留，请重试。')) }, this.timeoutMs)
      const clean = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      this.jobs.add(id); this.pending.set(id, { resolve, reject, clean }); signal?.addEventListener('abort', abort, { once: true })
      try { worker.postMessage({ id, source }) } catch (error) { this.reset(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  dispose(): void { this.disposed = true; this.reset(new Error('源码检查会话已关闭。')) }
  diagnostics(): { activeWorkers: number; pending: number; cacheHits: number; workerStarts: number } { return { activeWorkers: this.worker ? 1 : 0, pending: this.pending.size, cacheHits: this.cacheHits, workerStarts: this.workerStarts } }
}
