import { describe, expect, it, vi } from 'vitest'
import { listTtsVoices } from '../src/providers/tts-voices'
import { fakeRuntimeContext } from './providers/test-helpers'

function runtimeFor(fetchImpl: ReturnType<typeof vi.fn>, key = 'fixture-key') {
  const runtime = fakeRuntimeContext(fetchImpl)
  runtime.credentials = { get: vi.fn().mockResolvedValue(key) }
  return runtime
}

describe('TTS account voice catalog', () => {
  it('uses the official MiniMax get_voice contract and rejects supplier errors', async () => {
    // Official response excerpt, 2026-09-27: https://help.aliyun.com/zh/model-studio/sound-management
    // The official sample has additional system voices represented by an ellipsis; only its literal first voice is retained.
    const official = {
      output: {
        base_resp: { status_code: 0, status_msg: 'success' },
        system_voice: [{ created_time: '1970-01-01', description: [], voice_id: 'male-qn-qingse', voice_name: '青涩青年音色' }],
      },
      request_id: '6cd17383-fc97-9445-adad-e4deb16716af',
    }
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(official)))
    const voices = await listTtsVoices('bailian-minimax-speech-2.8', runtimeFor(fetch))
    expect(voices).toEqual([{ id: 'male-qn-qingse', name: '青涩青年音色', description: undefined, source: 'system' }])
    expect(fetch).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer fixture-key' }),
        body: JSON.stringify({ model: 'MiniMax/speech-2.8-turbo', input: { action: 'get_voice', voice_type: 'all' } }),
      }),
    )
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ output: { base_resp: { status_code: 2013 }, system_voice: [] } })))
    await expect(listTtsVoices('bailian-minimax-speech-2.8', runtimeFor(fetch))).rejects.toThrow('返回错误')
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ output: { system_voice: [] } })))
    await expect(listTtsVoices('bailian-minimax-speech-2.8', runtimeFor(fetch))).rejects.toThrow('返回错误')
  })

  it('filters enrolled voices by model and approved status', async () => {
    // First entry is the official list response example, 2026-09-27:
    // https://help.aliyun.com/en/model-studio/voice-clone-design-http-api
    // The 3.1 and DEPLOYING entries are synthetic filter cases based on the documented fields and status table.
    const responseBody = {
      output: { voice_list: [
        { voice_id: 'qwen-audio-3.0-tts-flash-myvoice-xxxxxx', gmt_create: '2024-12-11 13:38:02', gmt_modified: '2024-12-11 13:38:02', status: 'OK' },
        { voice_id: 'qwen-audio-3.1-tts-flash-ready-xxxxxx', status: 'OK' },
        { voice_id: 'qwen-audio-3.1-tts-flash-pending-xxxxxx', status: 'DEPLOYING' },
        { voice_id: 'cosyvoice-v3.5-flash-ready-xxxxxx', status: 'OK' },
      ] }, usage: { count: 1 }, request_id: 'xxxx-xxxx-xxxx',
    }
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(responseBody)))
    expect(await listTtsVoices('bailian-qwen-audio-3.1-tts-flash', runtimeFor(fetch)))
      .toEqual([{ id: 'qwen-audio-3.1-tts-flash-ready-xxxxxx', name: 'qwen-audio-3.1-tts-flash-ready-xxxxxx', source: 'clone' }])
    expect(await listTtsVoices('bailian-cosyvoice-v3.5', runtimeFor(fetch)))
      .toEqual([{ id: 'cosyvoice-v3.5-flash-ready-xxxxxx', name: 'cosyvoice-v3.5-flash-ready-xxxxxx', source: 'clone' }])
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      model: 'voice-enrollment', input: { action: 'list_voice', page_index: 0, page_size: 50 },
    })
  })

  it('continues pagination after a full page and reports malformed responses', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => ({ voice_id: `cosyvoice-v3.5-plus-voice-${i}`, status: 'OK' }))
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { voice_list: firstPage } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { voice_list: [{ voice_id: 'cosyvoice-v3.5-plus-last', status: 'OK' }] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { voice_list: null } })))
    const runtime = runtimeFor(fetch)
    expect(await listTtsVoices('bailian-cosyvoice-v3.5', runtime)).toHaveLength(51)
    expect(JSON.parse(fetch.mock.calls[1][1].body).input.page_index).toBe(1)
    await expect(listTtsVoices('bailian-cosyvoice-v3.5', runtime)).rejects.toThrow('响应格式错误')
  })

  it('reads SiliconFlow dynamic voice URIs and refuses missing credentials', async () => {
    // Response array is constructed from the documented uri field; the official guide does not specify an envelope:
    // https://docs.siliconflow.cn/docs/userguide/capabilities/text-to-speech
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { uri: 'speech:myvoice:voiceid', name: '我的音色' }, { uri: '' },
    ])))
    expect(await listTtsVoices('siliconflow-cosyvoice2-tts', runtimeFor(fetch)))
      .toEqual([{ id: 'speech:myvoice:voiceid', name: '我的音色', source: 'clone' }])
    expect(fetch.mock.calls[0][0]).toBe('https://api.siliconflow.cn/v1/audio/voice/list')
    expect(fetch.mock.calls[0][1].method).toBe('GET')
    await expect(listTtsVoices('siliconflow-cosyvoice2-tts', runtimeFor(fetch, ''))).rejects.toThrow('API Key')
    await expect(listTtsVoices('__proto__', runtimeFor(fetch))).rejects.toThrow('不支持查询')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
