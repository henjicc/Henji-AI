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
  private readonly jobs = new Map<number, { files: CodeMaterialFiles; kind: 'author.bundle' }>()
  private active?: number
  private timer?: ReturnType<typeof setTimeout>
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
      if (this.active !== response.id || !this.jobs.delete(response.id)) return
      clearTimeout(this.timer); this.timer = undefined; this.active = undefined
      const pending = this.pending.get(response.id)
      if (pending) {
        this.pending.delete(response.id); pending.clean()
        if ('error' in response) pending.reject(restoreContentTrustError(new CodeMaterialError(response.error.code, response.error.message, response.error.sourceSpan), response.error.contentTrust))
        else { if (response.cacheHit) this.cacheHits++; pending.resolve(response) }
      }
      this.startNext()
    }
    worker.onerror = event => { event.preventDefault?.(); if (this.worker === worker) this.reset(new Error(`源码检查线程失败：${event.message}`)) }
    worker.onmessageerror = () => { if (this.worker === worker) this.reset(new Error('源码检查结果无法读取，请重试。')) }
    return worker
  }
  private reset(error: Error): void {
    clearTimeout(this.timer); this.timer = undefined; this.active = undefined
    this.worker?.terminate(); this.worker = undefined
    for (const pending of this.pending.values()) { pending.clean(); pending.reject(error) }
    this.pending.clear()
    this.jobs.clear()
  }
  /** 单个编译线程按到达顺序处理，排队时间不占源码执行时限。 */
  bundleQueued(files: CodeMaterialFiles, signal?: AbortSignal): Promise<AuthorBundle> { return this.bundle(files, signal) }
  private startNext(): void {
    if (this.active !== undefined || this.disposed) return
    const next = this.jobs.entries().next().value
    if (!next) return
    const [id, job] = next
    this.active = id
    this.timer = setTimeout(() => this.reset(Object.assign(new Error('源码检查超过时限，已释放线程；最后有效版本保留，请重试。'), { name: 'VideoEditCodeCompileTimeoutError' })), this.timeoutMs)
    try { this.acquire().postMessage({ id, ...job }) } catch (error) { this.reset(error instanceof Error ? error : new Error(String(error))) }
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
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        const pending = this.pending.get(id)
        if (!pending) return
        // 已开始的检查继续写入线程缓存；尚未开始的取消请求无需再编译。
        this.pending.delete(id); pending.clean(); pending.reject(new DOMException('源码检查已取消。', 'AbortError'))
        if (this.active !== id) this.jobs.delete(id)
      }
      const clean = (): void => { signal?.removeEventListener('abort', abort) }
      this.jobs.set(id, { files, kind }); this.pending.set(id, { resolve, reject, clean }); signal?.addEventListener('abort', abort, { once: true })
      this.startNext()
    })
  }
  dispose(): void { this.disposed = true; this.reset(new Error('源码检查会话已关闭。')) }
  diagnostics(): { activeWorkers: number; pending: number; cacheHits: number; workerStarts: number } { return { activeWorkers: this.worker ? 1 : 0, pending: this.pending.size, cacheHits: this.cacheHits, workerStarts: this.workerStarts } }
}
