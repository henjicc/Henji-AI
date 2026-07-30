import type { ModelStepEvent, ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import { normalizeProviderError, type ProviderModelStepError } from './provider-error'

interface ModelStepRetryOptions {
  input: ModelStepInput
  signal: AbortSignal
  emit: (event: ModelStepEvent) => void
  operation: (emit: (event: ModelStepEvent) => void) => Promise<ModelStepResult>
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
  random?: () => number
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
  const base = Math.min(10_000, 300 * (2 ** (attempt - 1)))
  return Math.round(base * (0.8 + random() * 0.4))
}

export async function executeModelStepWithRetry(
  options: ModelStepRetryOptions
): Promise<ModelStepResult> {
  const maxRetries = options.input.settings?.maxRetries ?? 0
  const sleep = options.sleep ?? abortableSleep
  const random = options.random ?? Math.random
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    let emittedOutput = false
    try {
      return await options.operation((event) => {
        if (event.type !== 'Retrying') emittedOutput = true
        options.emit(event)
      })
    } catch (error) {
      const structured = normalizeProviderError(options.input, error)
      if (!structured.details.retryable || emittedOutput || attempt > maxRetries) throw structured
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
