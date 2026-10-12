import { expect, it, vi } from 'vitest'
import { catalogIndex } from '../src/catalog'
import { execute } from '../src/providers/volcengine-speech'
import { fakeRuntimeContext } from './providers/test-helpers'
import type { JsonObject } from '../src/types/runtime'
import fixture from './fixtures/tts/volcengine-subtitle.json'

it.each(['volcengine-seed-tts-2.0', 'volcengine-seed-icl-2.0'])('%s enables and parses documented HTTP subtitles', async id => {
  const model = catalogIndex.get(id)!
  const body = model.request!.builder!({ prompt: '你好，语音测试', ...(id.includes('icl') ? { volcSeedIclSpeaker: 'fixture-clone', volcIclActivationConsent: true } : {}) }) as JsonObject
  expect(body).toMatchObject({ req_params: { audio_params: { enable_subtitle: true } } })
  expect(model.meta.tags).toContain('timestamps')
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture.response)))
  const result = await execute({ apiKey: 'fixture', route: '/api/v3/tts/unidirectional', method: 'POST', body, runtime: fakeRuntimeContext(fetch) })
  expect(result.metadata).toMatchObject({ outputTimings: [{ outputIndex: 0, timings: { granularity: 'char', items: fixture.response.sentence.words.map(word => ({ text: word.word, startMs: word.startTime * 1000, endMs: word.endTime * 1000, confidence: word.confidence })) } }] })
  expect(result.url).toBe('data:audio/mpeg;base64,SUQz')
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('rejects reversed intervals without retrying generation', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...fixture.response, sentence: { words: [{ word: '错', startTime: 2, endTime: 1 }] } })))
  await expect(execute({ apiKey: 'fixture', route: '/api/v3/tts/unidirectional', method: 'POST', body: { resource_id: 'seed-tts-2.0', req_params: {} }, runtime: fakeRuntimeContext(fetch) })).rejects.toMatchObject({ code: 'invalid_response' })
  expect(fetch).toHaveBeenCalledTimes(1)
})
