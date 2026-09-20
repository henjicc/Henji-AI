import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createCapabilityClient } from '../src/capabilities'
import { bailianNonRealtimeAsrPresets, createBailianAsrModule } from '../src/capabilities/speech-recognition/bailian'
import { groqAsrPresets, createGroqAsrModule } from '../src/capabilities/speech-recognition/groq'
import { siliconFlowAsrPresets, createSiliconFlowAsrModule } from '../src/capabilities/speech-recognition/siliconflow'
import { assertMediaSize, resolveRuntimeContext, type RuntimeContext } from '../src/runtime'
import { prepareMedia, jsonAudioRequest, multipartAudioRequest, sendMediaRequest } from '../src/capabilities/media-request'
import { resolveAsyncAudioUrl } from '../src/capabilities/speech-recognition/bailian/upload'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')).payload
}
function json(value: unknown): Response { return new Response(JSON.stringify(value)) }
function runtime(size: number): RuntimeContext {
  return {
    credentials: { get: async () => 'test-key' },
    media: {
      read: vi.fn(async () => { throw new Error('whole-file read forbidden') }),
      describe: vi.fn(async () => ({ size, mimeType: 'audio/wav', filename: '测试.wav' })),
      readChunk: vi.fn(async (_ref, offset, length) => {
        expect(length).toBeLessThanOrEqual(65536)
        return Uint8Array.from({ length: Math.min(length, size - offset) }, (_, i) => (offset + i) % 251)
      }),
    },
    transport: { fetch: vi.fn(async () => { throw new Error('unexpected buffered fetch') }) },
  }
}
const audio = { kind: 'media-ref' as const, ref: 'scoped-audio' }

describe('ASR bounded media requests', () => {
  it('Fun-ASR Flash accepts >10 MiB without restoring the obsolete whole-file guard', async () => {
    const preset = bailianNonRealtimeAsrPresets[0]
    const rt = runtime(11 * 1024 * 1024)
    rt.transport.fetchStream = async (_url, init) => {
      let size = 0
      for await (const chunk of init.body) { expect(chunk.length).toBeLessThanOrEqual(65536); size += chunk.length }
      expect(size).toBe(init.contentLength)
      return new Response(fixture('bailian/asr-fun-short-sse.json') as string)
    }
    await createCapabilityClient({ runtime: rt, modules: [createBailianAsrModule(preset)] }).execute(preset.id, { audio })
    expect(rt.media.read).not.toHaveBeenCalled()
  })
  for (const preset of bailianNonRealtimeAsrPresets.filter(p => p.protocol !== 'file-async')) {
    it(`${preset.modelId}: lazy base64 JSON matches bytes across short reads`, async () => {
      const rt = runtime(100007)
      // Irregular short reads must not pad base64 in the middle or skip bytes.
      rt.media.readChunk = vi.fn(async (_ref, offset, length) => Uint8Array.from(
        { length: Math.min(length, 17003, 100007 - offset) }, (_, i) => (offset + i) % 251
      ))
      rt.transport.fetchStream = async (_url, init) => {
        expect(rt.media.readChunk).not.toHaveBeenCalled()
        const chunks = []
        for await (const chunk of init.body) chunks.push(Buffer.from(chunk))
        const body = Buffer.concat(chunks)
        expect(body.length).toBe(init.contentLength)
        const request = JSON.parse(body.toString())
        const messages = request.messages ?? request.input.messages
        const data = messages[0].content.at(-1).input_audio.data
        expect(Buffer.from(data.split(',')[1], 'base64')).toEqual(Buffer.from(Uint8Array.from({ length: 100007 }, (_, i) => i % 251)))
        return preset.protocol === 'fun-short-sse'
          ? new Response(fixture('bailian/asr-fun-short-sse.json') as string)
          : json(fixture('bailian/asr-qwen-short.json'))
      }
      const client = createCapabilityClient({ runtime: rt, modules: [createBailianAsrModule(preset)] })
      await client.execute(preset.id, { audio, options: { context: '中文提示' } })
      expect(rt.media.read).not.toHaveBeenCalled()
    })
  }

  const multipartModules = [
    ...groqAsrPresets.map(p => createGroqAsrModule(p)),
    ...siliconFlowAsrPresets.map(p => createSiliconFlowAsrModule(p)),
  ]
  for (const module of multipartModules) {
    it(`${module.descriptor.id}: >10 MiB streams without a whole-file allocation`, async () => {
      const size = 11 * 1024 * 1024 + 7
      const rt = runtime(size)
      rt.transport.fetchStream = async (_url, init) => {
        expect(rt.media.readChunk).not.toHaveBeenCalled()
        let received = 0
        let count = 0
        for await (const chunk of init.body) {
          expect(chunk.byteLength).toBeLessThanOrEqual(65536)
          received += chunk.length
          count++
        }
        expect(received).toBe(init.contentLength)
        expect(received).toBeGreaterThan(size)
        expect(count).toBeGreaterThan(170)
        return json(fixture(module.descriptor.id.startsWith('groq')
          ? 'groq-asr/transcription-success.json' : 'siliconflow/transcription-success.json'))
      }
      await createCapabilityClient({ runtime: rt, modules: [module] }).execute(module.descriptor.id, { audio })
      expect(rt.media.read).not.toHaveBeenCalled()
    })
  }

  for (const preset of bailianNonRealtimeAsrPresets.filter(p => p.protocol === 'file-async')) {
    it(`${preset.modelId}: native OSS upload never touches any media API`, async () => {
      const rt = runtime(200_000_000)
      rt.media.describe = vi.fn(async () => { throw new Error('media channel forbidden') })
      rt.transport.fetch = async (url, init) => {
        if (url.includes('/uploads?')) return json({ data: {
          upload_host: 'https://oss.example/upload', upload_dir: 'tmp', max_file_size_mb: '100',
          oss_access_key_id: 'key', signature: 'signature', policy: 'policy',
          x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true',
        } })
        if (url.includes('/services/audio/')) {
          expect(new Headers(init?.headers).get('X-DashScope-OssResourceResolve')).toBe('enable')
          expect(JSON.parse(String(init?.body)).input).toEqual(preset.asyncInputField === 'file_url'
            ? { file_url: expect.stringMatching(/^oss:\/\/tmp\//) }
            : { file_urls: [expect.stringMatching(/^oss:\/\/tmp\//)] })
          return json(fixture('bailian/asr-file-succeeded.json'))
        }
        return json(fixture('bailian/asr-file-result.json'))
      }
      rt.transport.uploadFile = vi.fn(async (_url, init) => {
        expect(init.maxBytes).toBe(100_000_000)
        expect(init.ref).toBe(audio.ref)
        return new Response('')
      })
      await createCapabilityClient({ runtime: rt, modules: [createBailianAsrModule(preset)] }).execute(preset.id, { audio })
      expect(rt.transport.uploadFile).toHaveBeenCalledOnce()
      expect(rt.media.read).not.toHaveBeenCalled()
      expect(rt.media.describe).not.toHaveBeenCalled()
      expect(rt.media.readChunk).not.toHaveBeenCalled()
    })
  }

  it('size preflight preserves bytes/limit/PCM duration before any body read or request', async () => {
    const rt = runtime(20_000_000)
    rt.media.describe = async () => ({ size: 20_000_000, mimeType: 'audio/pcm', filename: 'audio.pcm',
      audio: { sampleRateHz: 16000, channels: 1, bitsPerSample: 16 } })
    await expect(prepareMedia(audio, resolveRuntimeContext(rt), 10_000_000, new AbortController().signal))
      .rejects.toMatchObject({ code: 'media_too_large', details: {
        actualBytes: 20_000_000, maxBytes: 10_000_000, estimatedDurationSeconds: 625, sampleRateHz: 16000,
      } })
    expect(rt.media.readChunk).not.toHaveBeenCalled()
    expect(rt.transport.fetch).not.toHaveBeenCalled()
    expect(() => assertMediaSize({ size: 10, mimeType: 'audio/mpeg', filename: 'a.mp3' }, 9))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ estimatedDurationSeconds: null }) }))
  })

  it('rejects truncated chunks and stops reads on cancellation', async () => {
    const rt = runtime(100_000)
    rt.transport.fetchStream = vi.fn()
    const abort = new AbortController()
    const media = await prepareMedia(audio, resolveRuntimeContext(rt), 200_000, abort.signal)
    const iterator = media.chunks[Symbol.asyncIterator]()
    await iterator.next()
    abort.abort()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'cancelled' })
    expect(rt.media.readChunk).toHaveBeenCalledOnce()
    rt.media.readChunk = async () => new Uint8Array(0)
    const truncated = await prepareMedia(audio, resolveRuntimeContext(rt), 200_000, new AbortController().signal)
    await expect(truncated.chunks[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'invalid_media_chunk' })
  })

  it('does not fall back to whole-file reads if request streaming is missing', async () => {
    const rt = runtime(100)
    await expect(prepareMedia(audio, resolveRuntimeContext(rt), 200, new AbortController().signal))
      .rejects.toMatchObject({ code: 'streaming_upload_unsupported' })
    expect(rt.media.read).not.toHaveBeenCalled()
  })

  it('base64 handles final 1/2 byte tails and marker-like user content', async () => {
    for (const size of [1, 2, 3, 4, 5]) {
      const rt = runtime(size)
      rt.transport.fetchStream = vi.fn()
      const media = await prepareMedia(audio, resolveRuntimeContext(rt), 100, new AbortController().signal)
      const request = jsonAudioRequest(media, data => ({ user: '__sdk_audio_payload__', data }))
      const chunks = []
      for await (const chunk of request.body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      expect(body.length).toBe(request.contentLength)
      expect(JSON.parse(body.toString()).data).toBe(`data:audio/wav;base64,${Buffer.from(Array.from({ length: size }, (_, i) => i)).toString('base64')}`)
    }
  })

  it('multipart wire format preserves fields, repeated timestamps, Unicode and exact file bytes', async () => {
    const rt = runtime(100007)
    rt.transport.fetchStream = vi.fn()
    const media = await prepareMedia(audio, resolveRuntimeContext(rt), 200000, new AbortController().signal)
    const request = multipartAudioRequest(media, [['prompt', '中文'], ['timestamp_granularities[]', 'word'], ['timestamp_granularities[]', 'segment']])
    const chunks = []
    for await (const chunk of request.body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.contentType! } }).formData()
    expect(form.get('prompt')).toBe('中文')
    expect(form.getAll('timestamp_granularities[]')).toEqual(['word', 'segment'])
    const file = form.get('file') as File
    expect(file.name).toBe('测试.wav')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(Uint8Array.from({ length: 100007 }, (_, i) => i % 251))
  })

  it('Qwen rejects a raw payload whose base64 exceeds 10 MB before any read', async () => {
    const preset = bailianNonRealtimeAsrPresets.find(p => p.protocol === 'qwen-short')!
    const rt = runtime(7_500_001)
    await expect(createCapabilityClient({ runtime: rt, modules: [createBailianAsrModule(preset)] }).execute(preset.id, { audio }))
      .rejects.toMatchObject({ code: 'media_too_large', details: { actualBytes: 7_500_001, maxBytes: 7_500_000 } })
    expect(rt.media.readChunk).not.toHaveBeenCalled()
  })

  it('preserves a structured RPC size error even when describe refuses the file', async () => {
    const rt = runtime(20_000_000)
    rt.media.describe = async () => { throw { code: 'media_too_large', details: { actualBytes: 20_000_000, maxBytes: 10_000_000, estimatedDurationSeconds: 625 } } }
    const preset = bailianNonRealtimeAsrPresets[0]
    await expect(createCapabilityClient({ runtime: rt, modules: [createBailianAsrModule(preset)] }).execute(preset.id, { audio }))
      .rejects.toMatchObject({ code: 'media_too_large', details: { actualBytes: 20_000_000, maxBytes: 10_000_000, estimatedDurationSeconds: 625 } })
  })

  it('closes body iterator when transport fails and never replays', async () => {
    let closed = false
    const rt = runtime(1)
    rt.transport.fetchStream = vi.fn(async (_url, init) => {
      await init.body[Symbol.asyncIterator]().next()
      throw new Error('connection lost')
    })
    const body = (async function* () { try { yield new Uint8Array(1); yield new Uint8Array(1) } finally { closed = true } })()
    await expect(sendMediaRequest(resolveRuntimeContext(rt), 'https://example.invalid', {}, { body, contentLength: 2 })).rejects.toThrow('connection lost')
    expect(closed).toBe(true)
    expect(rt.transport.fetchStream).toHaveBeenCalledOnce()
  })

  it.each([100, '100', 2000])('native upload enforces policy %s and the 1 GB temporary ceiling', async limit => {
    const rt = runtime(0)
    const policy = fixture('bailian/asr-upload-policy.json') as { data: Record<string, unknown> }
    policy.data.max_file_size_mb = limit
    rt.transport.fetch = async () => json(policy)
    rt.transport.uploadFile = vi.fn(async (_url, init) => {
      expect(init.maxBytes).toBe(Math.min(Number(limit) * 1_000_000, 1_000_000_000))
      throw { code: 'media_too_large', details: { actualBytes: 2_000_000_000, maxBytes: init.maxBytes } }
    })
    await expect(resolveAsyncAudioUrl(audio, 'fun-asr', 'key', 'https://api.example', {
      runtime: resolveRuntimeContext(rt), requestId: 'test', signal: new AbortController().signal, emit: async () => {},
    })).rejects.toMatchObject({ code: 'media_too_large', details: { actualBytes: 2_000_000_000 } })
    expect(rt.media.read).not.toHaveBeenCalled()
    expect(rt.media.describe).not.toHaveBeenCalled()
  })

  it('invalid upload policy stops before native upload; missing native support never falls back', async () => {
    const rt = runtime(1)
    const context = { runtime: resolveRuntimeContext(rt), requestId: 'test', signal: new AbortController().signal, emit: async () => {} }
    await expect(resolveAsyncAudioUrl(audio, 'fun-asr', 'key', 'https://api.example', context))
      .rejects.toMatchObject({ code: 'native_upload_unsupported' })
    const policy = fixture('bailian/asr-upload-policy.json') as { data: Record<string, unknown> }
    policy.data.max_file_size_mb = 'invalid'
    rt.transport.fetch = async () => json(policy)
    rt.transport.uploadFile = vi.fn()
    await expect(resolveAsyncAudioUrl(audio, 'fun-asr', 'key', 'https://api.example', context))
      .rejects.toMatchObject({ code: 'invalid_response' })
    expect(rt.transport.uploadFile).not.toHaveBeenCalled()
    expect(rt.media.read).not.toHaveBeenCalled()
  })
})
