import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { createCapabilityClient } from '../src/capabilities'
import type {
  SpeechRecognitionEvent,
  SpeechRecognitionInput,
} from '../src/capabilities/speech-recognition'
import {
  createVolcengineAsrModule,
  volcengineFileAsrPresets,
  volcengineSeedAsrFile,
} from '../src/capabilities/speech-recognition/volcengine'
import type { RuntimeContext } from '../src/runtime'

interface ConstructedFixture {
  kind: 'capability'
  classification: 'field-construction'
  taskId: string
  file: {
    resourceId: string
    submitUrl: string
    queryUrl: string
    submitBody: unknown
    submitHeaders: Record<string, string>
    queuedHeaders: Record<string, string>
    processingHeaders: Record<string, string>
    successHeaders: Record<string, string>
    successPayload: unknown
  }
}

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/volcengine/${name}`, import.meta.url), 'utf8')) as T
}

function response(body: unknown, headers: Record<string, string>, status = 200): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers })
}

function runtime(fetch: RuntimeContext['transport']['fetch']): RuntimeContext {
  return {
    transport: { fetch },
    credentials: {
      get: async (scope, providerId) => (
        scope === 'speech-recognition' && providerId === 'volcengine' ? 'fixture-api-key' : undefined
      ),
    },
    media: { read: async () => { throw new Error('Volcengine file P0 must not read local media') } },
  }
}

describe('火山 SeedASR 2.0 文件识别', () => {
  it('只公开文件 P0 preset 与稳定模型坐标', () => {
    expect(volcengineFileAsrPresets).toEqual([volcengineSeedAsrFile])
    expect(volcengineSeedAsrFile).toMatchObject({
      id: 'volcengine.speech-recognition.seedasr-2.0-file',
      modelId: 'seedasr-2.0-file',
      descriptor: {
        providerIds: ['volcengine'],
        executionModes: ['request-response'],
      },
    })
  })

  it('按官方 submit/query 状态机发送单 X-Api-Key，构造 audio.url/format/language 并归一化结果', async () => {
    const constructed = fixture<ConstructedFixture>('asr-seedasr-field-construction.json')
    const fetch = vi.fn<RuntimeContext['transport']['fetch']>()
      .mockResolvedValueOnce(response(undefined, constructed.file.submitHeaders))
      .mockResolvedValueOnce(response(undefined, constructed.file.queuedHeaders))
      .mockResolvedValueOnce(response(undefined, constructed.file.processingHeaders))
      .mockResolvedValueOnce(response(constructed.file.successPayload, constructed.file.successHeaders))
    const events: SpeechRecognitionEvent[] = []
    const client = createCapabilityClient({
      runtime: runtime(fetch),
      modules: [createVolcengineAsrModule(volcengineSeedAsrFile, {
        pollIntervalMs: 0,
        requestIdFactory: () => constructed.taskId,
      })],
    })

    const output = await client.execute(volcengineSeedAsrFile.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/meeting.mp3' },
      language: 'zh-CN',
      punctuation: true,
      timestamps: true,
    }, { requestId: 'file-success', onEvent: (event) => { events.push(event) } })

    expect(output).toMatchObject({
      text: '你好世界。',
      durationMs: 1080,
      segments: [{
        text: '你好世界。', startMs: 0, endMs: 1080,
        words: [
          { text: '你好', startMs: 0, endMs: 520 },
          { text: '世界。', startMs: 520, endMs: 1080 },
        ],
      }],
      providerMetadata: { taskId: constructed.taskId, logId: 'fixture-file-query-log-id' },
    })
    expect(events.map((event) => event.type)).toEqual([
      'started', 'processing', 'processing', 'final', 'completed',
    ])
    expect(fetch).toHaveBeenCalledTimes(4)

    const [submitUrl, submitInit] = fetch.mock.calls[0]
    expect(submitUrl).toBe(constructed.file.submitUrl)
    expect(submitInit?.method).toBe('POST')
    expect(JSON.parse(String(submitInit?.body))).toEqual(constructed.file.submitBody)
    const submitHeaders = new Headers(submitInit?.headers)
    expect(submitHeaders.get('X-Api-Key')).toBe('fixture-api-key')
    expect(submitHeaders.get('X-Api-Resource-Id')).toBe(constructed.file.resourceId)
    expect(submitHeaders.get('X-Api-Request-Id')).toBe(constructed.taskId)
    expect(submitHeaders.get('X-Api-Sequence')).toBe('-1')
    expect(submitHeaders.has('X-Api-App-Key')).toBe(false)
    expect(submitHeaders.has('X-Api-Access-Key')).toBe(false)

    for (const [queryUrl, queryInit] of fetch.mock.calls.slice(1)) {
      expect(queryUrl).toBe(constructed.file.queryUrl)
      expect(queryInit?.method).toBe('POST')
      expect(queryInit?.body).toBe('{}')
      const queryHeaders = new Headers(queryInit?.headers)
      expect(queryHeaders.get('X-Api-Key')).toBe('fixture-api-key')
      expect(queryHeaders.get('X-Api-Request-Id')).toBe(constructed.taskId)
      expect(queryHeaders.has('X-Api-App-Key')).toBe(false)
      expect(queryHeaders.has('X-Api-Access-Key')).toBe(false)
    }
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get('X-Tt-Logid')).toBe('fixture-file-log-id')
  })

  it('本地 bytes/media-ref 明确报 unsupported，且不读媒体、不取凭据、不发请求', async () => {
    const fetch = vi.fn<RuntimeContext['transport']['fetch']>()
    const credentials = { get: vi.fn(async () => 'fixture-api-key') }
    const media = { read: vi.fn(async () => { throw new Error('must not read') }) }
    const client = createCapabilityClient({
      runtime: { transport: { fetch }, credentials, media },
      modules: [createVolcengineAsrModule(volcengineSeedAsrFile)],
    })

    await expect(client.execute(volcengineSeedAsrFile.id, {
      audio: { kind: 'bytes', bytes: new Uint8Array([1, 2]), mediaType: 'audio/wav' },
    })).rejects.toMatchObject({ code: 'unsupported_media_source' })
    await expect(client.execute(volcengineSeedAsrFile.id, {
      audio: { kind: 'media-ref', ref: 'local-recording' },
    })).rejects.toMatchObject({ code: 'unsupported_media_source' })
    expect(fetch).not.toHaveBeenCalled()
    expect(credentials.get).not.toHaveBeenCalled()
    expect(media.read).not.toHaveBeenCalled()
  })

  it('只接受官方 raw/wav/mp3/ogg，并把 JSON 中错误 options 类型归一为稳定错误', async () => {
    const fetch = vi.fn<RuntimeContext['transport']['fetch']>()
    const constructed = fixture<ConstructedFixture>('asr-seedasr-field-construction.json')
    const client = createCapabilityClient({
      runtime: runtime(fetch),
      modules: [createVolcengineAsrModule(volcengineSeedAsrFile, {
        requestIdFactory: () => constructed.taskId,
      })],
    })
    await expect(client.execute(volcengineSeedAsrFile.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/a.flac' },
    })).rejects.toMatchObject({ code: 'unsupported_audio_format' })
    await expect(client.execute(volcengineSeedAsrFile.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/a.wav' },
      options: { format: 'aac' },
    })).rejects.toMatchObject({ code: 'unsupported_audio_format' })
    await expect(client.execute(volcengineSeedAsrFile.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/a.wav' },
      options: { enableDdc: 'yes' },
    } as unknown as SpeechRecognitionInput)).rejects.toMatchObject({ code: 'invalid_parameter' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('终态错误、缺失状态头和成功空文本均严格失败', async () => {
    const constructed = fixture<ConstructedFixture>('asr-seedasr-field-construction.json')
    const negative = fixture<{ terminalFileError: Record<string, string> }>('asr-seedasr-synthetic.json')

    const terminalFetch = vi.fn<RuntimeContext['transport']['fetch']>()
      .mockResolvedValueOnce(response(undefined, constructed.file.submitHeaders))
      .mockResolvedValueOnce(response(undefined, negative.terminalFileError))
    const terminalClient = createCapabilityClient({
      runtime: runtime(terminalFetch),
      modules: [createVolcengineAsrModule(volcengineSeedAsrFile, {
        requestIdFactory: () => constructed.taskId,
      })],
    })
    await expect(terminalClient.execute(volcengineSeedAsrFile.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/a.wav' },
    })).rejects.toMatchObject({
      code: 'provider_task_failed',
      message: expect.stringContaining('45000002'),
    })

    const missingHeaderClient = createCapabilityClient({
      runtime: runtime(async () => new Response('', { status: 200 })),
      modules: [createVolcengineAsrModule(volcengineSeedAsrFile, {
        requestIdFactory: () => constructed.taskId,
      })],
    })
    await expect(missingHeaderClient.execute(volcengineSeedAsrFile.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/a.wav' },
    })).rejects.toMatchObject({ code: 'invalid_response' })

    const emptyTextFetch = vi.fn<RuntimeContext['transport']['fetch']>()
      .mockResolvedValueOnce(response(undefined, constructed.file.submitHeaders))
      .mockResolvedValueOnce(response({ audio_info: { duration: 0 }, result: { text: '' } }, constructed.file.successHeaders))
    const emptyTextClient = createCapabilityClient({
      runtime: runtime(emptyTextFetch),
      modules: [createVolcengineAsrModule(volcengineSeedAsrFile, {
        requestIdFactory: () => constructed.taskId,
      })],
    })
    await expect(emptyTextClient.execute(volcengineSeedAsrFile.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/a.wav' },
    })).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('轮询取消只停止本地查询，不额外发请求', async () => {
    const constructed = fixture<ConstructedFixture>('asr-seedasr-field-construction.json')
    const fetch = vi.fn<RuntimeContext['transport']['fetch']>()
      .mockResolvedValueOnce(response(undefined, constructed.file.submitHeaders))
      .mockResolvedValueOnce(response(undefined, constructed.file.queuedHeaders))
    const controller = new AbortController()
    const client = createCapabilityClient({
      runtime: runtime(fetch),
      modules: [createVolcengineAsrModule(volcengineSeedAsrFile, {
        pollIntervalMs: 10_000,
        requestIdFactory: () => constructed.taskId,
      })],
    })
    const execution = client.execute(volcengineSeedAsrFile.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/a.wav' },
    }, {
      signal: controller.signal,
      onEvent: (event) => { if (event.type === 'processing') controller.abort() },
    })
    await expect(execution).rejects.toMatchObject({ code: 'cancelled' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
