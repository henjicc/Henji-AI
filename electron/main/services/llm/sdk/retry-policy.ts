import type { ModelStepEvent, ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import { normalizeProviderError, type ProviderModelStepError } from './provider-error'

interface ModelStepRetryOptions {
  input: ModelStepInput
  signal: AbortSignal
  emit: (event: ModelStepEvent) => void
  operation: (emit: (event: ModelStepEvent) => void) => Promise<ModelStepResult>
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
  random?: () => number
  now?: () => number
}

function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function retryDelay(error: ProviderModelStepError, attempt: number, random: () => number): number {
  if (error.details.retryAfterMs !== null) return Math.min(60_000, error.details.retryAfterMs)
  void random
  return Math.min(8_000, 2_000 * (2 ** (attempt - 1)))
}

export async function executeModelStepWithRetry(
  options: ModelStepRetryOptions
): Promise<ModelStepResult> {
  const maxRetries = options.input.settings?.maxRetries ?? 0
  const sleep = options.sleep ?? abortableSleep
  const random = options.random ?? Math.random
  const now = options.now ?? Date.now
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const attemptStartedAt = now()
    try {
      return await options.operation((event) => {
        options.emit(event)
      })
    } catch (error) {
      const timeoutMs = options.input.settings?.timeoutMs
      const reachedRequestDeadline = timeoutMs !== undefined
        && now() - attemptStartedAt >= Math.max(0, timeoutMs - 100)
      const failure = reachedRequestDeadline
        ? Object.assign(new Error(`Model request timed out after ${timeoutMs}ms`, { cause: error }), {
            name: 'TimeoutError',
            code: 'MODEL_REQUEST_TIMEOUT',
            isRetryable: true,
          })
        : error
      const structured = normalizeProviderError(options.input, failure)
      // A rejected model step has not produced a ModelStepResult, so the runner has not
      // executed any tool call or committed assistant output. Partial stream deltas are
      // presentation-only and do not make replaying this request unsafe.
      if (!structured.details.retryable || attempt > maxRetries) throw structured
      const delayMs = retryDelay(structured, attempt, random)
      options.emit({
        type: 'Retrying',
        layer: 'request',
        attempt,
        delayMs,
        category: structured.details.category,
        code: structured.details.code,
      })
      await sleep(delayMs, options.signal)
    }
  }
  throw new Error('[MODEL_RETRY_EXHAUSTED] 模型请求重试次数已耗尽')
}
