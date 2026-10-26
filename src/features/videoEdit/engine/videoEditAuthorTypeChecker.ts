import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import type { CodeTypeCheckResult } from '@/core/videoEdit/codeMaterial/typeDiagnostics'

export interface AuthorTypeCheckRequest { id: number; kind: 'author.typecheck'; files: CodeMaterialFiles; report: string[] }
export type AuthorTypeCheckResponse = { id: number } & ({ typeCheck: CodeTypeCheckResult } | { error: string })
export interface AuthorTypeCheckWorker {
  onmessage: ((event: MessageEvent<AuthorTypeCheckResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(message: AuthorTypeCheckRequest): void
  terminate(): void
}
interface Pending { resolve: (result: CodeTypeCheckResult) => void; reject: (error: Error) => void; clean: () => void }

/**
 * 类型检查单独占一个源码检查 Worker 实例（与打包同一份 Worker 代码，不另打一份 TypeScript）：
 * 打包请求不会排在检查后面，检查器的标准库与已解析文件常驻复用；空闲一段时间后释放线程与内存。
 */
export class VideoEditAuthorTypeChecker {
  private worker?: AuthorTypeCheckWorker
  private readonly pending = new Map<number, Pending>()
  private next = 0
  private idle?: ReturnType<typeof setTimeout>
  constructor(
    private readonly createWorker: () => AuthorTypeCheckWorker = () => new Worker(new URL('./videoEditCodeCompiler.worker.ts', import.meta.url), { type: 'module' }),
    private readonly timeoutMs = 20_000,
    private readonly idleMs = 120_000,
  ) {}
  check(files: CodeMaterialFiles, report: readonly string[], signal?: AbortSignal): Promise<CodeTypeCheckResult> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    let worker: AuthorTypeCheckWorker
    try { worker = this.acquire() } catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))) }
    clearTimeout(this.idle)
    const id = ++this.next
    return new Promise<CodeTypeCheckResult>((resolve, reject) => {
      // 取消只放弃这次结果，不结束线程：检查器的热状态留给下一次。
      const abort = (): void => { if (this.pending.get(id)) { this.settle(id)?.reject(signal?.reason instanceof Error ? signal.reason : new DOMException('类型检查已取消。', 'AbortError')) } }
      const timer = setTimeout(() => { if (this.pending.has(id)) this.reset(new Error(`类型检查超过 ${Math.round(this.timeoutMs / 1000)} 秒未完成，已释放检查线程。`)) }, this.timeoutMs)
      const clean = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      this.pending.set(id, { resolve, reject, clean })
      signal?.addEventListener('abort', abort, { once: true })
      try { worker.postMessage({ id, kind: 'author.typecheck', files, report: [...report] }) } catch (error) { this.reset(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  dispose(): void { this.reset(new Error('类型检查已关闭。')) }
  private acquire(): AuthorTypeCheckWorker {
    if (this.worker) return this.worker
    const worker = this.createWorker(); this.worker = worker
    worker.onmessage = event => {
      if (this.worker !== worker) return
      const response = event.data, pending = this.settle(response.id)
      if (!pending) return
      if ('error' in response) pending.reject(new Error(response.error))
      else pending.resolve(response.typeCheck)
    }
    worker.onerror = event => { event.preventDefault?.(); if (this.worker === worker) this.reset(new Error(`类型检查线程失败：${event.message}`)) }
    worker.onmessageerror = () => { if (this.worker === worker) this.reset(new Error('类型检查结果无法读取。')) }
    return worker
  }
  private settle(id: number): Pending | undefined {
    const pending = this.pending.get(id)
    if (!pending) return undefined
    this.pending.delete(id); pending.clean()
    if (!this.pending.size && this.worker) {
      clearTimeout(this.idle)
      const worker = this.worker
      this.idle = setTimeout(() => { if (this.worker === worker && !this.pending.size) { worker.terminate(); this.worker = undefined } }, this.idleMs)
    }
    return pending
  }
  private reset(error: Error): void {
    clearTimeout(this.idle)
    this.worker?.terminate(); this.worker = undefined
    const pending = [...this.pending.values()]; this.pending.clear()
    for (const entry of pending) { entry.clean(); entry.reject(error) }
  }
}
