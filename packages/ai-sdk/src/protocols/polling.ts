import { isCancelled } from '../runtime/task-registry'
import { AiRuntimeError, cancelledError } from '../runtime/AiRuntimeError'
import { shouldRetry } from '../runtime/retry'

export async function waitIntervalMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw cancelledError('aborted')
  }

  await new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(cancelledError('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function ensureNotCancelled(requestId: string): void {
  if (isCancelled('generation', requestId)) {
    throw cancelledError(requestId)
  }
}

const DEFAULT_POLL_INTERVAL_MS = 3000

/**
 * 连续查询失败的容忍次数。注意这不是"任务能跑多久"的上限——任务只要还在跑就一直等；
 * 这里限制的是"查询动作本身连续失败"（网络断了、鉴权过期、taskId 已被服务端清理）。
 * 不设这个上限的话，一个失效的 taskId 会每 3 秒重试到天荒地老。
 * 任何一次查询成功（哪怕结果是"仍在处理中"）都会把计数清零。
 */
const MAX_CONSECUTIVE_QUERY_FAILURES = 20

export interface PollLoopInput {
  requestId: string
  signal?: AbortSignal
  polling?: { interval?: number }
}

/** step 返回该标记表示"这次查询没成功，但任务本身未必有问题"，计入连续失败 */
export const POLL_QUERY_FAILED = Symbol('poll-query-failed')

export type PollStepResult<T> = T | undefined | typeof POLL_QUERY_FAILED

/**
 * 异步任务轮询驱动：**不限制任务能跑多久**，只由四件事终止——
 * 1) step 返回结果（服务端已出结果）
 * 2) step 抛错（服务端明确失败）
 * 3) 用户取消 / abort
 * 4) 查询动作连续失败超过 MAX_CONSECUTIVE_QUERY_FAILURES 次
 *
 * 之前每个 provider 各自写一遍 `for (attempt < maxAttempts)`，长耗时任务（尤其视频）
 * 会在服务端还在跑的时候被我们自己单方面判超时，任务和结果一起丢掉。
 * `model.polling.maxAttempts` 保留，但只服务于进度估算（见 progress.ts），不再作为硬截止。
 *
 * step 的三种返回值语义要分清：
 * - 结果值：任务完成
 * - undefined：任务仍在处理中，无限等下去
 * - POLL_QUERY_FAILED：这次查询本身失败了，累计到一定次数就放弃
 */
export async function pollUntilResult<T>(
  input: PollLoopInput,
  step: () => Promise<PollStepResult<T>>
): Promise<T> {
  const interval = input.polling?.interval ?? DEFAULT_POLL_INTERVAL_MS
  let consecutiveFailures = 0
  let lastFailure: unknown = null

  for (;;) {
    ensureNotCancelled(input.requestId)
    await waitIntervalMs(interval, input.signal)

    let result: PollStepResult<T>
    try {
      result = await step()
    } catch (error) {
      // 服务端明确说任务失败、或用户取消——立即终止，重试没有意义
      if (!shouldRetry(error, 'poll-query')) {
        throw error
      }
      // 其余都是查询动作本身出的问题（HTTP 5xx、网络抖动、JSON 解析失败）。
      // 轮询现在可能持续几十分钟，一次抖动就丢掉整个任务是不可接受的，改为计入连续失败后重试。
      lastFailure = error
      result = POLL_QUERY_FAILED
    }

    if (result === POLL_QUERY_FAILED) {
      consecutiveFailures += 1
      if (consecutiveFailures >= MAX_CONSECUTIVE_QUERY_FAILURES) {
        throw new AiRuntimeError(
          'provider_task_unreachable',
          `Task status query failed ${consecutiveFailures} times in a row (last error: ${describeFailure(lastFailure)}); the task may no longer exist`
        )
      }
      continue
    }

    consecutiveFailures = 0
    lastFailure = null
    if (result !== undefined) {
      return result
    }
  }
}

function describeFailure(error: unknown): string {
  if (error === null) return 'provider reported a non-success status'
  return error instanceof Error ? error.message : String(error)
}
