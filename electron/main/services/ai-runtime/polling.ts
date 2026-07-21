import { cancelledError } from './errors'
import { isCancelled } from './task-registry'

export async function waitIntervalMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw cancelledError('aborted')
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(cancelledError('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function ensureNotCancelled(requestId: string): void {
  if (isCancelled(requestId)) {
    throw cancelledError(requestId)
  }
}

const DEFAULT_POLL_INTERVAL_MS = 3000

export interface PollLoopInput {
  requestId: string
  signal?: AbortSignal
  polling?: { interval?: number }
}

/**
 * 异步任务轮询驱动：不设查询次数上限，只由三件事终止——
 * 1) step 返回结果（服务端已出结果）
 * 2) step 抛错（服务端明确失败）
 * 3) 用户取消 / abort
 *
 * 之前每个 provider 各自写一遍 `for (attempt < maxAttempts)`，长耗时任务（尤其视频）
 * 会在服务端还在跑的时候被我们自己单方面判超时，任务和结果一起丢掉。
 * `model.polling.maxAttempts` 保留，但只服务于进度估算（见 progress.ts），不再作为硬截止。
 */
export async function pollUntilResult<T>(
  input: PollLoopInput,
  step: () => Promise<T | undefined>
): Promise<T> {
  const interval = input.polling?.interval ?? DEFAULT_POLL_INTERVAL_MS
  for (;;) {
    ensureNotCancelled(input.requestId)
    await waitIntervalMs(interval, input.signal)
    const result = await step()
    if (result !== undefined) {
      return result
    }
  }
}
