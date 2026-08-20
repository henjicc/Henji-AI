const MAX_HEAVY_MEDIA_TASKS = 2

let activeTasks = 0
const waiters: Array<() => void> = []

async function acquire(): Promise<void> {
  if (activeTasks < MAX_HEAVY_MEDIA_TASKS) {
    activeTasks += 1
    return
  }
  await new Promise<void>((resolve) => waiters.push(resolve))
  activeTasks += 1
}

function release(): void {
  activeTasks = Math.max(0, activeTasks - 1)
  waiters.shift()?.()
}

export async function withMediaHeavyTask<T>(task: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await task()
  } finally {
    release()
  }
}
