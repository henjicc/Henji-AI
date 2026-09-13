export interface CanvasExecutionLimiter {
  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>
  setMaxConcurrency(value: number): void
}

export function createCanvasExecutionLimiter(maxConcurrent: number): CanvasExecutionLimiter {
  let activeCount = 0
  const waiting: Array<() => void> = []
  const drain = () => {
    while (waiting.length && activeCount < maxConcurrent) {
      activeCount += 1
      waiting.shift()!()
    }
  }
  const acquire = async (signal?: AbortSignal): Promise<void> => {
    signal?.throwIfAborted()
    if (activeCount < maxConcurrent) {
      activeCount += 1
      return
    }
    await new Promise<void>((resolve, reject) => {
      const grant = () => { signal?.removeEventListener('abort', abort); resolve() }
      const abort = () => {
        const index = waiting.indexOf(grant)
        if (index < 0) return
        waiting.splice(index, 1)
        signal?.removeEventListener('abort', abort)
        reject(signal?.reason)
      }
      waiting.push(grant)
      signal?.addEventListener('abort', abort, { once: true })
    })
  }
  const release = (): void => {
    activeCount -= 1
    // 同一同步栈中预占并移交名额，降低并发时等待已有任务自然结束。
    drain()
  }
  return {
    setMaxConcurrency: value => {
      maxConcurrent = Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : maxConcurrent
      drain()
    },
    run: async <T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
      await acquire(signal)
      try {
        signal?.throwIfAborted()
        return await operation()
      } finally {
        release()
      }
    },
  }
}
