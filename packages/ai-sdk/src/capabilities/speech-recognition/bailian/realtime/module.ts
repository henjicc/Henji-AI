import type { RealtimeConnection } from '../../../../runtime/RealtimeTransport'
import { AiRuntimeError, cancelledError } from '../../../../runtime/AiRuntimeError'
import type { CapabilityExecutionContext } from '../../../types'
import type {
  SpeechRecognitionAudioChunk,
  SpeechRecognitionEvent,
  SpeechRecognitionOutput,
  SpeechRecognitionRealtimeModule,
  SpeechRecognitionRealtimeStart,
  SpeechRecognitionSegment,
} from '../..'
import type { BailianRealtimeAsrPreset } from './presets'
import {
  buildFunFinish,
  buildFunStart,
  buildQwenAudio,
  buildQwenUpdate,
  parseRealtimeMessage,
  qwenUsesManualCommit,
  validateRealtimeStart,
  type BailianRealtimeEvent,
} from './protocol'
import type { BailianRealtimeModuleOptions } from './types'

type Context = CapabilityExecutionContext<SpeechRecognitionEvent>
type Phase = 'opening' | 'active' | 'finishing' | 'finished' | 'closed' | 'failed'

const DEFAULT_FUN_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
const DEFAULT_QWEN_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve = (_value: T): void => undefined
  let reject = (_error: unknown): void => undefined
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}

function endpoint(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() || fallback
  let parsed: URL
  try { parsed = new URL(normalized) } catch {
    throw new AiRuntimeError('invalid_endpoint', 'Bailian realtime endpoint is invalid')
  }
  if (parsed.protocol !== 'wss:') {
    throw new AiRuntimeError('invalid_endpoint', 'Bailian realtime endpoint must use WSS')
  }
  return parsed.toString()
}

function uuidFromRequestId(requestId: string): string {
  let state = 0x811c9dc5
  const bytes = new Uint8Array(16)
  for (let index = 0; index < bytes.length; index += 1) {
    for (const character of requestId) {
      state ^= character.charCodeAt(0) + index
      state = Math.imul(state, 0x01000193)
    }
    bytes[index] = state >>> ((index % 4) * 8)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

let taskSequence = 0

function appendFinal(
  segments: SpeechRecognitionSegment[],
  candidate: SpeechRecognitionSegment
): void {
  const previous = segments.at(-1)
  if (previous
    && previous.startMs === candidate.startMs
    && (previous.text === candidate.text
      || previous.text.startsWith(candidate.text)
      || candidate.text.startsWith(previous.text))) {
    if (candidate.text.length >= previous.text.length) segments[segments.length - 1] = candidate
    return
  }
  segments.push(candidate)
}

async function apiKey(context: Context): Promise<string> {
  const value = (await context.runtime.credentials.get('speech-recognition', 'bailian'))?.trim()
  if (!value) throw new AiRuntimeError('api_key_missing', 'Bailian speech-recognition API key is not configured')
  return value
}

/** 创建百炼实时 ASR；Fun Duplex 与 Qwen Realtime 使用完全独立的消息序列。 */
export function createBailianRealtimeAsrModule(
  preset: BailianRealtimeAsrPreset,
  options: BailianRealtimeModuleOptions = {}
): SpeechRecognitionRealtimeModule {
  const funUrl = endpoint(options.funWebSocketUrl, DEFAULT_FUN_URL)
  const qwenUrl = endpoint(options.qwenWebSocketUrl, DEFAULT_QWEN_URL)
  return {
    descriptor: preset.descriptor,
    open: async (input, context) => {
      validateRealtimeStart(preset, input)
      if (context.signal.aborted) throw cancelledError(context.requestId)
      const credential = await apiKey(context)
      const transport = context.runtime.realtime
      if (!transport) throw new AiRuntimeError('realtime_transport_missing', 'Host did not provide realtime transport')
      const taskId = preset.protocol === 'fun-duplex'
        ? options.taskIdFactory
          ? options.taskIdFactory(context.requestId).trim()
          : uuidFromRequestId(`${context.requestId}:${Date.now()}:${taskSequence++}`)
        : ''
      if (preset.protocol === 'fun-duplex'
        && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
        throw new AiRuntimeError('invalid_task_id', 'Bailian Fun-ASR task_id must be a UUID')
      }
      const target = preset.protocol === 'fun-duplex'
        ? funUrl
        : `${qwenUrl}${qwenUrl.includes('?') ? '&' : '?'}model=${encodeURIComponent(preset.modelId)}`
      const connection = await transport.connect(target, {
        headers: {
          Authorization: `Bearer ${credential}`,
          ...(preset.protocol === 'qwen-realtime' ? { 'OpenAI-Beta': 'realtime=v1' } : {}),
        },
        signal: context.signal,
      })
      return await openDriver(preset, input, taskId, connection, context)
    },
  }
}

async function openDriver(
  preset: BailianRealtimeAsrPreset,
  input: SpeechRecognitionRealtimeStart,
  taskId: string,
  connection: RealtimeConnection,
  context: Context
): Promise<ReturnType<SpeechRecognitionRealtimeModule['open']> extends Promise<infer T> ? T : never> {
  let phase: Phase = 'opening'
  let closePromise: Promise<void> | undefined
  let finishPromise: Promise<SpeechRecognitionOutput> | undefined
  let sessionId: string | undefined
  let lastPartial = ''
  let durationMs: number | undefined
  let terminalError: AiRuntimeError | undefined
  const segments: SpeechRecognitionSegment[] = []
  const created = deferred<void>()
  const ready = deferred<void>()
  const finished = deferred<SpeechRecognitionOutput>()

  const closeConnection = (): Promise<void> => {
    closePromise ??= Promise.resolve().then(async () => await connection.close(1000, 'session complete'))
    return closePromise
  }

  const fail = (error: unknown): void => {
    if (phase === 'finished' || phase === 'closed' || phase === 'failed') return
    phase = 'failed'
    const normalized = error instanceof AiRuntimeError
      ? error
      : new AiRuntimeError('provider_realtime_error', error instanceof Error ? error.message : 'Bailian realtime failed')
    terminalError = normalized
    created.reject(normalized)
    ready.reject(normalized)
    finished.reject(normalized)
    void closeConnection().catch(() => undefined)
  }

  const complete = async (): Promise<void> => {
    if (phase !== 'finishing') {
      fail(new AiRuntimeError('protocol_event_out_of_order', 'Bailian realtime finished before client finish'))
      return
    }
    const text = segments.map((segment) => segment.text).join('').trim()
    if (!text) {
      fail(new AiRuntimeError('invalid_response', 'Bailian realtime session finished without final transcript'))
      return
    }
    const output: SpeechRecognitionOutput = {
      text, durationMs, segments,
      providerMetadata: { protocol: preset.protocol, sessionId },
    }
    await context.emit({ type: 'completed', output })
    phase = 'finished'
    finished.resolve(output)
    await closeConnection()
  }

  const handle = async (event: BailianRealtimeEvent): Promise<void> => {
    if (event.kind === 'created') {
      if (preset.protocol !== 'qwen-realtime' || phase !== 'opening') {
        throw new AiRuntimeError('protocol_event_out_of_order', 'Unexpected Bailian realtime created event')
      }
      sessionId = event.sessionId
      created.resolve()
      return
    }
    if (event.kind === 'ready') {
      if (phase !== 'opening') {
        if (phase === 'active') return
        throw new AiRuntimeError('protocol_event_out_of_order', 'Unexpected Bailian realtime ready event')
      }
      sessionId = event.sessionId ?? sessionId ?? (preset.protocol === 'fun-duplex' ? taskId : undefined)
      phase = 'active'
      await context.emit({ type: 'started', sessionId })
      ready.resolve()
      return
    }
    if (event.kind === 'partial' || event.kind === 'final') {
      if (phase !== 'active' && phase !== 'finishing') {
        throw new AiRuntimeError('protocol_event_out_of_order', 'Transcript arrived before Bailian realtime session was ready')
      }
      if (event.kind === 'partial') {
        if (event.text !== lastPartial) {
          lastPartial = event.text
          await context.emit({ type: 'partial', text: event.text, segment: event.segment })
        }
        return
      }
      lastPartial = ''
      if (event.durationMs !== undefined) durationMs = Math.max(durationMs ?? 0, event.durationMs)
      const segment = event.segment ?? { text: event.text }
      const before = segments.length
      appendFinal(segments, segment)
      if (segments.length !== before || segments.at(-1) === segment) {
        await context.emit({ type: 'final', text: segment.text, segment })
      }
      return
    }
    if (event.kind === 'finished') {
      if (event.durationMs !== undefined) durationMs = Math.max(durationMs ?? 0, event.durationMs)
      await complete()
      return
    }
    if (event.kind === 'error') {
      throw new AiRuntimeError('provider_task_failed', `${event.code ? `${event.code}: ` : ''}${event.message}`)
    }
    context.runtime.logger.warn('忽略百炼实时未知事件', {
      event: 'capability.bailian_realtime.unknown_event', requestId: context.requestId,
      providerId: 'bailian', modelId: preset.modelId, context: { eventType: event.eventType },
    })
  }

  const consume = async (): Promise<void> => {
    try {
      for await (const message of connection.messages) {
        if (context.signal.aborted) throw cancelledError(context.requestId)
        if (typeof message.data !== 'string') {
          context.runtime.logger.warn('忽略百炼实时二进制服务端事件', {
            event: 'capability.bailian_realtime.binary_event', requestId: context.requestId,
            providerId: 'bailian', modelId: preset.modelId,
          })
          continue
        }
        await handle(parseRealtimeMessage(preset, message.data))
      }
      if (phase !== 'finished' && phase !== 'closed' && phase !== 'failed') {
        fail(new AiRuntimeError('provider_connection_closed', 'Bailian realtime connection closed before completion'))
      }
    } catch (error) {
      fail(context.signal.aborted ? cancelledError(context.requestId) : error)
    }
  }
  void consume()

  const onAbort = (): void => fail(cancelledError(context.requestId))
  context.signal.addEventListener('abort', onAbort, { once: true })
  try {
    if (preset.protocol === 'fun-duplex') {
      await connection.send(buildFunStart(preset, input, taskId))
    } else {
      await created.promise
      await connection.send(buildQwenUpdate(input))
    }
    await ready.promise
  } catch (error) {
    fail(error)
    await closeConnection()
    throw error
  }

  return {
    send: async (chunk: SpeechRecognitionAudioChunk) => {
      if (terminalError) throw terminalError
      if (phase !== 'active') throw new AiRuntimeError('realtime_session_inactive', 'Bailian realtime session is not active')
      if (chunk.bytes.byteLength === 0) return
      await connection.send(preset.protocol === 'fun-duplex' ? chunk.bytes : buildQwenAudio(chunk.bytes))
    },
    finish: () => {
      if (finishPromise) return finishPromise
      if (terminalError) return Promise.reject(terminalError)
      if (phase !== 'active') {
        return Promise.reject(new AiRuntimeError('realtime_session_inactive', 'Bailian realtime session cannot finish'))
      }
      phase = 'finishing'
      finishPromise = (async (): Promise<SpeechRecognitionOutput> => {
        if (preset.protocol === 'fun-duplex') {
          await connection.send(buildFunFinish(taskId))
        } else {
          if (qwenUsesManualCommit(input)) {
            await connection.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
          }
          await connection.send(JSON.stringify({ type: 'session.finish' }))
        }
        return await finished.promise
      })()
      return finishPromise
    },
    close: async () => {
      context.signal.removeEventListener('abort', onAbort)
      if (phase !== 'finished' && phase !== 'failed' && phase !== 'closed') {
        phase = 'closed'
        const error = new AiRuntimeError('realtime_session_closed', 'Bailian realtime session was closed')
        created.reject(error)
        ready.reject(error)
        finished.reject(error)
      }
      await closeConnection()
    },
  }
}
