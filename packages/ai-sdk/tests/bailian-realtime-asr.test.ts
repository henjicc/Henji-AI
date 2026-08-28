import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { createCapabilityClient } from '../src/capabilities'
import type {
  SpeechRecognitionAudioChunk,
  SpeechRecognitionEvent,
  SpeechRecognitionOutput,
  SpeechRecognitionRealtimeStart,
} from '../src/capabilities/speech-recognition'
import {
  bailianFunAsrRealtime,
  bailianQwen3AsrFlashRealtime,
  bailianRealtimeAsrPresets,
  createBailianRealtimeAsrModule,
} from '../src/capabilities/speech-recognition/bailian/realtime'
import { parseRealtimeMessage } from '../src/capabilities/speech-recognition/bailian/realtime/protocol'
import type { Logger, RealtimeConnection, RealtimeMessage, RuntimeContext } from '../src/runtime'

interface Fixture<T> {
  kind: 'capability'
  source: Record<string, string>
  events: T
}

function fixture<T>(name: string): Fixture<T> {
  return JSON.parse(readFileSync(new URL(`./fixtures/bailian/${name}`, import.meta.url), 'utf8')) as Fixture<T>
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
    const message = { data }
    const waiter = this.waiters.shift()
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

function stringify(event: unknown): string {
  return JSON.stringify(event)
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
    credentials: { get: async () => 'fixture-secret-key' },
    media: { read: async () => { throw new Error('media reader must not be used') } },
    logger,
  }
}

async function open(
  client: ReturnType<typeof createCapabilityClient>,
  moduleId: string,
  input: SpeechRecognitionRealtimeStart,
  options: { requestId: string; timeoutMs?: number; onEvent?(event: SpeechRecognitionEvent): void }
) {
  return await client.openSession<
    SpeechRecognitionRealtimeStart,
    SpeechRecognitionAudioChunk,
    SpeechRecognitionEvent,
    SpeechRecognitionOutput
  >(moduleId, input, options)
}

describe('百炼实时 ASR', () => {
  it('4 个 preset 分属 Fun Duplex 与 Qwen Realtime，不混入非实时模型', () => {
    expect(bailianRealtimeAsrPresets.map((preset) => [preset.modelId, preset.protocol])).toEqual([
      ['fun-asr-realtime', 'fun-duplex'],
      ['fun-asr-realtime-2026-02-28', 'fun-duplex'],
      ['qwen3-asr-flash-realtime', 'qwen-realtime'],
      ['qwen3-asr-flash-realtime-2026-02-10', 'qwen-realtime'],
    ])
    expect(bailianRealtimeAsrPresets.every((preset) => preset.descriptor.executionModes?.includes('realtime'))).toBe(true)
  })

  it('Fun Duplex 完整处理 start/二进制/partial/final/timestamps/finish，finish 与 close 幂等', async () => {
    const official = fixture<{
      started: unknown; sentenceBegin: unknown; partial: unknown; final: unknown; finished: unknown
    }>('asr-realtime-fun.json')
    const events: SpeechRecognitionEvent[] = []
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const connection = new ScriptedConnection((data) => {
      if (typeof data !== 'string') {
        connection.push(stringify(official.events.partial))
        connection.push(stringify(official.events.final))
        return
      }
      const message = JSON.parse(data) as { header?: { action?: string } }
      if (message.header?.action === 'run-task') {
        connection.push('{"header":{"event":"future-event"},"secret":"DO_NOT_LOG"}')
        connection.push(stringify(official.events.started))
      } else if (message.header?.action === 'finish-task') {
        connection.push(stringify(official.events.finished))
      }
    })
    const connect = vi.fn()
    const module = createBailianRealtimeAsrModule(bailianFunAsrRealtime, {
      taskIdFactory: () => '11111111-1111-4111-8111-111111111111',
    })
    const client = createCapabilityClient({ runtime: runtime(connection, connect, logger), realtimeModules: [module] })
    const session = await open(client, bailianFunAsrRealtime.id, {
      mediaType: 'audio/pcm', sampleRateHz: 16_000, channels: 1, language: 'zh',
      options: { maxSentenceSilenceMs: 900 },
    }, { requestId: 'fun-realtime', onEvent: (event) => { events.push(event) } })

    connection.push(stringify(official.events.sentenceBegin))
    await session.send({ bytes: new Uint8Array([1, 2, 3]) })
    const firstFinish = session.finish()
    const secondFinish = session.finish()
    expect(secondFinish).toBe(firstFinish)
    await expect(firstFinish).resolves.toMatchObject({
      text: '你好', durationMs: 1_000,
      segments: [{
        text: '你好', startMs: 0, endMs: 820,
        words: [
          { text: '你', startMs: 0, endMs: 420 },
          { text: '好。', startMs: 420, endMs: 820 },
        ],
      }],
    })
    expect(session.finish()).toBe(firstFinish)
    await session.close()
    await session.close()
    expect(connection.close).toHaveBeenCalledOnce()
    expect(connect).toHaveBeenCalledWith(
      'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
      expect.objectContaining({ headers: { Authorization: 'Bearer fixture-secret-key' } })
    )
    expect(events.map((event) => event.type)).toEqual(['started', 'partial', 'final', 'completed'])
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('empty-sentence-begin')
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('DO_NOT_LOG')
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('fixture-secret-key')
  })

  it('Fun 官方空 sentence-begin 正常推进；空 final 与全程无文本仍严格失败并释放连接', async () => {
    const official = fixture<{
      started: unknown; sentenceBegin: unknown; malformedPartial: unknown; emptyFinal: unknown; finished: unknown
    }>('asr-realtime-fun.json')

    expect(parseRealtimeMessage(bailianFunAsrRealtime, stringify(official.events.sentenceBegin)))
      .toEqual({ kind: 'ignored', eventType: 'empty-sentence-begin' })
    expect(() => parseRealtimeMessage(bailianFunAsrRealtime, stringify(official.events.malformedPartial)))
      .toThrowError('Bailian Fun-ASR result has no text or sentence state')
    expect(() => parseRealtimeMessage(bailianFunAsrRealtime, stringify(official.events.emptyFinal)))
      .toThrowError(expect.objectContaining({ code: 'invalid_response' }))

    const connection = new ScriptedConnection((data) => {
      if (typeof data !== 'string') return
      const message = JSON.parse(data) as { header?: { action?: string } }
      if (message.header?.action === 'run-task') {
        connection.push(stringify(official.events.started))
        connection.push(stringify(official.events.sentenceBegin))
      }
      if (message.header?.action === 'finish-task') {
        connection.push(stringify(official.events.finished))
      }
    })
    const client = createCapabilityClient({
      runtime: runtime(connection),
      realtimeModules: [createBailianRealtimeAsrModule(bailianFunAsrRealtime)],
    })
    const session = await open(client, bailianFunAsrRealtime.id, { mediaType: 'audio/pcm' }, {
      requestId: 'empty-fun-realtime',
    })

    await expect(session.finish()).rejects.toMatchObject({
      code: 'invalid_response',
      message: expect.stringContaining('without final transcript'),
    })
    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce())
  })

  it('Fun 重复 final 只累计并通知一次，task-finished 空 payload 不覆盖最终文本', async () => {
    const official = fixture<{
      started: unknown; final: unknown; finished: unknown
    }>('asr-realtime-fun.json')
    const events: SpeechRecognitionEvent[] = []
    const connection = new ScriptedConnection((data) => {
      if (typeof data !== 'string') return
      const message = JSON.parse(data) as { header?: { action?: string } }
      if (message.header?.action === 'run-task') connection.push(stringify(official.events.started))
      if (message.header?.action === 'finish-task') {
        connection.push(stringify(official.events.final))
        connection.push(stringify(official.events.final))
        connection.push(stringify(official.events.finished))
      }
    })
    const client = createCapabilityClient({
      runtime: runtime(connection),
      realtimeModules: [createBailianRealtimeAsrModule(bailianFunAsrRealtime)],
    })
    const session = await open(client, bailianFunAsrRealtime.id, { mediaType: 'audio/pcm' }, {
      requestId: 'duplicate-final',
      onEvent: (event) => { events.push(event) },
    })

    await expect(session.finish()).resolves.toMatchObject({ text: '你好', segments: [{ text: '你好' }] })
    expect(events.filter((event) => event.type === 'final')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('completed')
    expect(connection.close).toHaveBeenCalledOnce()
  })

  it('Qwen Realtime 等 session.created 后 update，Manual 模式 commit 后 finish 并关闭', async () => {
    const official = fixture<{
      created: unknown; updated: unknown; partial: unknown; final: unknown; finished: unknown
    }>('asr-realtime-qwen.json')
    const connection = new ScriptedConnection((data) => {
      if (typeof data !== 'string') throw new Error('Qwen audio must be Base64 JSON')
      const message = JSON.parse(data) as { type?: string; audio?: string }
      if (message.type === 'session.update') connection.push(stringify(official.events.updated))
      if (message.type === 'input_audio_buffer.append') connection.push(stringify(official.events.partial))
      if (message.type === 'session.finish') {
        connection.push(stringify(official.events.final))
        connection.push(stringify(official.events.finished))
      }
    })
    const connect = vi.fn((_url: string) => { connection.push(stringify(official.events.created)) })
    const module = createBailianRealtimeAsrModule(bailianQwen3AsrFlashRealtime)
    const client = createCapabilityClient({ runtime: runtime(connection, connect), realtimeModules: [module] })
    const session = await open(client, bailianQwen3AsrFlashRealtime.id, {
      mediaType: 'audio/pcm', sampleRateHz: 16_000, channels: 1, language: 'zh',
      options: { turnDetection: 'manual' },
    }, { requestId: 'qwen-realtime' })

    await session.send({ bytes: new Uint8Array([1, 2, 3]) })
    await expect(session.finish()).resolves.toMatchObject({ text: '你好' })
    const messages = connection.sent.filter((value): value is string => typeof value === 'string')
      .map((value) => JSON.parse(value) as { type?: string; audio?: string; session?: unknown })
    expect(messages.map((message) => message.type)).toEqual([
      'session.update', 'input_audio_buffer.append', 'input_audio_buffer.commit', 'session.finish',
    ])
    expect(messages[0].session).toMatchObject({ turn_detection: null, input_audio_transcription: { language: 'zh' } })
    expect(messages[1].audio).toBe('AQID')
    expect(connect).toHaveBeenCalledWith(
      'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime',
      expect.objectContaining({ headers: {
        Authorization: 'Bearer fixture-secret-key', 'OpenAI-Beta': 'realtime=v1',
      } })
    )
    expect(connection.close).toHaveBeenCalledOnce()
  })

  it('Qwen 无时间戳的连续同文 final 不会被 Fun 去重规则静默合并', async () => {
    const official = fixture<{
      created: unknown; updated: unknown; final: unknown; finished: unknown
    }>('asr-realtime-qwen.json')
    const events: SpeechRecognitionEvent[] = []
    const connection = new ScriptedConnection((data) => {
      if (typeof data !== 'string') return
      const message = JSON.parse(data) as { type?: string }
      if (message.type === 'session.update') connection.push(stringify(official.events.updated))
      if (message.type === 'session.finish') {
        connection.push(stringify(official.events.final))
        connection.push(stringify(official.events.final))
        connection.push(stringify(official.events.finished))
      }
    })
    const connect = vi.fn(() => { connection.push(stringify(official.events.created)) })
    const client = createCapabilityClient({
      runtime: runtime(connection, connect),
      realtimeModules: [createBailianRealtimeAsrModule(bailianQwen3AsrFlashRealtime)],
    })
    const session = await open(client, bailianQwen3AsrFlashRealtime.id, { mediaType: 'audio/pcm' }, {
      requestId: 'qwen-same-final',
      onEvent: (event) => { events.push(event) },
    })

    await expect(session.finish()).resolves.toMatchObject({
      text: '你好你好',
      segments: [{ text: '你好' }, { text: '你好' }],
    })
    expect(events.filter((event) => event.type === 'final')).toHaveLength(2)
  })

  it('乱序 transcript 在 open 阶段稳定失败并释放连接', async () => {
    const official = fixture<{ partial: unknown }>('asr-realtime-fun.json')
    const connection = new ScriptedConnection((data) => {
      if (typeof data === 'string') connection.push(stringify(official.events.partial))
    })
    const module = createBailianRealtimeAsrModule(bailianFunAsrRealtime)
    const client = createCapabilityClient({ runtime: runtime(connection), realtimeModules: [module] })
    await expect(open(client, bailianFunAsrRealtime.id, {
      mediaType: 'audio/pcm',
    }, { requestId: 'out-of-order' })).rejects.toMatchObject({ code: 'protocol_event_out_of_order' })
    expect(connection.close).toHaveBeenCalledOnce()
  })

  it('服务端错误与提前断开保留稳定错误，不把失败误报为完成', async () => {
    const fun = fixture<{ started: unknown }>('asr-realtime-fun.json')
    const errors = fixture<{ fun: unknown; qwen: unknown }>('asr-realtime-errors.json')
    const connection = new ScriptedConnection((data) => {
      if (typeof data === 'string') connection.push(stringify(fun.events.started))
      else connection.push(stringify(errors.events.fun))
    })
    const module = createBailianRealtimeAsrModule(bailianFunAsrRealtime)
    const client = createCapabilityClient({ runtime: runtime(connection), realtimeModules: [module] })
    const session = await open(client, bailianFunAsrRealtime.id, { mediaType: 'audio/pcm' }, {
      requestId: 'server-failure',
    })
    await session.send({ bytes: new Uint8Array([1]) })
    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce())
    await expect(session.finish()).rejects.toMatchObject({ code: 'provider_task_failed' })

    expect(parseRealtimeMessage(bailianQwen3AsrFlashRealtime, stringify(errors.events.qwen)))
      .toMatchObject({ kind: 'error', code: 'FIXTURE_FAILURE' })

    const disconnect = new ScriptedConnection((data) => {
      if (typeof data === 'string') disconnect.push(stringify(fun.events.started))
    })
    const disconnectClient = createCapabilityClient({
      runtime: runtime(disconnect), realtimeModules: [createBailianRealtimeAsrModule(bailianFunAsrRealtime)],
    })
    const disconnectedSession = await open(disconnectClient, bailianFunAsrRealtime.id, { mediaType: 'audio/pcm' }, {
      requestId: 'disconnect',
    })
    disconnect.end()
    await vi.waitFor(() => expect(disconnect.close).toHaveBeenCalledOnce())
    await expect(disconnectedSession.send({ bytes: new Uint8Array([1]) }))
      .rejects.toMatchObject({ code: 'provider_connection_closed' })
  })

  it('Abort 与 open timeout 都关闭宿主连接且不遗留活动会话', async () => {
    const fun = fixture<{ started: unknown }>('asr-realtime-fun.json')
    const cancelConnection = new ScriptedConnection((data) => {
      if (typeof data === 'string') cancelConnection.push(stringify(fun.events.started))
    })
    const cancelClient = createCapabilityClient({
      runtime: runtime(cancelConnection), realtimeModules: [createBailianRealtimeAsrModule(bailianFunAsrRealtime)],
    })
    const session = await open(cancelClient, bailianFunAsrRealtime.id, { mediaType: 'audio/pcm' }, {
      requestId: 'cancel-realtime',
    })
    cancelClient.cancel('cancel-realtime')
    await vi.waitFor(() => expect(cancelConnection.close).toHaveBeenCalledOnce())
    await expect(session.send({ bytes: new Uint8Array([1]) })).rejects.toMatchObject({ code: 'cancelled' })
    await cancelClient.dispose()

    const timeoutConnection = new ScriptedConnection(() => undefined)
    const timeoutClient = createCapabilityClient({
      runtime: runtime(timeoutConnection), realtimeModules: [createBailianRealtimeAsrModule(bailianFunAsrRealtime)],
    })
    await expect(open(timeoutClient, bailianFunAsrRealtime.id, { mediaType: 'audio/pcm' }, {
      requestId: 'timeout-realtime', timeoutMs: 5,
    })).rejects.toMatchObject({ code: 'timeout' })
    expect(timeoutConnection.close).toHaveBeenCalledOnce()
    await timeoutClient.dispose()
  })

  it('输入边界拒绝 Qwen 非法采样率/声道/格式，不建立付费连接', async () => {
    const connection = new ScriptedConnection(() => undefined)
    const connect = vi.fn()
    const client = createCapabilityClient({
      runtime: runtime(connection, connect),
      realtimeModules: [createBailianRealtimeAsrModule(bailianQwen3AsrFlashRealtime)],
    })
    await expect(open(client, bailianQwen3AsrFlashRealtime.id, {
      mediaType: 'audio/wav', sampleRateHz: 44_100, channels: 2,
    }, { requestId: 'invalid-audio' })).rejects.toMatchObject({ code: 'unsupported_audio_channels' })
    expect(connect).not.toHaveBeenCalled()
  })
})
