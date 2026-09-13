export interface CanvasExecutionLimiter {
  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>
}

export function createCanvasExecutionLimiter(maxConcurrent: number): CanvasExecutionLimiter {
  let activeCount = 0
  const waiting: Array<() => void> = []
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
    const next = waiting.shift()
    if (next) {
      // 当前 permit 直接移交给队首；若先减计数再唤醒，插队微任务会抢到同一名额。
      next()
      return
    }
    activeCount -= 1
  }
  return {
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
