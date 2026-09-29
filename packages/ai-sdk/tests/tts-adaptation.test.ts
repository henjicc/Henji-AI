import { describe, expect, it, vi } from 'vitest'
import fixture from './fixtures/tts/speech-protocols.json'
import { catalogIndex } from '../src/catalog'
import * as bailian from '../src/providers/bailian'
import * as siliconflow from '../src/providers/siliconflow'
import * as volcengineSpeech from '../src/providers/volcengine-speech'
import { fakeRuntimeContext } from './providers/test-helpers'
import type { JsonObject, ProviderExecutionInput } from '../src/types/runtime'

const addedModels = [
  'bailian-cosyvoice-v3.5', 'bailian-minimax-speech-2.8', 'bailian-qwen-audio-3.1-tts-flash',
  'fal-eleven-v3-tts', 'fal-minimax-speech-2.8', 'fal-qwen3-tts-1.7b',
  'kie-eleven-turbo-2.5-tts', 'kie-eleven-v3-dialogue', 'kie-gemini-3.1-flash-tts',
  'siliconflow-cosyvoice2-tts', 'siliconflow-moss-ttsd-0.5',
  'volcengine-seed-icl-2.0', 'volcengine-seed-tts-2.0',
] as const

function build(id: string, params: JsonObject = {}): JsonObject {
  const model = catalogIndex.get(id)
  if (!model?.request?.builder) throw new Error(`Missing model builder: ${id}`)
  return model.request.builder({ prompt: '你好', ...params }) as JsonObject
}

function execution(body: JsonObject, route: string, fetch: ReturnType<typeof vi.fn>): ProviderExecutionInput {
  return {
    apiKey: 'fixture-key', route, method: 'POST', body, requestId: 'fixture-request',
    runtime: fakeRuntimeContext(fetch),
  }
}

describe('TTS model catalog', () => {
  it('13 个新增模型均有可执行请求和可选文本入口', () => {
    for (const id of addedModels) {
      const model = catalogIndex.get(id)
      expect(model, id).toBeDefined()
      expect(model?.meta.type, id).toBe('audio')
      expect(model?.meta.tags, id).toContain('text-to-audio')
      expect(model?.endpoints, id).toBeTruthy()
      if (id !== 'bailian-cosyvoice-v3.5' && id !== 'volcengine-seed-icl-2.0') {
        expect(build(id), id).toBeTruthy()
      }
    }
  })

  it('平台分型、结构化对话、必填自定义音色与价格边界', () => {
    expect(build('fal-minimax-speech-2.8', { falMinimaxSpeechSpec: 'turbo' })).toMatchObject({
      prompt: '你好', voice_setting: { voice_id: 'Wise_Woman', speed: 1 }, output_format: 'url',
    })
    expect(build('fal-qwen3-tts-1.7b')).toMatchObject({ text: '你好', voice: 'Vivian' })
    expect(build('fal-eleven-v3-tts')).toMatchObject({ text: '你好', voice: 'Rachel' })
    expect(build('bailian-minimax-speech-2.8', { bailianMinimaxSpeechSpec: 'turbo' })).toMatchObject({
      model: 'MiniMax/speech-2.8-turbo', input: { text: '你好', voice_setting: { voice_id: 'male-qn-qingse' } },
    })
    expect(build('bailian-qwen-audio-3.1-tts-flash')).toMatchObject({ model: 'qwen-audio-3.1-tts-flash', input: { voice: 'longanhuan_v3.1' } })
    expect(() => build('bailian-cosyvoice-v3.5')).toThrow('音色 ID')
    expect(build('bailian-cosyvoice-v3.5', { bailianCosyVoiceId: 'clone-voice', bailianCosyVoiceSpec: 'plus' })).toMatchObject({
      model: 'cosyvoice-v3.5-plus', input: { voice: 'clone-voice' },
    })
    expect(build('kie-eleven-turbo-2.5-tts')).toMatchObject({ model: 'elevenlabs/text-to-speech-turbo-2-5', input: { text: '你好' } })
    expect(build('kie-eleven-v3-dialogue', { kieElevenDialogue: [{ text: 'Hello', voice: 'voice-1' }] })).toMatchObject({
      model: 'elevenlabs/text-to-dialogue-v3', input: { dialogue: [{ text: 'Hello', voice: 'voice-1' }] },
    })
    expect(build('kie-gemini-3.1-flash-tts', {
      kieGeminiTtsSpeakers: [{ speaker_id: 'Speaker 1', voice_name: 'Fenrir' }],
      kieGeminiTtsDialogueTurns: [{ speaker_id: 'Speaker 1', text: 'Hello' }],
    })).toMatchObject({ model: 'google/gemini-3-1-flash-tts', input: { dialogue_turns: [{ text: 'Hello' }] } })
    expect(build('siliconflow-cosyvoice2-tts')).toMatchObject({ model: 'FunAudioLLM/CosyVoice2-0.5B', stream: false })
    expect(build('siliconflow-moss-ttsd-0.5')).toMatchObject({ model: 'fnlp/MOSS-TTSD-v0.5', input: '[S1]你好' })
    expect(build('volcengine-seed-tts-2.0')).toMatchObject({ resource_id: 'seed-tts-2.0', req_params: { text: '你好' } })
    expect(build('volcengine-seed-icl-2.0')).toMatchObject({ resource_id: 'seed-tts-2.0', req_params: { speaker: 'zh_female_vv_uranus_bigtts' } })
    expect(build('volcengine-seed-icl-2.0', { volcSeedIclSpeaker: 'clone-id', volcIclActivationConsent: true })).toMatchObject({
      resource_id: 'seed-icl-2.0', req_params: { model: 'seed-tts-2.0-standard', speaker: 'clone-id' },
    })
    expect(catalogIndex.get('fal-minimax-speech-2.8')?.pricing.calculator?.({ prompt: '你好', falMinimaxSpeechSpec: 'turbo' })).toBeCloseTo(0.00012)
    expect(catalogIndex.get('bailian-cosyvoice-v3.5')?.pricing.calculator?.({ prompt: '你好', bailianCosyVoiceSpec: 'plus' })).toBeCloseTo(0.0003)
    for (const id of ['bailian-qwen-audio-3.1-tts-flash', 'kie-gemini-3.1-flash-tts']) {
      expect(catalogIndex.get(id)?.pricing.calculator?.({ prompt: '你好' }), id).toBeNaN()
    }
    for (const id of ['volcengine-seed-tts-2.0', 'volcengine-seed-icl-2.0']) {
      expect(catalogIndex.get(id)?.pricing.calculator?.({ prompt: '你好' }), id).toBeCloseTo(0.0006)
    }
  })
})

describe('TTS media provider protocols', () => {
  it('百炼 MiniMax 的最终 Hex 音频变为可落盘的 data URI，错误状态被拒绝', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture.bailianMinimax)))
    const input = execution(build('bailian-minimax-speech-2.8'), '/api/v1/services/aigc/multimodal-generation/generation', fetch)
    const result = await bailian.execute(input)
    expect(result).toMatchObject({ status: 'completed', url: 'data:audio/mpeg;base64,SUQz' })
    expect(JSON.stringify(result.metadata)).not.toContain('494433')
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ output: { data: { audio: '494433', status: 1 }, base_resp: { status_code: 0 } } })))
    await expect(bailian.execute(input)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('百炼 Qwen/CosyVoice 只接受完成态的音频 URL', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(fixture.bailianQwenCosy)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { finish_reason: 'continue', audio: { url: 'https://media.invalid/unfinished.mp3' } } })))
    const input = execution(build('bailian-qwen-audio-3.1-tts-flash'), '/api/v1/services/audio/tts/SpeechSynthesizer', fetch)
    await expect(bailian.execute(input)).resolves.toMatchObject({ url: 'https://media.invalid/tts.mp3' })
    await expect(bailian.execute(input)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('硅基流动二进制响应变为音频 URI，空音频明确失败', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array(fixture.siliconflowAudioBytes), { headers: { 'content-type': 'audio/mpeg' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array()))
    const input = execution(build('siliconflow-cosyvoice2-tts'), '/v1/audio/speech', fetch)
    await expect(siliconflow.execute(input)).resolves.toMatchObject({ url: 'data:audio/mpeg;base64,SUQz' })
    expect(fetch.mock.calls[0][0]).toBe('https://api.siliconflow.cn/v1/audio/speech')
    await expect(siliconflow.execute(input)).rejects.toMatchObject({ code: 'empty_result' })
  })

  it('火山 V3 将跨网络分块的 JSON 帧按音频顺序拼接，并隔离方舟密钥', async () => {
    const body = fixture.volcengineFrames.map((frame) => JSON.stringify(frame)).join('')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoded = new TextEncoder().encode(body)
        controller.enqueue(encoded.slice(0, 9))
        controller.enqueue(encoded.slice(9, 37))
        controller.enqueue(encoded.slice(37))
        controller.close()
      },
    })
    const fetch = vi.fn().mockResolvedValue(new Response(stream))
    const input = execution(build('volcengine-seed-tts-2.0'), '/api/v3/tts/unidirectional', fetch)
    await expect(volcengineSpeech.execute(input)).resolves.toMatchObject({
      url: 'data:audio/mpeg;base64,SUQz', metadata: { textWords: 3, byteLength: 3 },
    })
    expect(fetch.mock.calls[0][0]).toBe('https://openspeech.bytedance.com/api/v3/tts/unidirectional')
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ 'X-Api-Key': 'fixture-key', 'X-Api-Resource-Id': 'seed-tts-2.0' })
    expect(fetch.mock.calls[0][1].headers['X-Api-Request-Id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('resource_id')
  })

  it('火山 V3 错误帧、无音频和非法帧不能成为成功结果', async () => {
    const input = execution(build('volcengine-seed-tts-2.0'), '/api/v3/tts/unidirectional', vi.fn())
    for (const [body, code] of [
      ['{"code":400,"message":"bad voice"}\n', 'provider_task_failed'],
      ['{"code":0,"message":"OK"}\n', 'empty_result'],
      ['not-json\n', 'invalid_response'],
      ['{"code":0,"data":"SUQz"', 'invalid_response'],
    ] as const) {
      input.runtime = fakeRuntimeContext(vi.fn().mockResolvedValue(new Response(body)))
      await expect(volcengineSpeech.execute(input)).rejects.toMatchObject({ code })
    }
  })

  it('火山 V3 取消流读取立即结束，不返回部分音频', async () => {
    const controller = new AbortController()
    const stream = new ReadableStream<Uint8Array>({
      start(output) { output.enqueue(new TextEncoder().encode('{"code":0,"data":"SUQ="}\n')) },
    })
    const fetch = vi.fn().mockResolvedValue(new Response(stream))
    const input = { ...execution(build('volcengine-seed-tts-2.0'), '/api/v3/tts/unidirectional', fetch), signal: controller.signal }
    const pending = volcengineSpeech.execute(input)
    await Promise.resolve()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
