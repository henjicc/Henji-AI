export interface ImageEditorViewportWorkerRetirementOptionsV3<T> {
  timeoutMs: number
  release(value: T): void
  onTimeout(): void
}

/**
 * Worker 取消后继续持有 transferable，直到明确回执或超时终止。这个队列让预算
 * 回收与真实资源所有权一致，同时把最坏取消等待限制在 50ms 内。
 */
export class ImageEditorViewportWorkerRetirementV3<T> {
  private readonly values = new Map<string, T>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly waiters = new Set<() => void>()

  constructor(private readonly options: ImageEditorViewportWorkerRetirementOptionsV3<T>) {
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
      throw new Error('Worker 取消回执超时必须是正整数')
    }
  }

  retire(key: string, value: T): void {
    if (this.values.has(key)) throw new Error('Worker 任务重复进入取消回收队列')
    this.values.set(key, value)
    this.timers.set(key, setTimeout(() => {
      if (!this.values.has(key)) return
      this.options.onTimeout()
      this.releaseAll()
    }, this.options.timeoutMs))
  }

  acknowledge(key: string): boolean {
    const value = this.values.get(key)
    if (!value) return false
    this.values.delete(key)
    const timer = this.timers.get(key)
    if (timer) clearTimeout(timer)
    this.timers.delete(key)
    this.options.release(value)
    this.notifyIfEmpty()
    return true
  }

  releaseAll(): void {
    for (const [key, value] of this.values) {
      const timer = this.timers.get(key)
      if (timer) clearTimeout(timer)
      this.options.release(value)
    }
    this.values.clear()
    this.timers.clear()
    this.notifyIfEmpty()
  }

  wait(signal: AbortSignal, abortError: () => Error): Promise<void> {
    if (this.values.size === 0) return Promise.resolve()
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (complete: () => void): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        this.waiters.delete(onReady)
        complete()
      }
      const onReady = (): void => finish(resolve)
      const onAbort = (): void => finish(() => reject(abortError()))
      signal.addEventListener('abort', onAbort, { once: true })
      this.waiters.add(onReady)
    })
  }

  private notifyIfEmpty(): void {
    if (this.values.size !== 0) return
    for (const resolve of this.waiters) resolve()
    this.waiters.clear()
  }
}
