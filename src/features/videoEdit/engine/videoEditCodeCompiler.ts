import { type CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialErrorCode, CodeSourceSpan } from '@/core/videoEdit/codeMaterial/contract'
import type { AuthorBundle } from './videoEditAuthorBundle'
import { directAuthorBundle } from './videoEditAuthorModules'
import { authorJsLocations } from './videoEditAuthorJsLocations'
import { restoreContentTrustError, type ContentTrustFailure } from '@/core/contentTrust'

export type CodeCompilerResponse = { id: number; cacheHit?: boolean } & ({ bundle: AuthorBundle } | { error: { code: CodeMaterialErrorCode; message: string; sourceSpan?: CodeSourceSpan; contentTrust?: ContentTrustFailure } })
export interface CodeCompilerWorker {
  onmessage: ((event: MessageEvent<CodeCompilerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(message: { id: number; files: CodeMaterialFiles; kind: 'author.bundle' }): void
  terminate(): void
}
let sharedWorkerFactory: (() => CodeCompilerWorker) | undefined
/** Render workers delegate to the host's existing source compiler/cache. */
export function setVideoEditCodeCompilerWorkerFactory(factory: () => CodeCompilerWorker): void { sharedWorkerFactory = factory }
interface Pending { resolve: (response: CodeCompilerResponse) => void; reject: (error: Error) => void; clean: () => void }
/** Shared compilation/linking only; executable modules run in the render worker. */
export class VideoEditCodeCompiler {
  private worker?: CodeCompilerWorker
  private readonly pending = new Map<number, Pending>()
  private readonly jobs = new Set<number>()
  private readonly capacityWaiters = new Set<() => void>()
  private next = 0
  private disposed = false
  private cacheHits = 0
  private workerStarts = 0
  constructor(private readonly createWorker: () => CodeCompilerWorker = () => sharedWorkerFactory?.() ?? new Worker(new URL('./videoEditCodeCompiler.worker.ts', import.meta.url), { type: 'module' }), private readonly timeoutMs = 5000) {}
  private acquire(): CodeCompilerWorker {
    if (this.worker) return this.worker
    const worker = this.createWorker(); this.worker = worker
    this.workerStarts++
    worker.onmessage = event => {
      if (this.worker !== worker) return
      const response = event.data
      if (!this.jobs.delete(response.id)) return
      this.wakeCapacityWaiters()
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id); pending.clean()
      if ('error' in response) pending.reject(restoreContentTrustError(new CodeMaterialError(response.error.code, response.error.message, response.error.sourceSpan), response.error.contentTrust))
      else { if (response.cacheHit) this.cacheHits++; pending.resolve(response) }
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
    this.wakeCapacityWaiters()
  }
  private wakeCapacityWaiters(): void { for (const wake of [...this.capacityWaiters]) wake() }
  /** Shared preparation waits for the existing eight-job limit. It must not
   * turn independent sessions into a new user-visible global budget failure. */
  async bundleQueued(files: CodeMaterialFiles, signal?: AbortSignal): Promise<AuthorBundle> {
    if (!directAuthorBundle(files)) await this.waitForCapacity(signal)
    return this.bundle(files, signal)
  }
  private async waitForCapacity(signal?: AbortSignal): Promise<void> {
    while (this.jobs.size >= 8 && !this.disposed) {
      signal?.throwIfAborted()
      await new Promise<void>((resolve, reject) => {
        const clean = (): void => { this.capacityWaiters.delete(wake); signal?.removeEventListener('abort', abort) }
        const wake = (): void => { clean(); resolve() }
        const abort = (): void => { clean(); reject(signal?.reason) }
        this.capacityWaiters.add(wake); signal?.addEventListener('abort', abort, { once: true })
      })
    }
  }
  bundle(files: CodeMaterialFiles, signal?: AbortSignal): Promise<AuthorBundle> {
    if (this.disposed) return Promise.reject(new Error('源码读取会话已关闭。'))
    if (signal?.aborted) return Promise.reject(signal.reason)
    const direct = directAuthorBundle(files)
    // 静态导入：Worker 构建里的动态导入会触发 Vite 4 预加载分析缺陷（构建失败）；acorn 体积小。
    if (direct) return Promise.resolve({ ...direct, locations: authorJsLocations(files) })
    return this.request(files, 'author.bundle', signal).then(response => { if ('bundle' in response) return response.bundle; throw new Error('模块打包返回了错误的结果类型。') })
  }
  private request(files: CodeMaterialFiles, kind: 'author.bundle', signal?: AbortSignal): Promise<CodeCompilerResponse> {
    if (this.disposed) return Promise.reject(new Error('源码检查会话已关闭。'))
    if (signal?.aborted) return Promise.reject(new DOMException('源码检查已取消。', 'AbortError'))
    if (this.jobs.size >= 8) return Promise.reject(new CodeMaterialError('BUDGET', '源码检查队列已满，请等待当前检查完成。'))
    let worker: CodeCompilerWorker
    try { worker = this.acquire() } catch (error) { return Promise.reject(error) }
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        const pending = this.pending.get(id)
        if (!pending) return
        // Only this observer stops waiting. The worker finishes the build into its cache, so the next request for the
        // same source (the next frame of a scrub across a new section, a jump back to it) is a cache hit instead of a
        // cold worker rebuilding every section; the job keeps its queue slot until its receipt arrives.
        this.pending.delete(id); pending.clean(); pending.reject(new DOMException('源码检查已取消。', 'AbortError'))
      }
      const timer = setTimeout(() => { if (this.pending.has(id)) this.reset(new Error('源码检查超过时限，已释放线程；最后有效版本保留，请重试。')) }, this.timeoutMs)
      const clean = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      this.jobs.add(id); this.pending.set(id, { resolve, reject, clean }); signal?.addEventListener('abort', abort, { once: true })
      try { worker.postMessage({ id, files, kind }) } catch (error) { this.reset(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  dispose(): void { this.disposed = true; this.reset(new Error('源码检查会话已关闭。')) }
  diagnostics(): { activeWorkers: number; pending: number; cacheHits: number; workerStarts: number } { return { activeWorkers: this.worker ? 1 : 0, pending: this.pending.size, cacheHits: this.cacheHits, workerStarts: this.workerStarts } }
}
