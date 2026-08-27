import { describe, expect, it, vi } from 'vitest'

import {
  createCapabilityClient,
  readCapabilityMediaSource,
  type CapabilityRealtimeModule,
} from '../src/capabilities'
import {
  defineSpeechRecognitionDescriptor,
  type SpeechRecognitionEvent,
  type SpeechRecognitionModule,
  type SpeechRecognitionOutput,
} from '../src/capabilities/speech-recognition'
import {
  defineTranslationDescriptor,
  type TranslationEvent,
  type TranslationModule,
} from '../src/capabilities/translation'
import { createModelCapabilityDiscovery } from '../src/discovery'
import type { RuntimeContext } from '../src/runtime'

function runtime(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    transport: { fetch: async () => { throw new Error('unexpected HTTP') } },
    realtime: {
      connect: async () => ({
        messages: (async function* () { yield { data: 'ready' } })(),
        send: async () => undefined,
        close: async () => undefined,
      }),
    },
    credentials: { get: async () => undefined },
    media: {
      read: async (ref) => ({
        bytes: new Uint8Array([4, 5, 6]),
        mimeType: 'audio/wav',
        filename: ref,
      }),
    },
    ...overrides,
  }
}

describe('开放 ASR / 翻译能力协议', () => {
  it('descriptor 携带供应商、operation、执行形态，支持组合发现', () => {
    const asr = defineSpeechRecognitionDescriptor({
      id: 'fixture.bailian-asr',
      providerIds: ['bailian'],
      modelId: 'fixture-asr-model',
      streaming: true,
      mediaTypes: ['audio/wav'],
      tags: ['cloud'],
    })
    const translation = defineTranslationDescriptor({
      id: 'fixture.bailian-translation',
      providerIds: ['bailian'],
      modelId: 'fixture-translation-model',
    })
    const discovery = createModelCapabilityDiscovery({ extensions: [asr, translation] })

    expect(discovery.search({
      providerIds: 'bailian',
      operations: 'speech-to-text',
      acceptedInputContentKinds: 'audio',
      features: 'streaming',
    })).toMatchObject([{ id: 'fixture.bailian-asr' }])
    expect(discovery.search({
      operations: 'text-translation',
      outputContentKinds: { allOf: ['text', 'structured-data'] },
    })).toMatchObject([{ id: 'fixture.bailian-translation' }])
    expect(asr.executionModes).toEqual(['event-stream'])
  })

  it('媒体输入既可直接给字节，也可委托宿主解析文件/资源引用', async () => {
    const reader = runtime().media
    await expect(readCapabilityMediaSource({
      kind: 'bytes',
      bytes: new Uint8Array([1, 2]),
      mediaType: 'audio/mpeg',
      filename: 'speech.mp3',
    }, reader)).resolves.toMatchObject({ mimeType: 'audio/mpeg', filename: 'speech.mp3' })
    await expect(readCapabilityMediaSource({
      kind: 'media-ref',
      ref: 'tauri://recording.wav',
    }, reader)).resolves.toMatchObject({
      bytes: new Uint8Array([4, 5, 6]),
      mimeType: 'audio/wav',
      filename: 'tauri://recording.wav',
    })
  })

  it('批量 ASR 与翻译共享注册/执行内核，同时保留各自强类型事件', async () => {
    const order: string[] = []
    const speech: SpeechRecognitionModule = {
      descriptor: defineSpeechRecognitionDescriptor({
        id: 'fixture.asr', providerIds: ['fixture'], streaming: true,
      }),
      execute: async (input, context) => {
        const media = await readCapabilityMediaSource(input.audio, context.runtime.media)
        await context.emit({ type: 'partial', text: '你' })
        await context.emit({ type: 'final', text: '你好' })
        return { text: `你好:${media.bytes.byteLength}` }
      },
    }
    const translation: TranslationModule = {
      descriptor: defineTranslationDescriptor({ id: 'fixture.translation', streaming: true }),
      execute: async (input, context) => {
        await context.emit({ type: 'delta', index: 0, text: 'hello' })
        return { translations: [{ text: 'hello', sourceText: String(input.source) }] }
      },
    }
    const client = createCapabilityClient({ runtime: runtime() })
    const asr = client.register(speech)
    const translate = client.register(translation)

    await expect(asr.execute({
      audio: { kind: 'bytes', bytes: new Uint8Array([1, 2]), mediaType: 'audio/wav' },
    }, {
      onEvent: async (event: SpeechRecognitionEvent) => {
        order.push(event.type)
        await Promise.resolve()
      },
    })).resolves.toEqual({ text: '你好:2' })
    await expect(translate.execute({ source: '你好', targetLanguage: 'en' }, {
      onEvent: (event: TranslationEvent) => { order.push(event.type) },
    })).resolves.toEqual({ translations: [{ text: 'hello', sourceText: '你好' }] })
    expect(order).toEqual(['partial', 'final', 'delta'])
    await client.dispose()
  })

  it('timeout 与 Abort 都收口为稳定错误并结束结构化日志链路', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const module: SpeechRecognitionModule = {
      descriptor: defineSpeechRecognitionDescriptor({ id: 'fixture.slow-asr' }),
      execute: async (_input, context) => await new Promise<SpeechRecognitionOutput>((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true })
      }),
    }
    const client = createCapabilityClient({ runtime: runtime({ logger }) })
    client.register(module)
    const input = {
      audio: { kind: 'bytes' as const, bytes: new Uint8Array([1]), mediaType: 'audio/wav' },
    }

    await expect(client.execute('fixture.slow-asr', input, {
      requestId: 'timeout-asr', timeoutMs: 5,
    })).rejects.toMatchObject({ code: 'timeout' })
    const controller = new AbortController()
    const pending = client.execute('fixture.slow-asr', input, {
      requestId: 'abort-asr', signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(logger.error).toHaveBeenCalledWith(
      '能力模块执行失败',
      expect.objectContaining({ event: 'capability.execute.failed', requestId: 'abort-asr' })
    )
    await client.dispose()
  })
})

describe('开放实时会话协议', () => {
  it('open/send/finish/close 复用宿主 WS、凭据、事件与生命周期', async () => {
    const sends: Uint8Array[] = []
    const close = vi.fn(async () => undefined)
    const events: SpeechRecognitionEvent[] = []
    const realtime: CapabilityRealtimeModule<
      { language?: string },
      Uint8Array,
      SpeechRecognitionEvent,
      SpeechRecognitionOutput
    > = {
      descriptor: defineSpeechRecognitionDescriptor({
        id: 'fixture.realtime-asr', providerIds: ['fixture'], realtime: true,
      }),
      open: async (_input, context) => {
        const connection = await context.runtime.realtime?.connect('wss://fixture.invalid', {
          headers: { Authorization: `Bearer ${await context.runtime.credentials.get('speech-recognition', 'fixture')}` },
          signal: context.signal,
        })
        if (!connection) throw new Error('realtime transport unavailable')
        await context.emit({ type: 'started', sessionId: 'session-1' })
        return {
          send: async (bytes) => {
            sends.push(bytes)
            await connection.send(bytes)
            await context.emit({ type: 'partial', text: `bytes:${bytes.byteLength}` })
          },
          finish: async () => ({ text: 'done' }),
          close: async () => {
            await connection.close()
            await close()
          },
        }
      },
    }
    const client = createCapabilityClient({
      runtime: runtime({ credentials: { get: async () => 'secret' } }),
      realtimeModules: [realtime],
    })
    const session = await client.openSession('fixture.realtime-asr', { language: 'zh' }, {
      requestId: 'realtime-1', onEvent: (event) => { events.push(event) },
    })
    await session.send(new Uint8Array([1, 2, 3]))
    await expect(session.finish()).resolves.toEqual({ text: 'done' })
    expect(sends).toEqual([new Uint8Array([1, 2, 3])])
    expect(events.map((event) => event.type)).toEqual(['started', 'partial'])
    expect(close).toHaveBeenCalledOnce()
    await client.dispose()
  })

  it('cancel 会关闭实时 driver，dispose 不会遗留活动会话', async () => {
    const close = vi.fn(async () => undefined)
    const module: CapabilityRealtimeModule<undefined, Uint8Array, never, SpeechRecognitionOutput> = {
      descriptor: defineSpeechRecognitionDescriptor({ id: 'fixture.cancel-session', realtime: true }),
      open: async () => ({
        send: async () => undefined,
        finish: async () => ({ text: 'unused' }),
        close,
      }),
    }
    const client = createCapabilityClient({ runtime: runtime(), realtimeModules: [module] })
    const session = await client.openSession('fixture.cancel-session', undefined, {
      requestId: 'cancel-session',
    })
    client.cancel('cancel-session')
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    await expect(session.send(new Uint8Array([1]))).rejects.toMatchObject({ code: 'cancelled' })
    await client.dispose()
  })

  it('实时会话 timeout 会主动关闭 driver 并向后续调用暴露 timeout', async () => {
    const close = vi.fn(async () => undefined)
    const module: CapabilityRealtimeModule<undefined, Uint8Array, never, SpeechRecognitionOutput> = {
      descriptor: defineSpeechRecognitionDescriptor({ id: 'fixture.timeout-session', realtime: true }),
      open: async () => ({
        send: async () => undefined,
        finish: async () => ({ text: 'unused' }),
        close,
      }),
    }
    const client = createCapabilityClient({ runtime: runtime(), realtimeModules: [module] })
    const session = await client.openSession('fixture.timeout-session', undefined, {
      requestId: 'timeout-session', timeoutMs: 5,
    })
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    await expect(session.send(new Uint8Array([1]))).rejects.toMatchObject({ code: 'timeout' })
    await client.dispose()
  })
})
