import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { createCapabilityClient } from '../src/capabilities'
import type { SpeechRecognitionEvent } from '../src/capabilities/speech-recognition'
import {
  bailianFunAsr,
  bailianFunAsrFlash20260615,
  bailianNonRealtimeAsrPresets,
  bailianQwen3AsrFlash,
  bailianQwen3AsrFlashFiletrans,
  createBailianAsrModule,
} from '../src/capabilities/speech-recognition/bailian'
import type { RuntimeContext } from '../src/runtime'

interface Fixture<T> {
  kind: 'capability'
  source: string
  payload: T
}

function fixture<T>(name: string): Fixture<T> {
  return JSON.parse(readFileSync(new URL(`./fixtures/bailian/${name}`, import.meta.url), 'utf8')) as Fixture<T>
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json' },
  })
}

function runtime(fetch: RuntimeContext['transport']['fetch']): RuntimeContext {
  return {
    transport: { fetch },
    credentials: { get: async (scope, providerId) =>
      scope === 'speech-recognition' && providerId === 'bailian' ? 'fixture-key' : undefined },
    media: { read: async (ref) => ({
      bytes: new Uint8Array([82, 73, 70, 70]), mimeType: 'audio/wav', filename: `${ref}.wav`,
    }) },
  }
}

const bytesInput = {
  audio: { kind: 'bytes' as const, bytes: new Uint8Array([1, 2, 3]), mediaType: 'audio/wav', filename: 'test.wav' },
}

describe('百炼非实时 ASR 按需模块', () => {
  it('只公开 Say-It 使用的 5 个非实时模型，不包含实时协议', () => {
    expect(bailianNonRealtimeAsrPresets.map((preset) => preset.modelId)).toEqual([
      'fun-asr-flash-2026-06-15',
      'qwen3-asr-flash',
      'qwen3-asr-flash-2026-02-10',
      'fun-asr',
      'qwen3-asr-flash-filetrans',
    ])
    expect(bailianNonRealtimeAsrPresets.every((preset) => preset.protocol !== 'realtime')).toBe(true)
  })

  it('Fun-ASR SSE 累计回显去重并归一化句级时间戳', async () => {
    const official = fixture<string>('asr-fun-short-sse.json')
    const fetch = vi.fn(async () => new Response(official.payload, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const events: SpeechRecognitionEvent[] = []
    const client = createCapabilityClient({ runtime: runtime(fetch), modules: [createBailianAsrModule(bailianFunAsrFlash20260615)] })
    const output = await client.execute(bailianFunAsrFlash20260615.id, bytesInput, { onEvent: (event) => { events.push(event) } })

    expect(output).toMatchObject({
      text: '你好世界', durationMs: 2000,
      segments: [
        { text: '你好', startMs: 0, endMs: 520 },
        { text: '世界', startMs: 520, endMs: 1080 },
      ],
    })
    const [, init] = fetch.mock.calls[0]
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ model: 'fun-asr-flash-2026-06-15' })
    expect(init?.headers).toMatchObject({ 'X-DashScope-SSE': 'enable' })
    expect(events.map((event) => event.type)).toEqual(['final', 'final', 'completed'])
  })

  it('Qwen 短音频使用兼容接口，支持 HTTP URL 且不会读取宿主媒体', async () => {
    const official = fixture<unknown>('asr-qwen-short.json')
    const mediaRead = vi.fn(async () => { throw new Error('remote URL must not be read') })
    const fetch = vi.fn(async () => json(official.payload))
    const clientRuntime = runtime(fetch)
    clientRuntime.media = { read: mediaRead }
    const client = createCapabilityClient({ runtime: clientRuntime, modules: [createBailianAsrModule(bailianQwen3AsrFlash)] })
    const output = await client.execute(bailianQwen3AsrFlash.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/test.mp3', mediaType: 'audio/mpeg' },
      language: 'zh', options: { enableItn: true },
    })

    expect(output.text).toBe('这是一段测试音频。')
    expect(mediaRead).not.toHaveBeenCalled()
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'qwen3-asr-flash', asr_options: { language: 'zh', enable_itn: true },
    })
  })

  it('文件转写经历 PENDING/RUNNING/SUCCEEDED，下载结果并归一化词句时间戳', async () => {
    const submit = fixture<unknown>('asr-file-submit.json').payload
    const running = fixture<unknown>('asr-file-running.json').payload
    const succeeded = fixture<unknown>('asr-file-succeeded.json').payload
    const result = fixture<unknown>('asr-file-result.json').payload
    const queue = [json(submit), json(running), json(succeeded), json(result)]
    const fetch = vi.fn(async () => {
      const next = queue.shift()
      if (!next) throw new Error('unexpected fetch')
      return next
    })
    const events: SpeechRecognitionEvent[] = []
    const module = createBailianAsrModule(bailianFunAsr, { pollIntervalMs: 0, maxPollingMs: 1_000 })
    const client = createCapabilityClient({ runtime: runtime(fetch), modules: [module] })
    const output = await client.execute(bailianFunAsr.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/long.wav' }, timestamps: true,
    }, { onEvent: (event) => { events.push(event) } })

    expect(output).toMatchObject({
      text: '你好世界', durationMs: 1080,
      segments: [{ text: '你好', startMs: 0, endMs: 520 }, { text: '世界', startMs: 520, endMs: 1080 }],
    })
    expect(events.map((event) => event.type)).toEqual([
      'started', 'processing', 'processing', 'final', 'final', 'completed',
    ])
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription',
      'https://dashscope.aliyuncs.com/api/v1/tasks/fixture_task_001',
      'https://dashscope.aliyuncs.com/api/v1/tasks/fixture_task_001',
      'https://fixture.invalid/transcription.json',
    ])
  })

  it('本地文件先取官方上传策略再传 OSS，并只向转写请求暴露 oss:// 引用', async () => {
    const submit = fixture<unknown>('asr-file-submit.json').payload
    const succeeded = fixture<unknown>('asr-file-succeeded.json').payload
    const result = fixture<unknown>('asr-file-result.json').payload
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/uploads?action=getPolicy')) return json({ data: {
        upload_host: 'https://oss.example/upload', upload_dir: 'tmp/redacted', policy: 'policy-redacted',
        signature: 'signature-redacted', oss_access_key_id: 'access-redacted',
        x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true', max_file_size_mb: 10,
      } })
      if (url === 'https://oss.example/upload') {
        expect(init?.body).toBeInstanceOf(FormData)
        return new Response('', { status: 200 })
      }
      if (url.endsWith('/services/audio/asr/transcription')) {
        expect(init?.headers).toMatchObject({ 'X-DashScope-OssResourceResolve': 'enable' })
        const body = JSON.parse(String(init?.body)) as { input: { file_url: string } }
        expect(body.input.file_url).toMatch(/^oss:\/\/tmp\/redacted\//)
        return json(submit)
      }
      if (url.includes('/tasks/')) return json(succeeded)
      if (url === 'https://fixture.invalid/transcription.json') return json(result)
      throw new Error(`unexpected URL ${url}`)
    })
    const module = createBailianAsrModule(bailianQwen3AsrFlashFiletrans, { pollIntervalMs: 0 })
    const client = createCapabilityClient({ runtime: runtime(fetch), modules: [module] })
    await expect(client.execute(bailianQwen3AsrFlashFiletrans.id, {
      audio: { kind: 'media-ref', ref: 'tauri://recording' },
    }, { requestId: 'upload-safe-id' })).resolves.toMatchObject({ text: '你好世界' })
  })

  it('成功任务中的失败子任务不会被误判为成功', async () => {
    const submit = fixture<unknown>('asr-file-submit.json').payload
    const failed = fixture<unknown>('asr-file-failed.json').payload
    const queue = [json(submit), json(failed)]
    const client = createCapabilityClient({
      runtime: runtime(async () => queue.shift() ?? json({})),
      modules: [createBailianAsrModule(bailianFunAsr, { pollIntervalMs: 0 })],
    })
    await expect(client.execute(bailianFunAsr.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/failure.wav' },
    })).rejects.toMatchObject({ code: 'provider_task_failed' })
  })

  it('处理中任务可取消，轮询上限可稳定收口为 timeout', async () => {
    const submit = fixture<unknown>('asr-file-submit.json').payload
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (fetch.mock.calls.length === 1) return json(submit)
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })
    const client = createCapabilityClient({
      runtime: runtime(fetch),
      modules: [createBailianAsrModule(bailianFunAsr, { pollIntervalMs: 0 })],
    })
    const pending = client.execute(bailianFunAsr.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/cancel.wav' },
    }, { requestId: 'cancel-file-asr' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    client.cancel('cancel-file-asr')
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })

    const timeoutClient = createCapabilityClient({
      runtime: runtime(async () => json(submit)),
      modules: [createBailianAsrModule(bailianFunAsr, { pollIntervalMs: 0, maxPollingMs: 0 })],
    })
    await expect(timeoutClient.execute(bailianFunAsr.id, {
      audio: { kind: 'remote-url', url: 'https://audio.example/timeout.wav' },
    })).rejects.toMatchObject({ code: 'timeout' })
  })

  it('非法 JSON、缺失转写文本和不安全 URL 均拒绝为稳定错误', async () => {
    const invalidJson = createCapabilityClient({
      runtime: runtime(async () => new Response('{invalid', { status: 200 })),
      modules: [createBailianAsrModule(bailianQwen3AsrFlash)],
    })
    await expect(invalidJson.execute(bailianQwen3AsrFlash.id, bytesInput))
      .rejects.toMatchObject({ code: 'invalid_response' })

    const missingText = createCapabilityClient({
      runtime: runtime(async () => json({ choices: [{ message: {} }] })),
      modules: [createBailianAsrModule(bailianQwen3AsrFlash)],
    })
    await expect(missingText.execute(bailianQwen3AsrFlash.id, bytesInput))
      .rejects.toMatchObject({ code: 'invalid_response' })

    const unsafeUrl = createCapabilityClient({
      runtime: runtime(async () => { throw new Error('network must not run') }),
      modules: [createBailianAsrModule(bailianQwen3AsrFlash)],
    })
    await expect(unsafeUrl.execute(bailianQwen3AsrFlash.id, {
      audio: { kind: 'remote-url', url: 'file:///private/audio.wav' },
    })).rejects.toMatchObject({ code: 'invalid_media_url' })
  })
})
