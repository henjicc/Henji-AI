import os from 'node:os'

/*
 * 后台媒体处理的总并行度：不超过约 75% 的逻辑核，任何时候给界面和用户自己的程序留出余量。
 * 重型槽与波形回读（audio/ops.ts）各分一半；占槽任务里的 FFmpeg 都用下面的线程参数限住线程数，
 * 槽数据此取值。超出的任务排队等待（可取消），不拒绝。
 */
export const MEDIA_BACKGROUND_THREADS = Math.max(2, Math.floor(os.availableParallelism() * 0.75))
/** 占槽 FFmpeg 的线程参数：解码 2 线程，滤镜与编码各 1 线程，按每任务 3 线程计。滤镜线程是全局选项，放在输入前。 */
export const MEDIA_HEAVY_FFMPEG_INPUT_THREADS = ['-filter_threads', '1', '-threads', '2'] as const
export const MEDIA_HEAVY_FFMPEG_OUTPUT_THREADS = ['-threads', '1'] as const
const MEDIA_HEAVY_TASK_THREADS = 3
export const MAX_HEAVY_MEDIA_TASKS = Math.max(1, Math.floor(MEDIA_BACKGROUND_THREADS / 2 / MEDIA_HEAVY_TASK_THREADS))

let activeTasks = 0
interface Waiter { resolve: () => void; reject: (error: unknown) => void; signal?: AbortSignal; onAbort?: () => void }
const waiters: Waiter[] = []

async function acquire(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (activeTasks < MAX_HEAVY_MEDIA_TASKS) {
    activeTasks += 1
    return
  }
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
