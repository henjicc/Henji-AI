import { AiRuntimeError } from '../runtime/errors'
import { describeNetworkFailure, shouldRetry, type NetworkFailure } from '../runtime/error-classify'
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

  for (let index = 0; index < endpoints.length; index += 1) {
    try {
      const response = await options.transport.fetch(endpoints[index], init)
      options.onEndpointReached?.(endpoints[index])
      return response
    } catch (error) {
      if (isAbort(error, init.signal ?? undefined)) throw error
      const failure = describeNetworkFailure(error)
      lastFailure = failure
      const isSafePreconnectFailure = shouldRetry(error, 'safe-preconnect')
      if (isSafePreconnectFailure && index < endpoints.length - 1) continue

      if (options.retryPreconnectOnce && isSafePreconnectFailure) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250))
        try {
          const response = await options.transport.fetch(endpoints[index], init)
          options.onEndpointReached?.(endpoints[index])
          return response
        } catch (retryError) {
          if (isAbort(retryError, init.signal ?? undefined)) throw retryError
          lastFailure = describeNetworkFailure(retryError)
        }
      }
      break
    }
  }

  const failure = lastFailure ?? { code: 'UNKNOWN_NETWORK_ERROR', message: 'Unknown network failure' }
  throw new AiRuntimeError(
    'provider_network_error',
    `${provider} 网络连接失败（${failure.code}），请检查网络后重试`
  )
}
