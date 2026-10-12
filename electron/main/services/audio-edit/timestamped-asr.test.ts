import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeContext, SpeechRecognitionEvent } from '@henjicc/ai-sdk'

vi.mock('../keystore', () => ({ getAiProviderApiKey: () => undefined }))
vi.mock('../ai-runtime/native-file-upload', () => ({ scopedUploadFile: vi.fn(async (ref: string) => ref) }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('../ai-runtime/sdk-runtime', () => ({ sdkRuntimeContext: { transport: { fetch: async () => { throw new Error('REAL_NETWORK_FORBIDDEN') } }, credentials: { get: () => undefined }, media: { read: async () => { throw new Error('REAL_MEDIA_FORBIDDEN') } } } }))

import { createTimestampedAsrService } from './timestamped-asr'

function fixture(directory: string, name: string): unknown {
  const text = readFileSync(path.resolve('packages/ai-sdk/tests/fixtures', directory, name), 'utf8')
  return (JSON.parse(text) as { payload: unknown }).payload
}
function json(value: unknown): Response { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }) }
function runtime(fetch: RuntimeContext['transport']['fetch']): RuntimeContext {
  return { transport: { fetch }, credentials: { get: () => 'fixture-key' },
    media: { read: async () => ({ bytes: new Uint8Array([82, 73, 70, 70]), mimeType: 'audio/wav', filename: 'fixture.wav' }) } }
}
const context = (): { requestId: string; signal: AbortSignal } => ({ requestId: 'fixture-transcription', signal: new AbortController().signal })

describe('共用 SDK 带时间转写（零网络替身 transport）', () => {
  it('预检拒绝缺凭据、缺原生直传与不可读素材，始终不请求供应商', async () => {
    const fetch = vi.fn()
    const media = vi.fn().mockRejectedValue(new Error('unreadable'))
    const input = { sourcePath: 'voice.wav', durationMs: 1000, modelId: 'bailian.speech-recognition.fun-asr' }
    await expect(createTimestampedAsrService(runtime(fetch), () => false, media).preflight(input)).rejects.toThrow('ASR_MODEL_UNAVAILABLE')
    await expect(createTimestampedAsrService(runtime(fetch), () => true, media).preflight(input)).rejects.toThrow('宿主未提供本地文件直传')
    const rt = runtime(fetch); rt.transport.uploadFile = vi.fn()
    await expect(createTimestampedAsrService(rt, () => true, media).preflight(input)).rejects.toThrow('unreadable')
    media.mockResolvedValue('voice.wav')
    await expect(createTimestampedAsrService(rt, () => true, media).preflight(input)).resolves.toEqual({ modelId: input.modelId })
    expect(fetch).not.toHaveBeenCalled(); expect(rt.transport.uploadFile).not.toHaveBeenCalled()
  })
  it('Groq 字段构造 fixture 的秒由 SDK 变为毫秒，明确同时请求 word+segment', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData
      expect(form.getAll('timestamp_granularities[]')).toEqual(['word', 'segment'])
      expect(form.get('response_format')).toBe('verbose_json')
      return json(fixture('groq-asr', 'transcription-verbose.json'))
    })
    const service = createTimestampedAsrService(runtime(fetch), (id) => id === 'groq')
    expect(service.listModels()).toHaveLength(7)
    expect(service.listModels().every((model) => model.timestamps && model.localAudio)).toBe(true)
    expect(service.listModels().filter((model) => model.configured)).toHaveLength(2)
    const plan = service.prepare({ audioPath: 'recording.wav', durationMs: 2_400 })
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.cost)).toBe(true)
    expect(plan.cost).toEqual({ status: 'unknown', amount: null, currency: null })
    expect(await service.execute(plan, context())).toMatchObject({ unit: 'ms', granularity: 'word', words: [{ startMs: 0, endMs: 1_100 }, { startMs: 1_100, endMs: 2_400 }] })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each(['qwen3-asr-flash-filetrans', 'fun-asr'])('百炼 %s 复用官方上传与文件 fixture；Qwen 打开 enable_words', async (modelId) => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/uploads?action=getPolicy')) return json({ data: { upload_host: 'https://oss.invalid/', upload_dir: 'tmp/fixture', policy: 'fixture', signature: 'fixture', oss_access_key_id: 'fixture', x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true', max_file_size_mb: 10 } })
      if (url.endsWith('/services/audio/asr/transcription')) {
        const body = JSON.parse(String(init?.body)) as { parameters: Record<string, unknown> }
        if (modelId === 'qwen3-asr-flash-filetrans') expect(body.parameters.enable_words).toBe(true)
        return json({ output: { task_id: 'fixture-task', task_status: 'SUCCEEDED', results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'https://result.invalid/' }] } })
      }
      if (url === 'https://result.invalid/') return json(fixture('bailian', 'asr-file-result.json'))
      throw new Error(`UNEXPECTED_FIXTURE_REQUEST:${url}`)
    })
    const inputRuntime = runtime(fetch)
    inputRuntime.media.read = async () => { throw new Error('本地文件应使用流式上传') }
    inputRuntime.transport.uploadFile = vi.fn(async (_url, request) => {
      expect(request.ref).toBe('recording.wav')
      return new Response('', { status: 200 })
    })
    const service = createTimestampedAsrService(inputRuntime, (id) => id === 'bailian')
    const plan = service.prepare({ modelId: `bailian.speech-recognition.${modelId}`, audioPath: 'recording.wav', durationMs: 1_080 })
    const output = await service.execute(plan, context())
    expect(output).toMatchObject({ text: '你好世界', words: [{ startMs: 0, endMs: 520 }, { startMs: 520, endMs: 1_080 }] })
    expect(inputRuntime.transport.uploadFile).toHaveBeenCalledTimes(1)
  })
  it('明确选择失效、仅文本或远端输入模型时拒绝，不偷偷换模型', () => {
    const fetch = vi.fn(async () => json({}))
    const service = createTimestampedAsrService(runtime(fetch), () => true)
    for (const modelId of ['missing', 'bailian.speech-recognition.qwen3-asr-flash', 'volcengine.speech-recognition.seedasr-2.0-file']) {
      expect(() => service.prepare({ modelId, audioPath: 'recording.wav', durationMs: 1_000 })).toThrow('ASR_MODEL_UNAVAILABLE')
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('开始任务冻结模型；后续默认策略改变不会切换已冻结模型', async () => {
    const fetch = vi.fn(async () => json(fixture('groq-asr', 'transcription-verbose.json')))
    const service = createTimestampedAsrService(runtime(fetch), () => true)
    const plan = service.prepare({ providerId: 'groq', audioPath: 'recording.wav', durationMs: 2_400 })
    const next = service.prepare({ providerId: 'bailian', audioPath: 'recording.wav', durationMs: 2_400 })
    expect(plan.modelId).not.toBe(next.modelId)
    await service.execute(plan, context())
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toContain('api.groq.com')
  })
  it('取消到达 SDK transport；提交结果未知不自动重试', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      controller.abort()
      expect(init?.signal?.aborted).toBe(true)
      throw new Error('unknown submit result')
    })
    const service = createTimestampedAsrService(runtime(fetch), (id) => id === 'groq')
    const plan = service.prepare({ audioPath: 'recording.wav', durationMs: 2_400 })
    await expect(service.execute(plan, { ...context(), signal: controller.signal })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(service.execute(plan, { ...context(), signal: controller.signal })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('SDK 文件恢复只查询既有任务，不上传或重新付费提交', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).not.toBe('POST')
      if (url.endsWith('/tasks/existing-task')) return json({ output: { task_id: 'existing-task', task_status: 'SUCCEEDED', results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'https://result.invalid/' }] } })
      if (url === 'https://result.invalid/') return json(fixture('bailian', 'asr-file-result.json'))
      throw new Error('UNEXPECTED_RESUBMIT')
    })
    const service = createTimestampedAsrService(runtime(fetch), (id) => id === 'bailian')
    const plan = service.prepare({ modelId: 'bailian.speech-recognition.fun-asr', audioPath: 'recording.wav', durationMs: 1_080 })
    const events: SpeechRecognitionEvent[] = []
    await service.execute(plan, { ...context(), resumeTaskId: 'existing-task', onEvent: (event) => { events.push(event) } })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(events.some((event) => event.type === 'started')).toBe(true)
  })
})
