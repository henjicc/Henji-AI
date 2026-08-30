import { readFileSync } from 'node:fs'

import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import { createCapabilityClient } from '../src/capabilities'
import type {
  SpeechRecognitionAudioChunk,
  SpeechRecognitionEvent,
  SpeechRecognitionOutput,
  SpeechRecognitionRealtimeStart,
} from '../src/capabilities/speech-recognition'
import {
  createVolcengineRealtimeAsrModule,
  volcengineRealtimeAsrPresets,
  volcengineSeedAsrRealtime,
} from '../src/capabilities/speech-recognition/volcengine/realtime'
import {
  encodeVolcengineAudioRequest,
  encodeVolcengineFullRequest,
  parseVolcengineServerFrame,
} from '../src/capabilities/speech-recognition/volcengine/realtime/protocol'
import type { Logger, RealtimeConnection, RealtimeMessage, RuntimeContext } from '../src/runtime'

interface OfficialFixture {
  realtime: { handshake: unknown; progressEmpty: unknown; final: unknown }
}
interface ConstructedFixture {
  taskId: string
  realtime: {
    resourceId: string
    url: string
    fullRequestHeaderHex: string
    audioRequestHeaderHex: string
    lastAudioRequestHeaderHex: string
    startPayload: unknown
    partialPayload: unknown
  }
}
interface SyntheticFixture {
  unknownEvent: number
  serverError: { code: number; payload: unknown }
}
function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/volcengine/${name}`, import.meta.url), 'utf8')) as T
}
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}
function i32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setInt32(0, value, false)
  return bytes
}
function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}
function serverFrame(input: {
  payload: unknown
  rawText?: string
  sequence?: number
  event?: number
  last?: boolean
  compression?: 'gzip' | 'none'
  errorCode?: number
}): Uint8Array {
  const flags = (input.sequence === undefined ? 0 : 1) | (input.last ? 2 : 0) | (input.event === undefined ? 0 : 4)
  const raw = strToU8(input.rawText ?? JSON.stringify(input.payload))
  const body = input.compression === 'none' ? raw : gzipSync(raw)
  return concat([
    new Uint8Array([
      0x11,
      ((input.errorCode === undefined ? 0x9 : 0xf) << 4) | flags,
      0x10 | (input.compression === 'none' ? 0 : 1),
      0,
    ]),
    ...(input.sequence === undefined ? [] : [i32(input.sequence)]),
    ...(input.event === undefined ? [] : [i32(input.event)]),
    ...(input.errorCode === undefined ? [] : [u32(input.errorCode)]),
    u32(body.byteLength),
    body,
  ])
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function clientSequence(frame: Uint8Array): number {
  return new DataView(frame.buffer, frame.byteOffset + 4, 4).getInt32(0, false)
}

function clientPayload(frame: Uint8Array): Uint8Array {
  const size = new DataView(frame.buffer, frame.byteOffset + 8, 4).getUint32(0, false)
  expect(frame.byteLength).toBe(12 + size)
  return gunzipSync(frame.subarray(12))
}

class ScriptedConnection implements RealtimeConnection {
  private readonly queue: RealtimeMessage[] = []
  private readonly waiters: Array<(value: IteratorResult<RealtimeMessage>) => void> = []
  private ended = false
  readonly sent: Array<string | Uint8Array> = []
  readonly close = vi.fn(async () => { this.end() })

  constructor(private readonly onSend: (data: string | Uint8Array) => void | Promise<void>) {}

  readonly messages: AsyncIterable<RealtimeMessage> = {
    [Symbol.asyncIterator]: () => ({ next: async () => await this.next() }),
  }

  async send(data: string | Uint8Array): Promise<void> {
    this.sent.push(data)
    await this.onSend(data)
  }

  push(data: string | Uint8Array): void {
    if (this.ended) return
    const waiter = this.waiters.shift()
    const message = { data }
    if (waiter) waiter({ value: message, done: false })
    else this.queue.push(message)
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true })
  }

  private async next(): Promise<IteratorResult<RealtimeMessage>> {
    const message = this.queue.shift()
    if (message) return { value: message, done: false }
    if (this.ended) return { value: undefined, done: true }
    return await new Promise((resolve) => { this.waiters.push(resolve) })
  }
}

function runtime(
  connection: ScriptedConnection,
  onConnect?: (url: string, options?: Parameters<NonNullable<RuntimeContext['realtime']>['connect']>[1]) => void,
  logger?: Logger
): RuntimeContext {
  return {
    transport: { fetch: async () => { throw new Error('HTTP must not be used') } },
    realtime: {
      connect: async (url, options) => {
        onConnect?.(url, options)
        return connection
      },
    },
    credentials: { get: async () => 'fixture-api-key' },
    media: { read: async () => { throw new Error('media reader must not be used') } },
    logger,
  }
}

async function open(
  client: ReturnType<typeof createCapabilityClient>,
  input: SpeechRecognitionRealtimeStart,
  options: { requestId: string; timeoutMs?: number; onEvent?(event: SpeechRecognitionEvent): void }
) {
  return await client.openSession<
    SpeechRecognitionRealtimeStart,
    SpeechRecognitionAudioChunk,
    SpeechRecognitionEvent,
    SpeechRecognitionOutput
  >(volcengineSeedAsrRealtime.id, input, options)
}

describe('火山 SeedASR 2.0 实时协议', () => {
  it('编码官方首帧/音频帧头，gzip UTF-8，并以负 int32 标记最后真实音频块', () => {
    const constructed = fixture<ConstructedFixture>('asr-seedasr-field-construction.json')
    expect(volcengineRealtimeAsrPresets).toEqual([volcengineSeedAsrRealtime])
    expect(volcengineSeedAsrRealtime.modelId).toBe('seedasr-2.0-realtime')
    const full = encodeVolcengineFullRequest(constructed.realtime.startPayload, 1)
    const audio = encodeVolcengineAudioRequest(new Uint8Array([1, 2, 3, 4]), 2, false)
    const last = encodeVolcengineAudioRequest(new Uint8Array([5, 6]), 3, true)

    expect(hex(full.subarray(0, 4))).toBe(constructed.realtime.fullRequestHeaderHex)
    expect(hex(audio.subarray(0, 4))).toBe(constructed.realtime.audioRequestHeaderHex)
    expect(hex(last.subarray(0, 4))).toBe(constructed.realtime.lastAudioRequestHeaderHex)
    expect(clientSequence(full)).toBe(1)
    expect(clientSequence(audio)).toBe(2)
    expect(clientSequence(last)).toBe(-3)
    expect(JSON.parse(strFromU8(clientPayload(full)))).toEqual(constructed.realtime.startPayload)
    expect(clientPayload(audio)).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(clientPayload(last)).toEqual(new Uint8Array([5, 6]))
  })

  it('服务端解析同时接受 none/gzip，保留未知 event，并严格拒绝断牙与尾随字节', () => {
    const official = fixture<OfficialFixture>('asr-seedasr-official.json')
    const synthetic = fixture<SyntheticFixture>('asr-seedasr-synthetic.json')
    const gzip = serverFrame({
      payload: official.realtime.progressEmpty,
      sequence: 2,
      event: synthetic.unknownEvent,
    })
    const none = serverFrame({ payload: official.realtime.final, sequence: -3, last: true, compression: 'none' })
    expect(parseVolcengineServerFrame(gzip)).toMatchObject({
      kind: 'response', sequence: 2, event: synthetic.unknownEvent, last: false,
      payload: official.realtime.progressEmpty,
    })
    expect(parseVolcengineServerFrame(none)).toMatchObject({
      kind: 'response', sequence: -3, last: true, payload: official.realtime.final,
    })
    expect(parseVolcengineServerFrame(serverFrame({
      payload: undefined,
      rawText: 'synthetic plain-text failure',
      errorCode: 3_000_000_000,
      last: true,
    }))).toMatchObject({
      kind: 'error', code: 3_000_000_000, message: 'synthetic plain-text failure',
    })
    expect(() => parseVolcengineServerFrame(gzip.subarray(0, gzip.byteLength - 1)))
      .toThrowError(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseVolcengineServerFrame(concat([gzip, new Uint8Array([0])])))
      .toThrowError(expect.objectContaining({ code: 'invalid_response' }))
    expect(() => parseVolcengineServerFrame(new Uint8Array([0x11, 0x91, 0x11])))
      .toThrowError(expect.objectContaining({ code: 'invalid_response' }))
  })
})

describe('火山 SeedASR 2.0 实时会话', () => {
  it('握手后缓存最后一块，finish 发负序号，归一化 partial/final/terminal 且释放幂等', async () => {
    const official = fixture<OfficialFixture>('asr-seedasr-official.json')
    const constructed = fixture<ConstructedFixture>('asr-seedasr-field-construction.json')
    const synthetic = fixture<SyntheticFixture>('asr-seedasr-synthetic.json')
    const events: SpeechRecognitionEvent[] = []
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const connection = new ScriptedConnection((data) => {
      if (typeof data === 'string') throw new Error('Volcengine client frames must be binary')
      const messageType = data[1] >> 4
      if (messageType === 1) {
        connection.push(serverFrame({ payload: official.realtime.handshake, sequence: 1 }))
      } else if (clientSequence(data) > 0) {
        connection.push(serverFrame({
          payload: constructed.realtime.partialPayload,
          sequence: clientSequence(data),
          event: synthetic.unknownEvent,
        }))
      } else {
        connection.push(serverFrame({
          payload: official.realtime.final,
          sequence: clientSequence(data),
          last: true,
        }))
      }
    })
    const connect = vi.fn()
    const client = createCapabilityClient({
      runtime: runtime(connection, connect, logger),
      realtimeModules: [createVolcengineRealtimeAsrModule(volcengineSeedAsrRealtime, {
        requestIdFactory: () => constructed.taskId,
      })],
    })
    const session = await open(client, {
      mediaType: 'audio/pcm', sampleRateHz: 16_000, channels: 1,
    }, { requestId: 'realtime-success', onEvent: (event) => { events.push(event) } })

    const first = new Uint8Array([1, 2, 3, 4])
    await session.send({ bytes: first })
    first.fill(99)
    expect(connection.sent).toHaveLength(1)
    await session.send({ bytes: new Uint8Array([5, 6]) })
    expect(connection.sent).toHaveLength(2)
    const firstFinish = session.finish()
    expect(session.finish()).toBe(firstFinish)
    const output = await firstFinish
    expect(output).toMatchObject({
      text: '打开客厅空调，退出。',
      durationMs: 5700,
      segments: [{
        text: '打开客厅空调，退出。', startMs: 120, endMs: 4800,
      }],
      providerMetadata: {
        requestId: constructed.taskId,
        resourceId: constructed.realtime.resourceId,
        logId: 'fixture-realtime-log-id',
      },
    })
    expect(output.segments?.[0]?.words?.map((word) => word.text)).toEqual(['打', '开', '客', '厅', '空', '调', '退', '出'])
    expect(connection.sent).toHaveLength(3)
    const audioFrames = connection.sent.slice(1) as Uint8Array[]
    expect(clientSequence(audioFrames[0])).toBe(2)
    expect(clientPayload(audioFrames[0])).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(clientSequence(audioFrames[1])).toBe(-3)
    expect(clientPayload(audioFrames[1])).toEqual(new Uint8Array([5, 6]))
    expect(events.map((event) => event.type)).toEqual(['started', 'partial', 'final', 'completed'])
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('fixture-api-key')
    await session.close()
    await session.close()
    expect(connection.close).toHaveBeenCalledOnce()

    expect(connect).toHaveBeenCalledWith(constructed.realtime.url, expect.objectContaining({
      headers: {
        'X-Api-Key': 'fixture-api-key',
        'X-Api-Resource-Id': constructed.realtime.resourceId,
        'X-Api-Request-Id': constructed.taskId,
        'X-Api-Sequence': '-1',
      },
    }))
    const authHeaders = connect.mock.calls[0][1]?.headers as Record<string, string>
    expect(authHeaders['X-Api-App-Key']).toBeUndefined()
    expect(authHeaders['X-Api-Access-Key']).toBeUndefined()
  })

  it('full request 服务端响应超时会稳定失败并释放半开连接', async () => {
    vi.useFakeTimers()
    try {
      const constructed = fixture<ConstructedFixture>('asr-seedasr-field-construction.json')
      const connection = new ScriptedConnection(() => undefined)
      const client = createCapabilityClient({
        runtime: runtime(connection),
        realtimeModules: [createVolcengineRealtimeAsrModule(volcengineSeedAsrRealtime, {
          openTimeoutMs: 100,
          requestIdFactory: () => constructed.taskId,
        })],
      })
      const opening = open(client, { mediaType: 'audio/pcm' }, { requestId: 'open-timeout' })
      const rejection = expect(opening).rejects.toMatchObject({ code: 'timeout' })
      await vi.advanceTimersByTimeAsync(100)
      await rejection
      expect(connection.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('用户取消只关闭连接：不发送缓存音频，也不伪造负序号终帧', async () => {
    const official = fixture<OfficialFixture>('asr-seedasr-official.json')
    const constructed = fixture<ConstructedFixture>('asr-seedasr-field-construction.json')
    const connection = new ScriptedConnection((data) => {
      if (typeof data !== 'string' && (data[1] >> 4) === 1) {
        connection.push(serverFrame({ payload: official.realtime.handshake, sequence: 1 }))
      }
    })
    const client = createCapabilityClient({
      runtime: runtime(connection),
      realtimeModules: [createVolcengineRealtimeAsrModule(volcengineSeedAsrRealtime, {
        requestIdFactory: () => constructed.taskId,
      })],
    })
    const session = await open(client, { mediaType: 'audio/pcm' }, { requestId: 'cancel-only-closes' })
    await session.send({ bytes: new Uint8Array([1, 2]) })
    client.cancel('cancel-only-closes')
    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce())
    expect(connection.sent).toHaveLength(1)
    expect(connection.sent.every((value) => (
      typeof value === 'string' || clientSequence(value) >= 0
    ))).toBe(true)
    await expect(session.finish()).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('无音频 finish、服务端错误、断线与 text 帧都稳定失败并只释放一次', async () => {
    const official = fixture<OfficialFixture>('asr-seedasr-official.json')
    const constructed = fixture<ConstructedFixture>('asr-seedasr-field-construction.json')
    const synthetic = fixture<SyntheticFixture>('asr-seedasr-synthetic.json')

    const empty = new ScriptedConnection((data) => {
      if (typeof data !== 'string') empty.push(serverFrame({ payload: official.realtime.handshake, sequence: 1 }))
    })
    const emptyClient = createCapabilityClient({
      runtime: runtime(empty),
      realtimeModules: [createVolcengineRealtimeAsrModule(volcengineSeedAsrRealtime, {
        requestIdFactory: () => constructed.taskId,
      })],
    })
    const emptySession = await open(emptyClient, { mediaType: 'audio/pcm' }, { requestId: 'empty-finish' })
    await expect(emptySession.finish()).rejects.toMatchObject({ code: 'invalid_audio' })
    expect(empty.close).toHaveBeenCalledOnce()

    const emptyTerminal = new ScriptedConnection((data) => {
      if (typeof data === 'string') return
      const sequence = clientSequence(data)
      const initial = (data[1] >> 4) === 1
      emptyTerminal.push(serverFrame({
        payload: initial
          ? official.realtime.handshake
          : sequence > 0
            ? constructed.realtime.partialPayload
            : { audio_info: { duration: 20 }, result: { text: '', utterances: [] } },
        sequence,
        last: !initial && sequence < 0,
      }))
    })
    const emptyTerminalClient = createCapabilityClient({
      runtime: runtime(emptyTerminal),
      realtimeModules: [createVolcengineRealtimeAsrModule(volcengineSeedAsrRealtime, {
        requestIdFactory: () => constructed.taskId,
      })],
    })
    const emptyTerminalSession = await open(emptyTerminalClient, { mediaType: 'audio/pcm' }, { requestId: 'empty-terminal' })
    await emptyTerminalSession.send({ bytes: new Uint8Array([1, 2]) })
    await emptyTerminalSession.send({ bytes: new Uint8Array([3, 4]) })
    await expect(emptyTerminalSession.finish()).rejects.toMatchObject({ code: 'invalid_response' })
    expect(emptyTerminal.close).toHaveBeenCalledOnce()

    const serverError = new ScriptedConnection((data) => {
      if (typeof data === 'string') return
      if ((data[1] >> 4) === 1) serverError.push(serverFrame({ payload: official.realtime.handshake, sequence: 1 }))
      else serverError.push(serverFrame({
        payload: synthetic.serverError.payload,
        errorCode: synthetic.serverError.code,
        last: true,
      }))
    })
    const errorClient = createCapabilityClient({
      runtime: runtime(serverError),
      realtimeModules: [createVolcengineRealtimeAsrModule(volcengineSeedAsrRealtime, {
        requestIdFactory: () => constructed.taskId,
      })],
    })
    const errorSession = await open(errorClient, { mediaType: 'audio/pcm' }, { requestId: 'server-error' })
    await errorSession.send({ bytes: new Uint8Array([1, 2]) })
    await expect(errorSession.finish()).rejects.toMatchObject({
      code: 'provider_task_failed',
      message: expect.stringContaining(String(synthetic.serverError.code)),
    })
    expect(serverError.close).toHaveBeenCalledOnce()

    const disconnected = new ScriptedConnection((data) => {
      if (typeof data !== 'string') disconnected.push(serverFrame({ payload: official.realtime.handshake, sequence: 1 }))
    })
    const disconnectClient = createCapabilityClient({
      runtime: runtime(disconnected),
      realtimeModules: [createVolcengineRealtimeAsrModule(volcengineSeedAsrRealtime, {
        requestIdFactory: () => constructed.taskId,
      })],
    })
    const disconnectedSession = await open(disconnectClient, { mediaType: 'audio/pcm' }, { requestId: 'disconnect' })
    disconnected.end()
    await vi.waitFor(() => expect(disconnected.close).toHaveBeenCalledOnce())
    await expect(disconnectedSession.send({ bytes: new Uint8Array([1, 2]) }))
      .rejects.toMatchObject({ code: 'provider_connection_closed' })

    const textFrame = new ScriptedConnection(() => { textFrame.push('{"result":{}}') })
    const textClient = createCapabilityClient({
      runtime: runtime(textFrame),
      realtimeModules: [createVolcengineRealtimeAsrModule(volcengineSeedAsrRealtime, {
        requestIdFactory: () => constructed.taskId,
      })],
    })
    await expect(open(textClient, { mediaType: 'audio/pcm' }, { requestId: 'text-frame' }))
      .rejects.toMatchObject({ code: 'invalid_response' })
    expect(textFrame.close).toHaveBeenCalledOnce()

    const premature = new ScriptedConnection(() => {
      premature.push(serverFrame({ payload: official.realtime.final, sequence: -1, last: true }))
    })
    const prematureClient = createCapabilityClient({
      runtime: runtime(premature),
      realtimeModules: [createVolcengineRealtimeAsrModule(volcengineSeedAsrRealtime, {
        requestIdFactory: () => constructed.taskId,
      })],
    })
    await expect(open(prematureClient, { mediaType: 'audio/pcm' }, { requestId: 'premature-terminal' }))
      .rejects.toMatchObject({ code: 'protocol_event_out_of_order' })
    expect(premature.close).toHaveBeenCalledOnce()

    const timeout = new ScriptedConnection(() => undefined)
    const timeoutClient = createCapabilityClient({
      runtime: runtime(timeout),
      realtimeModules: [createVolcengineRealtimeAsrModule(volcengineSeedAsrRealtime, {
        requestIdFactory: () => constructed.taskId,
      })],
    })
    await expect(open(timeoutClient, { mediaType: 'audio/pcm' }, {
      requestId: 'open-timeout', timeoutMs: 5,
    })).rejects.toMatchObject({ code: 'timeout' })
    expect(timeout.close).toHaveBeenCalledOnce()
  })

  it('非法格式/采样率/声道/language/奇数字节在付费发送边界前拒绝', async () => {
    const official = fixture<OfficialFixture>('asr-seedasr-official.json')
    const constructed = fixture<ConstructedFixture>('asr-seedasr-field-construction.json')
    const connection = new ScriptedConnection((data) => {
      if (typeof data !== 'string') connection.push(serverFrame({ payload: official.realtime.handshake, sequence: 1 }))
    })
    const connect = vi.fn()
    const client = createCapabilityClient({
      runtime: runtime(connection, connect),
      realtimeModules: [createVolcengineRealtimeAsrModule(volcengineSeedAsrRealtime, {
        requestIdFactory: () => constructed.taskId,
      })],
    })

    await expect(open(client, { mediaType: 'audio/wav' }, { requestId: 'bad-format' }))
      .rejects.toMatchObject({ code: 'unsupported_audio_format' })
    await expect(open(client, { mediaType: 'audio/pcm', sampleRateHz: 44_100 }, { requestId: 'bad-rate' }))
      .rejects.toMatchObject({ code: 'unsupported_sample_rate' })
    await expect(open(client, { mediaType: 'audio/pcm', channels: 2 }, { requestId: 'bad-channels' }))
      .rejects.toMatchObject({ code: 'unsupported_audio_channels' })
    await expect(open(client, { mediaType: 'audio/pcm', language: 'zh-CN' }, { requestId: 'bad-language' }))
      .rejects.toMatchObject({ code: 'unsupported_parameter' })
    await expect(open(client, {
      mediaType: 42,
    } as unknown as SpeechRecognitionRealtimeStart, { requestId: 'bad-media-type' }))
      .rejects.toMatchObject({ code: 'invalid_parameter' })
    await expect(open(client, {
      mediaType: 'audio/pcm', options: { enableDdc: 'yes' },
    } as unknown as SpeechRecognitionRealtimeStart, { requestId: 'bad-options' }))
      .rejects.toMatchObject({ code: 'invalid_parameter' })
    expect(connect).not.toHaveBeenCalled()

    const session = await open(client, { mediaType: 'audio/pcm' }, { requestId: 'odd-byte' })
    await expect(session.send({ bytes: new Uint8Array([1]) }))
      .rejects.toMatchObject({ code: 'invalid_audio_chunk' })
    expect(connection.sent).toHaveLength(1)
    await session.close()
  })
})
