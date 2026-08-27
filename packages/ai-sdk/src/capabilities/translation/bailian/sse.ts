import { createUtf8StreamDecoder } from '../../../protocols/utf8-stream-decoder'
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
  callbacks: QwenMtStreamCallbacks
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

  const cancelReader = (): void => { void reader.cancel() }
  if (signal.aborted) cancelReader()
  else signal.addEventListener('abort', cancelReader, { once: true })

  const consume = async (event: string): Promise<void> => {
    const data = event
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (!data || data === '[DONE]') {
      if (data === '[DONE]') ended = true
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      throw new AiRuntimeError('provider_response_invalid', 'Bailian Qwen-MT SSE contains invalid JSON')
    }
    if (!isRecord(payload)) {
      throw new AiRuntimeError('provider_response_invalid', 'Bailian Qwen-MT SSE payload is not an object')
    }
    throwPayloadError(payload)
    requestId = readNonEmptyString(payload.id) ?? requestId
    responseModel = readNonEmptyString(payload.model) ?? responseModel
    const nextUsage = readUsage(payload.usage)
    if (nextUsage) {
      usage = nextUsage
      await callbacks.onUsage(nextUsage)
    }
    const choice = Array.isArray(payload.choices) && isRecord(payload.choices[0])
      ? payload.choices[0]
      : undefined
    finishReason = readNonEmptyString(choice?.finish_reason) ?? finishReason
    const delta = isRecord(choice?.delta) ? readString(choice.delta.content) : undefined
    if (delta === undefined || delta.length === 0) return

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
    while (!ended) {
      const result = await reader.read()
      if (result.done) break
      pending += decoder.decode(result.value, { stream: true })
      const drained = drainEvents(pending)
      pending = drained.remaining
      for (const event of drained.events) {
        await consume(event)
        if (ended) break
      }
    }
    pending += decoder.decode()
    const drained = drainEvents(`${pending}\n\n`)
    for (const event of drained.events) await consume(event)
  } finally {
    signal.removeEventListener('abort', cancelReader)
    reader.releaseLock()
  }

  return { text, usage, requestId, responseModel, finishReason }
}

function drainEvents(input: string): { events: string[]; remaining: string } {
  const events: string[] = []
  let remaining = input
  let hasSeparator = true
  while (hasSeparator) {
    const crlf = remaining.indexOf('\r\n\r\n')
    const lf = remaining.indexOf('\n\n')
    if (crlf === -1 && lf === -1) {
      hasSeparator = false
      continue
    }
    const useCrlf = crlf !== -1 && (lf === -1 || crlf < lf)
    const index = useCrlf ? crlf : lf
    const length = useCrlf ? 4 : 2
    events.push(remaining.slice(0, index))
    remaining = remaining.slice(index + length)
  }
  return { events, remaining }
}

function readUsage(value: unknown): TranslationUsage | undefined {
  if (!isRecord(value)) return undefined
  const inputTokens = readTokenCount(value.prompt_tokens ?? value.input_tokens)
  const outputTokens = readTokenCount(value.completion_tokens ?? value.output_tokens)
  const totalTokens = readTokenCount(value.total_tokens)
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined
  return { inputTokens, outputTokens, totalTokens }
}

function throwPayloadError(payload: Record<string, unknown>): void {
  const error = isRecord(payload.error) ? payload.error : undefined
  const code = readNonEmptyString(error?.code) ?? readNonEmptyString(payload.code)
  if (!code) return
  const message = readNonEmptyString(error?.message) ?? readNonEmptyString(payload.message) ?? code
  throw new AiRuntimeError('provider_task_failed', `Bailian Qwen-MT ${code}: ${message}`)
}

function readTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
