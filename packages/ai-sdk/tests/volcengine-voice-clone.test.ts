import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiRuntimeError } from '../src/runtime/AiRuntimeError'
import fixture from './fixtures/volcengine-speech/voice-clone.json'
import { volcengineSeedIcl20Model as model } from '../src/catalog/volcengine-speech/seed-icl-2.0.model'
import { execute, continuePolling } from '../src/providers/volcengine-speech'
import { fakeRuntimeContext } from './providers/test-helpers'
import type { JsonObject, ProviderExecutionInput } from '../src/types/runtime'

const response = (body: unknown) => new Response(JSON.stringify(body))
const build = (extra: JsonObject = {}) => model.request!.builder!({ prompt: '你好，欢迎试听。', volcIclMode: 'clone', volcCloneName: '我的声音', volcCloneAudio: ['data:audio/wav;base64,UklGRg=='], ...extra }) as JsonObject
function input(fetch: ReturnType<typeof vi.fn>, body = build()): ProviderExecutionInput {
  return { apiKey: 'fixture-key', route: '/api/v3/tts/voice_clone', method: 'POST', requestId: 'fixture-request', body, runtime: fakeRuntimeContext(fetch), polling: { interval: 1 } }
}
afterEach(() => vi.useRealTimers())

describe('Seed-ICL V3 voice training', () => {
  it('同一音色同名重训每次提交都有独立身份，续查保留该身份且不会重训', async () => {
    // 状态 1 依据官方 fixture 的状态字段表构造；不会产生网络请求。
    const fetch = vi.fn().mockImplementation(async (url: string) => response(url.endsWith('/voice_clone') ? { ...fixture.response, status: 1 } : fixture.response))
    const request = input(fetch, build({ volcCloneExistingSlot: 'S_fixture' }))
    const first = await execute(request)
    const second = await execute(request)
    expect(first.status).toBe('pending')
    expect(second.status).toBe('pending')
    expect(second.taskId).not.toBe(first.taskId)
    for (const taskId of [first.taskId!, second.taskId!]) {
      expect(await continuePolling({ ...request, taskId })).toMatchObject({ taskId, status: 'completed', url: fixture.response.speaker_status[0].demo_audio })
      expect(JSON.parse(fetch.mock.lastCall![1].body)).toEqual({ speaker_id: 'S_fixture' })
    }
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/voice_clone'))).toHaveLength(2)
  })
  // synthetic-negative：网关 HTML 不是官方音色响应 fixture。
  it.each([false, true])('HTML 502 在新建/已有音色预检 existing=%s 归一为 SDK 错误', async existing => {
    const fetch = vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 }))
    const error = await execute(input(fetch, build(existing ? { volcCloneExistingSlot: 'S_fixture' } : {}))).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(AiRuntimeError)
    expect(error).toMatchObject({ code: 'provider_http_error', details: { status: 502 }, message: expect.stringContaining('502') })
    expect((error as Error).message).not.toContain('<html>')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('损坏 2xx JSON 和业务失败保留 SDK 错误与 HTTP 状态', async () => {
    await expect(execute(input(vi.fn().mockResolvedValue(new Response('broken'))))).rejects.toMatchObject({ code: 'invalid_json', details: { status: 200 } })
    await expect(execute(input(vi.fn().mockResolvedValue(response({ code: 45000001, message: 'bad audio' }))))).rejects.toMatchObject({ code: 'provider_task_failed', details: { status: 200 } })
  })

  it('轮询遇到 HTML 502 最终保留 HTTP 原因，且不重训', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockResolvedValueOnce(response({ speaker_id: 'custom_speaker_id', status: 1 }))
      .mockImplementation(() => Promise.resolve(new Response('<html>502</html>', { status: 502 })))
    const request = input(fetch)
    const pending = await execute(request)
    const error = continuePolling({ ...request, taskId: pending.taskId! }).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await error).toMatchObject({ code: 'provider_task_unreachable', message: expect.stringContaining('502') })
    expect(fetch).toHaveBeenCalledTimes(21)
    expect(fetch.mock.calls.slice(1).every(([url]) => String(url).endsWith('/get_voice'))).toBe(true)
  })

  it.each(['zh_female_vv_uranus_bigtts', 'ICL_uranus_en_female_charlie_tob'])('routes official system voice %s to TTS without clone activation', speaker => {
    const params = { volcIclMode: 'speech', volcSeedIclSpeaker: speaker }
    expect(build(params)).toEqual({ resource_id: 'seed-tts-2.0', req_params: { text: '你好，欢迎试听。', speaker, audio_params: { format: 'mp3', sample_rate: 24000, enable_subtitle: true } } })
    const consent = model.params.find(param => param.id === 'volcIclActivationConsent')!
    expect(consent.visible?.condition?.(params)).toBe(false)
  })

  it('uses the system voice for new and previously empty selections, without weakening clone fee consent', () => {
    expect(build({ volcIclMode: 'speech', volcSeedIclSpeaker: '' })).toMatchObject({ resource_id: 'seed-tts-2.0' })
    expect(() => build({ volcIclMode: 'speech', volcSeedIclSpeaker: 'ICL_custom_voice' })).toThrow('138')
  })
  it('accepts the official code-less response and sends raw base64 using the speech key', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ speaker_id: 'S_fixture', status: 0 }))
      .mockResolvedValueOnce(response(fixture.response))
    const result = await execute(input(fetch, build({ volcCloneExistingSlot: 'S_fixture' })))
    expect(result).toMatchObject({ status: 'completed', url: fixture.response.speaker_status[0].demo_audio, metadata: { clonedVoice: { id: 'S_fixture', name: '我的声音', status: 'ready' } } })
    const [url, init] = fetch.mock.calls[1]
    expect(url).toBe('https://openspeech.bytedance.com/api/v3/tts/voice_clone')
    expect(init.headers['X-Api-Key']).toBe('fixture-key')
    expect(JSON.parse(init.body)).toEqual({ speaker_id: 'S_fixture', audio: { data: 'UklGRg==', format: 'wav' }, language: 0, extra_params: { demo_text: '你好，欢迎试听。', enable_audio_denoise: false, disable_volume_normalization: false } })
    expect(fetch.mock.calls.some(([url]) => String(url).includes('unidirectional'))).toBe(false)
  })

  it('automatically allocates a valid postpaid identity and resumes only by querying it', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ speaker_id: 'custom_speaker_id', status: 1 }))
      .mockResolvedValueOnce(response({ ...fixture.response, speaker_id: 'custom_speaker_id', status: 1 }))
      .mockResolvedValueOnce(response({ ...fixture.response, speaker_id: 'custom_speaker_id' }))
    const request = input(fetch)
    const pending = await execute(request)
    const submitted = JSON.parse(fetch.mock.calls[0][1].body)
    expect(submitted.custom_speaker_id).toMatch(/^henji[a-f0-9]{32}$/)
    expect(pending.status).toBe('pending')
    const done = await continuePolling({ ...request, taskId: pending.taskId! })
    expect(done).toMatchObject({ status: 'completed', metadata: { clonedVoice: { id: submitted.custom_speaker_id } } })
    expect(fetch.mock.calls.slice(1).every(([url, init]) => String(url).endsWith('/get_voice') && JSON.parse(init.body).custom_speaker_id === submitted.custom_speaker_id)).toBe(true)
  })

  it.each([{}, { speaker_id: 'S_fixture' }, { speaker_id: 'S_fixture', status: 7 }, { speaker_id: 'other', status: 2 }, { speaker_id: 'custom_speaker_id', status: 3 }, { speaker_id: 'custom_speaker_id', status: 0 }, { code: 45000001, message: 'bad audio' }])('rejects malformed or failed responses: %j', async payload => {
    await expect(execute(input(vi.fn().mockResolvedValue(response(payload))))).rejects.toThrow()
  })

  it('retains a queryable task after an ambiguous network loss and never retrains automatically', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response({ ...fixture.response, speaker_id: 'custom_speaker_id' }))
    const request = input(fetch)
    const pending = await execute(request)
    expect(pending).toMatchObject({ status: 'pending', metadata: { submissionUnconfirmed: true } })
    await continuePolling({ ...request, taskId: pending.taskId! })
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/voice_clone'))).toHaveLength(1)
  })

  it('does not overwrite an activated prepaid voice', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ...fixture.response, status: 4 }))
    await expect(execute(input(fetch, build({ volcCloneExistingSlot: 'S_fixture' })))).rejects.toThrow('已锁定')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects empty, oversized and unsupported audio before contacting the supplier', async () => {
    const fetch = vi.fn()
    for (const source of ['data:audio/wav;base64,', 'data:audio/flac;base64,UklGRg==']) {
      await expect(execute(input(fetch, build({ volcCloneAudio: [source] })))).rejects.toMatchObject({ code: 'invalid_media' })
    }
    const request = input(fetch, build({ volcCloneAudio: ['/sample.wav'] }))
    request.runtime.media.read = vi.fn().mockResolvedValue({ bytes: new Uint8Array(10_000_001), mimeType: 'audio/wav' })
    await expect(execute(request)).rejects.toMatchObject({ code: 'invalid_media' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cancels waiting without sending training or query requests', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ speaker_id: 'custom_speaker_id', status: 1 }))
    const request = input(fetch)
    const pending = await execute(request)
    const controller = new AbortController()
    const waiting = continuePolling({ ...request, taskId: pending.taskId!, polling: { interval: 60_000 }, signal: controller.signal })
    controller.abort()
    await expect(waiting).rejects.toThrow('cancelled')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('enforces preview length, language and first-use fee consent', () => {
    expect(() => build({ prompt: '短' })).toThrow('4–300')
    expect(() => build({ volcCloneLanguage: 18 })).toThrow('语言')
    expect(() => build({ volcIclMode: 'speech', volcSeedIclSpeaker: 'henjiFixtureVoice' })).toThrow('138')
    expect(build({ volcIclMode: 'speech', volcSeedIclSpeaker: 'S_fixture' })).toMatchObject({ resource_id: 'seed-icl-2.0' })
    expect(build({ volcIclMode: 'speech', volcSeedIclSpeaker: 'henjiFixtureVoice', volcIclActivationConsent: true })).toMatchObject({ req_params: { speaker: 'henjiFixtureVoice' } })
  })
})
