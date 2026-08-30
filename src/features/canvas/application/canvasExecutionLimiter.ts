export interface CanvasExecutionLimiter {
  run<T>(operation: () => Promise<T>): Promise<T>
}

export function createCanvasExecutionLimiter(maxConcurrent: number): CanvasExecutionLimiter {
  let activeCount = 0
  const waiting: Array<() => void> = []
  const acquire = async (): Promise<void> => {
    if (activeCount < maxConcurrent) {
      activeCount += 1
      return
    }
    await new Promise<void>((resolve) => waiting.push(resolve))
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
    run: async <T>(operation: () => Promise<T>): Promise<T> => {
      await acquire()
      try {
        return await operation()
      } finally {
        release()
      }
    },
  }
}
