import { describe, expect, it, vi } from 'vitest'

import {
  CHAT_CAPABILITY_DESCRIPTOR,
  GENERATION_CAPABILITY_DESCRIPTOR,
  createCapabilityClient,
  type CapabilityModule,
  type RuntimeContext,
} from '../src'

interface SpeechRecognitionInput {
  audio: Uint8Array
  language?: string
}

interface SpeechRecognitionOutput {
  text: string
}

interface OcrInput {
  source: Uint8Array
  mediaType: 'image/png' | 'application/pdf'
}

interface OcrOutput {
  text: string
  blocks: Array<{ text: string; confidence: number }>
}

function runtime(logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}): RuntimeContext {
  return {
    transport: { fetch: async () => { throw new Error('Fixture must not use network') } },
    credentials: { get: async () => undefined },
    media: { read: async () => { throw new Error('Fixture uses explicit bytes') } },
    logger,
  }
}

function speechModule(): CapabilityModule<SpeechRecognitionInput, SpeechRecognitionOutput> {
  return {
    descriptor: {
      id: 'fixture.local-speech-recognition',
      kind: 'speech-recognition',
      source: { kind: 'external', namespace: '@henjicc/test-fixtures' },
      contract: {
        input: [{ kind: 'audio', required: true, mediaTypes: ['audio/wav'] }],
        output: [{ kind: 'text', required: true }],
      },
    },
    async execute(input, context) {
      if (context.signal.aborted) throw new Error('aborted before fixture')
      return { text: `${input.language ?? 'auto'}:${input.audio.byteLength}` }
    },
  }
}

function ocrModule(dispose = vi.fn()): CapabilityModule<OcrInput, OcrOutput> {
  return {
    descriptor: {
      id: 'fixture.local-ocr',
      kind: 'ocr',
      source: { kind: 'plugin', namespace: 'com.henjicc.fixture-ocr' },
      contract: {
        input: [
          { kind: 'image', mediaTypes: ['image/png'] },
          { kind: 'pdf', mediaTypes: ['application/pdf'] },
        ],
        output: [
          { kind: 'text', required: true },
          { kind: 'structured-data', required: true },
        ],
      },
    },
    async execute(input) {
      if (input.source.byteLength === 0) throw new Error('empty OCR fixture')
      return {
        text: `${input.mediaType}:${input.source.byteLength}`,
        blocks: [{ text: 'fixture', confidence: 1 }],
      }
    },
    dispose,
  }
}

describe('开放能力模块协议', () => {
  it('ASR/OCR 不改 core 即可注册、发现和类型化执行', async () => {
    const client = createCapabilityClient({ runtime: runtime() })
    const speech = client.register(speechModule())
    const ocr = client.register(ocrModule())

    expect(client.list().map((descriptor) => descriptor.kind)).toEqual([
      'speech-recognition',
      'ocr',
    ])
    expect(client.list('ocr')).toHaveLength(1)
    expect(speech.descriptor.contract).toMatchObject({
      input: [{ kind: 'audio' }],
      output: [{ kind: 'text' }],
    })
    await expect(speech.execute({
      audio: new Uint8Array([1, 2, 3]),
      language: 'zh-CN',
    })).resolves.toEqual({ text: 'zh-CN:3' })
    await expect(ocr.execute({
      source: new Uint8Array([1, 2]),
      mediaType: 'application/pdf',
    })).resolves.toEqual({
      text: 'application/pdf:2',
      blocks: [{ text: 'fixture', confidence: 1 }],
    })
    await client.dispose()
  })

  it('错误被归一化并进入结构化日志边界', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const client = createCapabilityClient({ runtime: runtime(logger) })
    client.register(ocrModule())

    await expect(client.execute<OcrInput, OcrOutput>('fixture.local-ocr', {
      source: new Uint8Array(),
      mediaType: 'image/png',
    }, { requestId: 'ocr-error' })).rejects.toMatchObject({
      code: 'capability_execution_failed',
    })
    expect(logger.error).toHaveBeenCalledWith(
      '能力模块执行失败',
      expect.objectContaining({ event: 'capability.execute.failed', requestId: 'ocr-error' })
    )
    await client.dispose()
  })

  it('取消、注销和 dispose 都释放模块，不依赖模型类型联合', async () => {
    const dispose = vi.fn()
    const client = createCapabilityClient({ runtime: runtime() })
    client.register(ocrModule(dispose))
    client.register<SpeechRecognitionInput, SpeechRecognitionOutput>({
      ...speechModule(),
      descriptor: { ...speechModule().descriptor, id: 'fixture.cancellable-speech' },
      execute: async (_input, context) => await new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new Error('fixture aborted')), {
          once: true,
        })
      }),
    })

    const pending = client.execute<SpeechRecognitionInput, SpeechRecognitionOutput>(
      'fixture.cancellable-speech',
      { audio: new Uint8Array([1]) },
      { requestId: 'speech-cancel' }
    )
    await vi.waitFor(() => {
      client.cancel('speech-cancel')
    })
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    await expect(client.unregister('fixture.local-ocr')).resolves.toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
    await expect(client.unregister('fixture.local-ocr')).resolves.toBe(false)
    await client.dispose()
  })

  it('generation/chat 可通过同一描述协议发现但执行内核保持分离', () => {
    expect(GENERATION_CAPABILITY_DESCRIPTOR).toMatchObject({
      kind: 'media-generation',
      contract: { output: [{ kind: 'image' }, { kind: 'video' }, { kind: 'audio' }] },
    })
    expect(CHAT_CAPABILITY_DESCRIPTOR).toMatchObject({
      kind: 'chat',
      contract: { input: [{ kind: 'text' }] },
    })
  })
})
