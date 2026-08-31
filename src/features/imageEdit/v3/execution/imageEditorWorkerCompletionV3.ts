export interface WaitForImageEditorWorkerCompletionOptionsV3 {
  signals: readonly AbortSignal[]
  onAbort(): void
  start(): void
  fallbackAbortError(): Error
}

/** 把一次 Worker 消息往返变成可由全局调度器持有和协作取消的 Promise。 */
export class ImageEditorWorkerCompletionV3<T> {
  private resolveActive: ((value: T) => void) | null = null
  private rejectActive: ((error: Error) => void) | null = null

  wait(options: WaitForImageEditorWorkerCompletionOptionsV3): Promise<T> {
    if (this.resolveActive || this.rejectActive) {
      return Promise.reject(new Error('同一 Worker 任务不能重复等待'))
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (complete: () => void): void => {
        if (settled) return
        settled = true
        for (const signal of options.signals) signal.removeEventListener('abort', onAbort)
        this.resolveActive = null
        this.rejectActive = null
        complete()
      }
      const onAbort = (): void => finish(() => {
        const reason = options.signals.find((signal) => signal.aborted)?.reason
        let cleanupError: Error | null = null
        try {
          options.onAbort()
        } catch (error) {
          cleanupError = error instanceof Error ? error : new Error(String(error))
        }
        reject(reason instanceof Error ? reason : cleanupError ?? options.fallbackAbortError())
      })
      this.resolveActive = (value) => finish(() => resolve(value))
      this.rejectActive = (error) => finish(() => reject(error))
      for (const signal of options.signals) signal.addEventListener('abort', onAbort, { once: true })
      if (options.signals.some((signal) => signal.aborted)) onAbort()
      else {
        try {
          options.start()
        } catch (error) {
          this.reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })
  }

  resolve(value: T): boolean {
    const complete = this.resolveActive
    if (!complete) return false
    complete(value)
    return true
  }

  reject(error: Error): boolean {
    const fail = this.rejectActive
    if (!fail) return false
    fail(error)
    return true
  }
}
