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
  SpeechRecognitionWord,
} from '../..'
import { volcengineRequestId } from '../request-id'
import type { VolcengineRealtimeAsrPreset } from './presets'
import {
  encodeVolcengineAudioRequest,
  encodeVolcengineFullRequest,
  parseVolcengineServerFrame,
  type VolcengineResponseFrame,
} from './protocol'
import type { VolcengineRealtimeAsrOptions, VolcengineRealtimeModuleOptions } from './types'

type Context = CapabilityExecutionContext<SpeechRecognitionEvent>
type Phase = 'opening' | 'active' | 'finishing' | 'finished' | 'closed' | 'failed'

const DEFAULT_WS_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
const RESOURCE_ID = 'volc.seedasr.sauc.duration'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

interface ParsedPayload {
  text: string
  durationMs?: number
  utterances: Array<SpeechRecognitionSegment & { definite: boolean }>
  logId?: string
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

function endpoint(value: string | undefined): string {
  const normalized = value?.trim() || DEFAULT_WS_URL
  let parsed: URL
  try { parsed = new URL(normalized) } catch {
    throw new AiRuntimeError('invalid_endpoint', 'Volcengine realtime ASR endpoint is invalid')
  }
  if (parsed.protocol !== 'wss:') {
    throw new AiRuntimeError('invalid_endpoint', 'Volcengine realtime ASR endpoint must use WSS')
  }
  return parsed.toString()
}

function providerOptions(input: SpeechRecognitionRealtimeStart): VolcengineRealtimeAsrOptions {
  const raw = input.options
  if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw))) {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine realtime ASR options must be an object')
  }
  const provider = (raw ?? {}) as Record<string, unknown>
  for (const key of ['enableItn', 'enableDdc', 'showUtterances'] as const) {
    if (provider[key] !== undefined && typeof provider[key] !== 'boolean') {
      throw new AiRuntimeError('invalid_parameter', `Volcengine realtime ASR options.${key} must be boolean`)
    }
  }
  return provider as VolcengineRealtimeAsrOptions
}

function validateStart(input: SpeechRecognitionRealtimeStart): void {
  if (typeof input.mediaType !== 'string') {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine realtime mediaType must be a string')
  }
  if (input.channels !== undefined && input.channels !== 1) {
    throw new AiRuntimeError('unsupported_audio_channels', 'Volcengine realtime P0 requires mono audio')
  }
  if (input.sampleRateHz !== undefined && input.sampleRateHz !== 16_000) {
    throw new AiRuntimeError('unsupported_sample_rate', 'Volcengine realtime P0 requires 16000 Hz audio')
  }
  if (input.mediaType.trim().toLowerCase().split(';', 1)[0] !== 'audio/pcm') {
    throw new AiRuntimeError('unsupported_audio_format', 'Volcengine realtime P0 requires PCM S16LE audio')
  }
  if (input.language !== undefined && typeof input.language !== 'string') {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine realtime language must be a string')
  }
  if (input.language?.trim()) {
    throw new AiRuntimeError(
      'unsupported_parameter',
      'Volcengine SeedASR 2.0 bigmodel_async P0 does not support a language parameter'
    )
  }
  if (input.hints !== undefined && (!Array.isArray(input.hints)
    || input.hints.some((hint) => typeof hint !== 'string'))) {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine realtime hints must be strings')
  }
  if (input.hints?.some((hint) => hint.trim())) {
    throw new AiRuntimeError('unsupported_parameter', 'Volcengine realtime P0 does not support hints')
  }
  if (input.punctuation !== undefined && typeof input.punctuation !== 'boolean') {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine realtime punctuation must be boolean')
  }
  providerOptions(input)
}

async function apiKey(context: Context): Promise<string> {
  const value = (await context.runtime.credentials.get('speech-recognition', 'volcengine'))?.trim()
  if (!value) {
    throw new AiRuntimeError('api_key_missing', 'Volcengine speech-recognition API key is not configured')
  }
  return value
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function parseWords(value: unknown): readonly SpeechRecognitionWord[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new AiRuntimeError('invalid_response', 'Volcengine realtime utterance words must be an array')
  }
  const parsed = value.flatMap((entry): SpeechRecognitionWord[] => {
    const item = record(entry)
    if (!item) return []
    const text = item.text
    if (typeof text !== 'string' || !text.trim()) return []
    return [{
      text,
      startMs: finiteNumber(item.start_time),
      endMs: finiteNumber(item.end_time),
    }]
  })
  return parsed.length ? parsed : undefined
}

function parsePayload(payload: unknown): ParsedPayload {
  const root = record(payload)
  const result = record(root?.result)
  if (!root || !result) {
    throw new AiRuntimeError('invalid_response', 'Volcengine realtime response has no result object')
  }
  const text = result.text
  if (typeof text !== 'string') {
    throw new AiRuntimeError('invalid_response', 'Volcengine realtime response result.text must be a string')
  }
  const rawUtterances = result.utterances
  if (rawUtterances !== undefined && !Array.isArray(rawUtterances)) {
    throw new AiRuntimeError('invalid_response', 'Volcengine realtime result.utterances must be an array')
  }
  const utterances = (rawUtterances ?? []).flatMap((entry): ParsedPayload['utterances'] => {
    const item = record(entry)
    if (!item) return []
    const utteranceText = item.text
    if (typeof utteranceText !== 'string' || !utteranceText.trim()) return []
    return [{
      text: utteranceText,
      startMs: finiteNumber(item.start_time),
      endMs: finiteNumber(item.end_time),
      words: parseWords(item.words),
      definite: item.definite === true,
    }]
  })
  const additions = record(result.additions)
  const logId = typeof additions?.log_id === 'string' && additions.log_id.trim()
    ? additions.log_id.trim()
    : undefined
  return {
    text,
    durationMs: finiteNumber(record(root.audio_info)?.duration),
    utterances,
    logId,
  }
}

function lastIndefinite(
  utterances: ParsedPayload['utterances']
): (SpeechRecognitionSegment & { definite: boolean }) | undefined {
  for (let index = utterances.length - 1; index >= 0; index -= 1) {
    if (!utterances[index].definite) return utterances[index]
  }
  return undefined
}

function upsertFinal(segments: SpeechRecognitionSegment[], candidate: SpeechRecognitionSegment): boolean {
  const index = segments.findIndex((segment) => (
    segment.startMs === candidate.startMs
    && segment.endMs === candidate.endMs
    && (segment.startMs !== undefined || segment.text === candidate.text)
  ))
  if (index < 0) {
    segments.push(candidate)
    return true
  }
  const previous = segments[index]
  if (previous.text === candidate.text
    && (previous.words?.length ?? 0) >= (candidate.words?.length ?? 0)) return false
  segments[index] = candidate
  return true
}

function startPayload(
  input: SpeechRecognitionRealtimeStart,
  requestId: string
): Record<string, unknown> {
  const provider = providerOptions(input)
  return {
    user: { uid: requestId },
    audio: { format: 'pcm', codec: 'raw', rate: 16_000, bits: 16, channel: 1 },
    request: {
      model_name: 'bigmodel',
      enable_itn: provider.enableItn ?? true,
      enable_punc: input.punctuation ?? true,
      enable_ddc: provider.enableDdc ?? false,
      show_utterances: provider.showUtterances ?? true,
      enable_nonstream: false,
      result_type: 'full',
    },
  }
}

/** 创建火山 SeedASR 2.0 双向实时 ASR 二进制 WebSocket 模块。 */
export function createVolcengineRealtimeAsrModule(
  preset: VolcengineRealtimeAsrPreset,
  moduleOptions: VolcengineRealtimeModuleOptions = {}
): SpeechRecognitionRealtimeModule {
  const webSocketUrl = endpoint(moduleOptions.webSocketUrl)
  const openTimeoutMs = moduleOptions.openTimeoutMs ?? 15_000
  if (!Number.isFinite(openTimeoutMs) || openTimeoutMs <= 0) {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine realtime openTimeoutMs must be positive')
  }
  return {
    descriptor: preset.descriptor,
    open: async (input, context) => {
      validateStart(input)
      if (context.signal.aborted) throw cancelledError(context.requestId)
      const credential = await apiKey(context)
      if (context.signal.aborted) throw cancelledError(context.requestId)
      const transport = context.runtime.realtime
      if (!transport) {
        throw new AiRuntimeError('realtime_transport_missing', 'Host did not provide realtime transport')
      }
      const requestId = volcengineRequestId(context.requestId, moduleOptions.requestIdFactory)
      const connection = await transport.connect(webSocketUrl, {
        headers: {
          'X-Api-Key': credential,
          'X-Api-Resource-Id': RESOURCE_ID,
          'X-Api-Request-Id': requestId,
          'X-Api-Sequence': '-1',
        },
        signal: context.signal,
      })
      if (context.signal.aborted) {
        try { await connection.close(1000, 'cancelled') } catch { /* preserve cancellation */ }
        throw cancelledError(context.requestId)
      }
      return await openDriver(preset, input, requestId, connection, context, openTimeoutMs)
    },
  }
}

async function openDriver(
  preset: VolcengineRealtimeAsrPreset,
  input: SpeechRecognitionRealtimeStart,
  requestId: string,
  connection: RealtimeConnection,
  context: Context,
  openTimeoutMs: number
): Promise<ReturnType<SpeechRecognitionRealtimeModule['open']> extends Promise<infer T> ? T : never> {
  let phase: Phase = 'opening'
  let nextSequence = 2
  let pendingAudio: Uint8Array | undefined
  let closePromise: Promise<void> | undefined
  let finishPromise: Promise<SpeechRecognitionOutput> | undefined
  let terminalError: AiRuntimeError | undefined
  let lastPartial = ''
  let durationMs: number | undefined
  let logId: string | undefined
  let sendQueue: Promise<void> = Promise.resolve()
  const segments: SpeechRecognitionSegment[] = []
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
      : new AiRuntimeError(
        'provider_realtime_error',
        error instanceof Error ? error.message : 'Volcengine realtime ASR failed'
      )
    terminalError = normalized
    ready.reject(normalized)
    finished.reject(normalized)
    void closeConnection().catch(() => undefined)
  }

  const complete = async (terminalText: string): Promise<void> => {
    if (phase !== 'finishing') {
      fail(new AiRuntimeError(
        'protocol_event_out_of_order',
        'Volcengine realtime session ended before the client sent its final audio frame'
      ))
      return
    }
    const text = terminalText.trim() || segments.map((segment) => segment.text).join('').trim()
    if (!text) {
      fail(new AiRuntimeError('invalid_response', 'Volcengine realtime session finished without transcript text'))
      return
    }
    const output: SpeechRecognitionOutput = {
      text,
      durationMs,
      segments: segments.length ? segments : undefined,
      providerMetadata: {
        requestId,
        resourceId: RESOURCE_ID,
        ...(logId ? { logId } : {}),
      },
    }
    await context.emit({ type: 'completed', output })
    phase = 'finished'
    finished.resolve(output)
    await closeConnection()
  }

  const handle = async (frame: VolcengineResponseFrame): Promise<void> => {
    if (frame.event !== undefined && frame.event !== 0) {
      context.runtime.logger.warn('忽略火山实时 ASR 未知事件编号', {
        event: 'capability.volcengine_realtime.unknown_event',
        requestId: context.requestId,
        providerId: 'volcengine',
        modelId: preset.modelId,
        context: { eventNumber: frame.event },
      })
    }
    const parsed = parsePayload(frame.payload)
    if (parsed.durationMs !== undefined) durationMs = Math.max(durationMs ?? 0, parsed.durationMs)
    if (parsed.logId) logId = parsed.logId
    if (phase === 'opening') {
      if (frame.last) {
        throw new AiRuntimeError('protocol_event_out_of_order', 'Volcengine realtime ended during handshake')
      }
      phase = 'active'
      await context.emit({ type: 'started', sessionId: requestId })
      ready.resolve()
    } else if (phase !== 'active' && phase !== 'finishing') {
      throw new AiRuntimeError('protocol_event_out_of_order', 'Volcengine transcript arrived for an inactive session')
    }
    if (parsed.text.trim()) {
      if (!frame.last && parsed.text !== lastPartial) {
        lastPartial = parsed.text
        const candidate = lastIndefinite(parsed.utterances)
        const partial = candidate
          ? (({ definite: _definite, ...segment }) => segment)(candidate)
          : undefined
        await context.emit({ type: 'partial', text: parsed.text, segment: partial })
      }
    }
    for (const utterance of parsed.utterances) {
      if (!utterance.definite) continue
      const { definite: _definite, ...segment } = utterance
      if (upsertFinal(segments, segment)) {
        await context.emit({ type: 'final', text: segment.text, segment })
      }
    }
    if (frame.last) await complete(parsed.text)
  }

  const consume = async (): Promise<void> => {
    try {
      for await (const message of connection.messages) {
        if (context.signal.aborted) throw cancelledError(context.requestId)
        if (typeof message.data === 'string') {
          throw new AiRuntimeError('invalid_response', 'Volcengine realtime server returned a text WebSocket frame')
        }
        const frame = parseVolcengineServerFrame(message.data)
        if (frame.kind === 'error') {
          throw new AiRuntimeError('provider_task_failed', `${frame.code}: ${frame.message}`)
        }
        await handle(frame)
      }
      if (phase !== 'finished' && phase !== 'closed' && phase !== 'failed') {
        fail(new AiRuntimeError(
          'provider_connection_closed',
          'Volcengine realtime connection closed before a terminal response'
        ))
      }
    } catch (error) {
      fail(context.signal.aborted ? cancelledError(context.requestId) : error)
    }
  }
  void consume()

  const onAbort = (): void => fail(cancelledError(context.requestId))
  context.signal.addEventListener('abort', onAbort, { once: true })
  let openTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      openTimer = setTimeout(() => {
        reject(new AiRuntimeError(
          'timeout',
          `Volcengine realtime full request response timed out after ${openTimeoutMs} ms`
        ))
      }, openTimeoutMs)
    })
    await Promise.race([
      Promise.all([
        connection.send(encodeVolcengineFullRequest(startPayload(input, requestId), 1)),
        ready.promise,
      ]),
      deadline,
    ])
  } catch (error) {
    fail(error)
    await closeConnection()
    throw terminalError ?? error
  } finally {
    if (openTimer !== undefined) clearTimeout(openTimer)
  }

  return {
    send: (chunk: SpeechRecognitionAudioChunk) => {
      if (terminalError) return Promise.reject(terminalError)
      if (phase !== 'active') {
        return Promise.reject(new AiRuntimeError(
          'realtime_session_inactive',
          'Volcengine realtime session is not active'
        ))
      }
      if (chunk.bytes.byteLength === 0) return Promise.resolve()
      if (chunk.bytes.byteLength % 2 !== 0) {
        return Promise.reject(new AiRuntimeError(
          'invalid_audio_chunk',
          'Volcengine PCM S16LE audio chunks must contain an even number of bytes'
        ))
      }
      const copy = new Uint8Array(chunk.bytes.byteLength)
      copy.set(chunk.bytes)
      const operation = sendQueue.then(async () => {
        if (terminalError) throw terminalError
        if (pendingAudio) {
          await connection.send(encodeVolcengineAudioRequest(pendingAudio, nextSequence, false))
          nextSequence += 1
        }
        pendingAudio = copy
      })
      sendQueue = operation.catch(() => undefined)
      return operation.catch((error) => {
        fail(error)
        throw terminalError ?? error
      })
    },
    finish: () => {
      if (finishPromise) return finishPromise
      if (terminalError) return Promise.reject(terminalError)
      if (phase !== 'active') {
        return Promise.reject(new AiRuntimeError(
          'realtime_session_inactive',
          'Volcengine realtime session cannot finish'
        ))
      }
      phase = 'finishing'
      finishPromise = (async (): Promise<SpeechRecognitionOutput> => {
        await sendQueue
        if (terminalError) throw terminalError
        if (!pendingAudio) {
          throw new AiRuntimeError(
            'invalid_audio',
            'Volcengine realtime session requires at least one non-empty audio chunk'
          )
        }
        const finalAudio = pendingAudio
        pendingAudio = undefined
        try {
          await connection.send(encodeVolcengineAudioRequest(finalAudio, nextSequence, true))
        } catch (error) {
          fail(error)
          throw terminalError ?? error
        }
        return await finished.promise
      })()
      void finishPromise.catch((error) => fail(error))
      return finishPromise
    },
    close: async () => {
      context.signal.removeEventListener('abort', onAbort)
      if (phase !== 'finished' && phase !== 'failed' && phase !== 'closed') {
        phase = 'closed'
        const error = new AiRuntimeError('realtime_session_closed', 'Volcengine realtime session was closed')
        ready.reject(error)
        finished.reject(error)
      }
      await closeConnection()
    },
  }
}
