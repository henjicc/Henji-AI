import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { createCapabilityClient } from '../src/capabilities'
import type { SpeechRecognitionEvent } from '../src/capabilities/speech-recognition'
import {
  createGroqAsrModule,
  groqAsrPresets,
  groqWhisperLargeV3,
  groqWhisperLargeV3Turbo,
  parseGroqTranscription,
} from '../src/capabilities/speech-recognition/groq'
import {
  createSiliconFlowAsrModule,
  siliconFlowAsrPresets,
  siliconFlowSenseVoiceSmall,
  siliconFlowTeleSpeechAsr,
} from '../src/capabilities/speech-recognition/siliconflow'
import type { RuntimeContext } from '../src/runtime'

interface Fixture<T> {
  kind: 'capability'
  source: unknown
  payload: T
  status?: number
}

function fixture<T>(directory: 'groq-asr' | 'siliconflow', name: string): Fixture<T> {
  return JSON.parse(readFileSync(new URL(`./fixtures/${directory}/${name}`, import.meta.url), 'utf8')) as Fixture<T>
}

function runtime(providerId: 'groq' | 'siliconflow', fetch: RuntimeContext['transport']['fetch']): RuntimeContext {
  return {
    transport: { fetch },
    credentials: {
      get: async (scope, requestedProvider) => (
        scope === 'speech-recognition' && requestedProvider === providerId ? 'fixture-key' : undefined
      ),
    },
    media: {
      read: async (ref) => ({
        bytes: new Uint8Array([82, 73, 70, 70]),
        mimeType: 'audio/wav',
        filename: `${ref}.wav`,
      }),
    },
  }
}

function formFrom(init: RequestInit | undefined): FormData {
  expect(init?.body).toBeInstanceOf(FormData)
  return init?.body as FormData
}

describe('Groq 文件 ASR', () => {
  it('只公开 P0 两个 Whisper 模型并保持精确平台 ID', () => {
    expect(groqAsrPresets.map((preset) => preset.modelId)).toEqual([
      'whisper-large-v3-turbo',
      'whisper-large-v3',
    ])
    expect(groqAsrPresets.every((preset) => (
      preset.descriptor.providerIds?.[0] === 'groq'
      && preset.descriptor.features?.includes('file-transcription')
    ))).toBe(true)
  })

  it('multipart 请求支持语言、提示、温度和时间戳并归一化 verbose_json', async () => {
    const official = fixture<unknown>('groq-asr', 'transcription-verbose.json')
    const fetch = vi.fn(async () => new Response(JSON.stringify(official.payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const events: SpeechRecognitionEvent[] = []
    const client = createCapabilityClient({
      runtime: runtime('groq', fetch),
      modules: [createGroqAsrModule(groqWhisperLargeV3Turbo)],
    })
    const output = await client.execute(groqWhisperLargeV3Turbo.id, {
      audio: { kind: 'media-ref', ref: 'recording' },
      language: 'zh',
      timestamps: true,
      options: { prompt: '会议转写', temperature: 0.2, timestampGranularities: ['word', 'segment'] },
    }, { onEvent: (event) => { events.push(event) } })

    expect(output.text).toBeTruthy()
    expect(output.segments?.[0]).toMatchObject({ startMs: expect.any(Number), endMs: expect.any(Number) })
    expect(output.segments?.map((segment) => segment.words)).toEqual([
      [{ text: 'fixture', startMs: 0, endMs: 1_100 }],
      [{ text: 'transcription', startMs: 1_100, endMs: 2_400 }],
    ])
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect(init?.headers).toEqual({ Authorization: 'Bearer fixture-key' })
    const form = formFrom(init)
    expect(form.get('model')).toBe('whisper-large-v3-turbo')
    expect(form.get('language')).toBe('zh')
    expect(form.get('prompt')).toBe('会议转写')
    expect(form.get('temperature')).toBe('0.2')
    expect(form.get('response_format')).toBe('verbose_json')
    expect(form.getAll('timestamp_granularities[]')).toEqual(['word', 'segment'])
    expect(form.get('file')).toBeInstanceOf(Blob)
    expect(events.at(-1)?.type).toBe('completed')
  })

  it('解析官方标准 JSON 字面响应并保留供应商 metadata', async () => {
    const official = fixture<unknown>('groq-asr', 'transcription-success.json')
    const client = createCapabilityClient({
      runtime: runtime('groq', async () => new Response(JSON.stringify(official.payload), { status: 200 })),
      modules: [createGroqAsrModule(groqWhisperLargeV3Turbo)],
    })

    await expect(client.execute(groqWhisperLargeV3Turbo.id, {
      audio: { kind: 'bytes', bytes: new Uint8Array([1]), mediaType: 'audio/wav' },
    })).resolves.toMatchObject({
      text: 'Your transcribed text appears here...',
      providerMetadata: { x_groq: { id: 'req_unique_id' } },
    })
  })

  it('仅返回顶层 words 时合成一个可移植分段', () => {
    expect(parseGroqTranscription({
      text: 'word only',
      words: [
        { word: 'word', start: 0, end: 0.4 },
        { word: 'only', start: 0.4, end: 0.8 },
      ],
    }).segments).toEqual([{
      text: 'word only',
      startMs: 0,
      endMs: 800,
      words: [
        { text: 'word', startMs: 0, endMs: 400 },
        { text: 'only', startMs: 400, endMs: 800 },
      ],
    }])
  })

  it('远端 URL 直接交给 Groq，不读取宿主媒体；text 响应也可归一化', async () => {
    const fetch = vi.fn(async () => new Response('远端音频转写结果', { status: 200 }))
    const clientRuntime = runtime('groq', fetch)
    clientRuntime.media = { read: vi.fn(async () => { throw new Error('must not read remote URL') }) }
    const client = createCapabilityClient({
      runtime: clientRuntime,
      modules: [createGroqAsrModule(groqWhisperLargeV3)],
    })
    await expect(client.execute(groqWhisperLargeV3.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/test.m4a' },
      options: { responseFormat: 'text' },
    })).resolves.toMatchObject({ text: '远端音频转写结果' })
    const form = formFrom(fetch.mock.calls[0]?.[1])
    expect(form.get('url')).toBe('https://audio.example/test.m4a')
    expect(form.get('file')).toBeNull()
    expect(clientRuntime.media.read).not.toHaveBeenCalled()
  })

  it('供应商错误、非法响应、非法 URL 和本地大小上限均稳定失败', async () => {
    const official = fixture<unknown>('groq-asr', 'transcription-error.json')
    const httpClient = createCapabilityClient({
      runtime: runtime('groq', async () => new Response(JSON.stringify(official.payload), {
        status: official.status ?? 400,
      })),
      modules: [createGroqAsrModule(groqWhisperLargeV3Turbo)],
    })
    await expect(httpClient.execute(groqWhisperLargeV3Turbo.id, {
      audio: { kind: 'bytes', bytes: new Uint8Array([1]), mediaType: 'audio/wav' },
    })).rejects.toMatchObject({ code: 'provider_http_error' })

    const invalidClient = createCapabilityClient({
      runtime: runtime('groq', async () => new Response('{}', { status: 200 })),
      modules: [createGroqAsrModule(groqWhisperLargeV3Turbo)],
    })
    await expect(invalidClient.execute(groqWhisperLargeV3Turbo.id, {
      audio: { kind: 'remote-url', url: 'file:///private/audio.wav' },
    })).rejects.toMatchObject({ code: 'invalid_media_url' })
    await expect(invalidClient.execute(groqWhisperLargeV3Turbo.id, {
      audio: { kind: 'bytes', bytes: new Uint8Array([1, 2]), mediaType: 'audio/wav' },
    })).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(invalidClient.execute(groqWhisperLargeV3Turbo.id, {
      audio: { kind: 'bytes', bytes: new Uint8Array([1]), mediaType: 'audio/wav' },
      language: 1 as unknown as string,
    })).rejects.toMatchObject({ code: 'invalid_parameter' })
    await expect(invalidClient.execute(groqWhisperLargeV3Turbo.id, {
      audio: { kind: 'bytes', bytes: new Uint8Array([1]), mediaType: 'audio/wav' },
      options: null as unknown as Readonly<Record<string, unknown>>,
    })).rejects.toMatchObject({ code: 'invalid_parameter' })
    await expect(invalidClient.execute(groqWhisperLargeV3Turbo.id, {
      audio: { kind: 'bytes', bytes: null as unknown as Uint8Array, mediaType: 'audio/wav' },
    })).rejects.toMatchObject({ code: 'invalid_parameter' })

    const limitedClient = createCapabilityClient({
      runtime: runtime('groq', async () => { throw new Error('network must not run') }),
      modules: [createGroqAsrModule(groqWhisperLargeV3Turbo, { maxFileBytes: 1 })],
    })
    await expect(limitedClient.execute(groqWhisperLargeV3Turbo.id, {
      audio: { kind: 'bytes', bytes: new Uint8Array([1, 2]), mediaType: 'audio/wav' },
    })).rejects.toMatchObject({ code: 'media_too_large' })
  })
})

describe('硅基流动文件 ASR', () => {
  it('只公开 P0 两个官方模型 ID', () => {
    expect(siliconFlowAsrPresets.map((preset) => preset.modelId)).toEqual([
      'FunAudioLLM/SenseVoiceSmall',
      'TeleAI/TeleSpeechASR',
    ])
    expect(siliconFlowAsrPresets.every((preset) => (
      preset.descriptor.providerIds?.[0] === 'siliconflow'
      && preset.descriptor.features?.includes('file-transcription')
    ))).toBe(true)
  })

  it('只发送官方 file/model 字段并保留 trace id', async () => {
    const official = fixture<unknown>('siliconflow', 'transcription-success.json')
    const fetch = vi.fn(async () => new Response(JSON.stringify(official.payload), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-siliconcloud-trace-id': 'fixture-trace-id',
      },
    }))
    const client = createCapabilityClient({
      runtime: runtime('siliconflow', fetch),
      modules: [createSiliconFlowAsrModule(siliconFlowSenseVoiceSmall)],
    })
    const output = await client.execute(siliconFlowSenseVoiceSmall.id, {
      audio: { kind: 'media-ref', ref: 'voice-note' },
      language: 'zh',
      timestamps: true,
    })

    expect(output).toMatchObject({
      text: expect.any(String),
      providerMetadata: { traceId: 'fixture-trace-id' },
    })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.siliconflow.cn/v1/audio/transcriptions')
    const form = formFrom(init)
    expect([...form.keys()].sort()).toEqual(['file', 'model'])
    expect(form.get('model')).toBe('FunAudioLLM/SenseVoiceSmall')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('第二个模型沿用同一协议，远端 URL、错误体和大小上限严格收口', async () => {
    const official = fixture<unknown>('siliconflow', 'transcription-error.json')
    const httpClient = createCapabilityClient({
      runtime: runtime('siliconflow', async () => new Response(JSON.stringify(official.payload), {
        status: official.status ?? 429,
        headers: { 'x-siliconcloud-trace-id': 'error-trace-id' },
      })),
      modules: [createSiliconFlowAsrModule(siliconFlowTeleSpeechAsr)],
    })
    const structuredFailure = await httpClient.execute(siliconFlowTeleSpeechAsr.id, {
      audio: { kind: 'bytes', bytes: new Uint8Array([1]), mediaType: 'audio/wav' },
    }).catch((error: unknown) => error)
    expect(structuredFailure).toMatchObject({ code: 'provider_http_error' })
    expect(structuredFailure).toBeInstanceOf(Error)
    expect((structuredFailure as Error).message).toContain(
      'code=20012; message=Model does not exist. Please check it carefully.; data=null; traceId=error-trace-id'
    )

    const textErrorClient = createCapabilityClient({
      runtime: runtime('siliconflow', async () => new Response('Forbidden', { status: 403 })),
      modules: [createSiliconFlowAsrModule(siliconFlowTeleSpeechAsr)],
    })
    const textFailure = await textErrorClient.execute(siliconFlowTeleSpeechAsr.id, {
      audio: { kind: 'bytes', bytes: new Uint8Array([1]), mediaType: 'audio/wav' },
    }).catch((error: unknown) => error)
    expect(textFailure).toMatchObject({ code: 'provider_http_error' })
    expect(textFailure).toBeInstanceOf(Error)
    expect((textFailure as Error).message).toContain('HTTP 403: Forbidden')

    await expect(httpClient.execute(siliconFlowTeleSpeechAsr.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/test.wav' },
    })).rejects.toMatchObject({ code: 'unsupported_media_source' })
    await expect(httpClient.execute(siliconFlowTeleSpeechAsr.id, {
      audio: { kind: 'bytes', bytes: new Uint8Array([1]), mediaType: 'audio/wav' },
      timestamps: 'yes' as unknown as boolean,
    })).rejects.toMatchObject({ code: 'invalid_parameter' })
    await expect(httpClient.execute(siliconFlowTeleSpeechAsr.id, {
      audio: { kind: 'bytes', bytes: new Uint8Array([1]), mediaType: 'audio/wav' },
      options: null as unknown as Readonly<Record<string, unknown>>,
    })).rejects.toMatchObject({ code: 'invalid_parameter' })
    await expect(httpClient.execute(siliconFlowTeleSpeechAsr.id, {
      audio: { kind: 'media-ref', ref: 1 as unknown as string },
    })).rejects.toMatchObject({ code: 'invalid_parameter' })

    const limitedClient = createCapabilityClient({
      runtime: runtime('siliconflow', async () => { throw new Error('network must not run') }),
      modules: [createSiliconFlowAsrModule(siliconFlowTeleSpeechAsr, { maxFileBytes: 1 })],
    })
    await expect(limitedClient.execute(siliconFlowTeleSpeechAsr.id, {
      audio: { kind: 'bytes', bytes: new Uint8Array([1, 2]), mediaType: 'audio/wav' },
    })).rejects.toMatchObject({ code: 'media_too_large' })
  })
})
