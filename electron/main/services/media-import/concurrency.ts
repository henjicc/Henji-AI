const MAX_HEAVY_MEDIA_TASKS = 2

let activeTasks = 0
interface Waiter { resolve: () => void; reject: (error: unknown) => void; signal?: AbortSignal; onAbort?: () => void }
const waiters: Waiter[] = []

async function acquire(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (activeTasks < MAX_HEAVY_MEDIA_TASKS) {
    activeTasks += 1
    return
  }
  if (waiters.length >= 256) throw new Error('媒体处理排队已满，请稍后重试。')
  await new Promise<void>((resolve, reject) => {
    const waiter: Waiter = { resolve, reject, signal }
    waiter.onAbort = () => { const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1); reject(signal?.reason) }
    signal?.addEventListener('abort', waiter.onAbort, { once: true }); waiters.push(waiter)
  })
}

function release(): void {
  const waiter = waiters.shift()
  if (waiter) { if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort); waiter.resolve() }
  else activeTasks = Math.max(0, activeTasks - 1)
}

export async function withMediaHeavyTask<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  await acquire(signal)
  try {
    signal?.throwIfAborted()
    return await task()
  } finally {
    release()
  }
}
