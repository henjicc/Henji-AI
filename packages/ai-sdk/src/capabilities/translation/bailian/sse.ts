import { createUtf8StreamDecoder } from '../../../protocols/utf8-stream-decoder'
import { drainSseEvents } from '../../../protocols/sse-events'
import { AiRuntimeError } from '../../../runtime/AiRuntimeError'
import type { TranslationUsage } from '../index'
import type { BailianQwenMtStreamingContent } from './types'

interface QwenMtStreamResult {
  text: string
  usage?: TranslationUsage
  requestId?: string
  responseModel?: string
  finishReason?: string
}

interface QwenMtStreamCallbacks {
  onDelta(delta: {
    mode: 'append' | 'replace'
    text: string
    accumulatedText: string
  }): Promise<void>
  onUsage(usage: TranslationUsage): Promise<void>
}

export async function readQwenMtSse(
  body: ReadableStream<Uint8Array>,
  streamingContent: BailianQwenMtStreamingContent,
  signal: AbortSignal,
  callbacks: QwenMtStreamCallbacks,
  modelId: string
): Promise<QwenMtStreamResult> {
  const reader = body.getReader()
  const decoder = createUtf8StreamDecoder()
  let pending = ''
  let text = ''
  let usage: TranslationUsage | undefined
  let requestId: string | undefined
  let responseModel: string | undefined
  let finishReason: string | undefined
  let ended = false
  let eof = false
  let stage = 'read'
  let cancellation: Promise<void> | undefined
  const failure = (code: string, reason: string, details?: Record<string, unknown>): AiRuntimeError =>
    new AiRuntimeError(code, `Bailian ${modelId}: ${reason}`, {
      providerId: 'bailian', modelId, protocol: 'qwen-mt-sse', stage,
      receivedFinish: finishReason !== undefined, ...details,
    })
  const checkAbort = (): void => {
    if (signal.aborted) throw failure('cancelled', 'Translation stream cancelled')
  }

  // A host cleanup rejection must not replace the original failure or escape
  // as an unhandled rejection; never wait indefinitely for host cancellation.
  const cancelReader = (): void => { cancellation ??= reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancelReader, { once: true })

  const consume = async (event: string): Promise<void> => {
    const lines = event.split(/\r\n|\r|\n/)
    const eventName = lines.filter(line => line.startsWith('event:')).at(-1)?.slice(6).trim()
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (eventName === 'error') throw failure('provider_task_failed', 'Server sent an error event')
    // SSE extension notifications are not translation results or completion evidence.
    if (eventName && eventName !== 'message') return
    if (!data || data === '[DONE]') {
      if (data === '[DONE]') ended = true
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      throw failure('provider_response_invalid', 'SSE contains invalid JSON')
    }
    if (!isRecord(payload)) {
      throw failure('provider_response_invalid', 'SSE payload is not an object')
    }
    if (payload.error != null || payload.code != null) {
      const error = isRecord(payload.error) ? payload.error : undefined
      const code = error?.code ?? payload.code
      const providerCode = typeof code === 'string' && /^[\w.-]{1,128}$/.test(code) ? code : undefined
      throw failure('provider_task_failed', 'Server rejected translation', { providerCode })
    }
    if (!Array.isArray(payload.choices)) {
      throw failure('provider_response_invalid', 'SSE payload is missing choices')
    }
    requestId = readNonEmptyString(payload.id) ?? requestId
    responseModel = readNonEmptyString(payload.model) ?? responseModel
    const nextUsage = readUsage(payload.usage)
    if (payload.choices.length === 0 && !nextUsage) {
      throw failure('provider_response_invalid', 'Empty choices requires usage')
    }
    if (nextUsage) {
      usage = nextUsage
      stage = 'callback'
      await callbacks.onUsage(nextUsage)
      checkAbort()
      stage = 'parse'
    }
    if (payload.choices.length === 0) return
    const choice: unknown = payload.choices[0]
    if (!isRecord(choice) || !isRecord(choice.delta) || typeof choice.delta.content !== 'string') {
      throw failure('provider_response_invalid', 'SSE choice requires delta.content')
    }
    const nextFinish = choice.finish_reason
    if (nextFinish !== null && nextFinish !== 'stop' && nextFinish !== 'length') {
      throw failure('provider_response_invalid', 'SSE choice has invalid finish_reason')
    }
    if (nextFinish === 'length') {
      throw failure('provider_task_failed', 'Translation was truncated by the output limit', { finishReason: 'length' })
    }
    const delta = choice.delta.content
    if (finishReason && (nextFinish !== finishReason || (streamingContent === 'incremental' ? delta !== '' : delta !== text))) {
      throw failure('provider_response_invalid', 'Translation changed after finish_reason')
    }
    finishReason = nextFinish ?? finishReason
    if (delta.length === 0) return

    stage = 'callback'
    if (streamingContent === 'incremental') {
      text += delta
      await callbacks.onDelta({ mode: 'append', text: delta, accumulatedText: text })
      return
    }
    if (delta === text) return
    if (delta.startsWith(text)) {
      const append = delta.slice(text.length)
      text = delta
      if (append) await callbacks.onDelta({ mode: 'append', text: append, accumulatedText: text })
      return
    }
    text = delta
    await callbacks.onDelta({ mode: 'replace', text, accumulatedText: text })
  }

  try {
    checkAbort()
    while (!ended) {
      stage = 'read'
      const result = await reader.read()
      checkAbort()
      if (result.done) { eof = true; break }
      pending += decoder.decode(result.value, { stream: true })
      const drained = drainSseEvents(pending)
      pending = drained.remaining
      for (const event of drained.events) {
        checkAbort()
        stage = 'parse'
        await consume(event)
        if (ended) break
      }
    }
    stage = 'completion'
    checkAbort()
    if (!finishReason) throw failure('provider_response_invalid', 'Translation stream ended without finish_reason')
  } catch (error) {
    if (error instanceof AiRuntimeError && error.details?.protocol === 'qwen-mt-sse') throw error
    throw failure(stage === 'callback' ? 'capability_execution_failed' : 'provider_response_invalid',
      stage === 'callback' ? 'Translation event callback failed' : 'Translation stream read failed')
  } finally {
    signal.removeEventListener('abort', cancelReader)
    if (!eof) cancelReader()
    reader.releaseLock()
  }

  return { text, usage, requestId, responseModel, finishReason }
}

function readUsage(value: unknown): TranslationUsage | undefined {
  if (!isRecord(value)) return undefined
  const inputTokens = readTokenCount(value.prompt_tokens ?? value.input_tokens)
  const outputTokens = readTokenCount(value.completion_tokens ?? value.output_tokens)
  const totalTokens = readTokenCount(value.total_tokens)
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined
  return { inputTokens, outputTokens, totalTokens }
}

function readTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
