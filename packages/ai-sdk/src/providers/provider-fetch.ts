import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { describeNetworkFailure, shouldRetry, type NetworkFailure } from '../runtime/retry'
import type { Transport } from '../runtime/Transport'

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted)
    || (error instanceof Error && error.name === 'AbortError')
}

export async function fetchProvider(
  provider: string,
  endpoint: string,
  init: RequestInit,
  options: {
    // SDK 内部不能直接调用全局 `fetch`（三个目标运行时的"发请求"方式并不等价，见
    // `runtime/Transport.ts` 顶部注释），网络能力一律经宿主注入的 `Transport` 发出。
    transport: Transport
    retryPreconnectOnce: boolean
    fallbackEndpoints?: readonly string[]
    onEndpointReached?: (endpoint: string) => void
  }
): Promise<Response> {
  const endpoints = [endpoint, ...(options.fallbackEndpoints ?? []).filter((value) => value !== endpoint)]
  let lastFailure: NetworkFailure | undefined
  const attempts: Array<{ host: string; code: string; stage: 'before_send' | 'unknown'; durationMs: number }> = []
  const method = (init.method ?? 'GET').toUpperCase()
  const readOnly = method === 'GET' || method === 'HEAD'
  const recordFailure = (error: unknown, url: string, startedAt: number): NetworkFailure => {
    const failure = describeNetworkFailure(error)
    // 不记录查询字符串、任务路径、请求头或正文，避免把密钥与用户内容写入诊断。
    let host = 'invalid-url'
    try { host = new URL(url).hostname } catch { /* 非标准地址只记分类。 */ }
    attempts.push({ host, code: failure.code, stage: shouldRetry(error, 'safe-preconnect') ? 'before_send' : 'unknown', durationMs: Date.now() - startedAt })
    return failure
  }

  for (let index = 0; index < endpoints.length; index += 1) {
    const startedAt = Date.now()
    try {
      const response = await options.transport.fetch(endpoints[index], init)
      options.onEndpointReached?.(endpoints[index])
      return response
    } catch (error) {
      if (isAbort(error, init.signal ?? undefined)) throw error
      const failure = recordFailure(error, endpoints[index], startedAt)
      lastFailure = failure
      const isSafePreconnectFailure = shouldRetry(error, 'safe-preconnect')
      const canRetry = isSafePreconnectFailure || (readOnly && ['ECONNRESET', 'UND_ERR_SOCKET', 'ETIMEDOUT'].includes(failure.code.toUpperCase()))
      if (canRetry && index < endpoints.length - 1) continue

      if (options.retryPreconnectOnce && canRetry) {
        // 保留内部兼容开关名；采用有界退避，每次失败重新核对是否仍可安全重放。
        for (const delay of [1000, 3000, 8000]) {
          await waitForRetry(delay, init.signal ?? undefined)
          const retryStartedAt = Date.now()
          try {
            const response = await options.transport.fetch(endpoints[index], init)
            options.onEndpointReached?.(endpoints[index])
            return response
          } catch (retryError) {
            if (isAbort(retryError, init.signal ?? undefined)) throw retryError
            lastFailure = recordFailure(retryError, endpoints[index], retryStartedAt)
            const safe = shouldRetry(retryError, 'safe-preconnect')
              || (readOnly && ['ECONNRESET', 'UND_ERR_SOCKET', 'ETIMEDOUT'].includes(lastFailure.code.toUpperCase()))
            if (!safe) break
          }
        }
      }
      break
    }
  }

  const failure = lastFailure ?? { code: 'UNKNOWN_NETWORK_ERROR', message: 'Unknown network failure' }
  throw new AiRuntimeError(
    'provider_network_error',
    `${provider} 网络连接失败（${failure.code}），${!readOnly && attempts.at(-1)?.stage === 'unknown' ? '提交结果尚不确定，请先核对任务状态，勿重复提交' : '请检查网络后重试'}`,
    { provider, method, attempts, submissionState: readOnly ? 'read_only' : attempts.at(-1)?.stage === 'before_send' ? 'not_sent' : 'unknown' }
  )
}

/** 取消立即清理计时器与监听器，不等退避结束。 */
function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(finish, ms)
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason ?? new Error('Request aborted')) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}