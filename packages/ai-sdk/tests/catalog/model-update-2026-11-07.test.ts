import { describe, expect, it, vi } from 'vitest'
import { catalogIndex } from '../../src/catalog'
import * as groq from '../../src/providers/groq'
import type { JsonObject, ProviderExecutionInput } from '../../src/types/runtime'
import fixture from '../fixtures/groq-tts/speech.json'
import { fakeRuntimeContext } from '../providers/test-helpers'

function model(id: string) {
  const runtime = catalogIndex.get(id)
  if (!runtime) throw new Error(`missing model ${id}`)
  return runtime
}

const build = async (id: string, params: JsonObject) => model(id).request!.builder!({ prompt: 'test', ...params }) as JsonObject
const route = async (id: string, params: JsonObject) => {
  const endpoints = model(id).endpoints
  return typeof endpoints === 'string' ? endpoints : await (endpoints as { selector: (p: JsonObject) => Promise<string> | string }).selector(params)
}
const price = (id: string, params: JsonObject) => model(id).pricing!.calculator!(params)
const img = (count: number) => Array.from({ length: count }, (_, index) => `https://example.invalid/${index}.png`)
const vid = ['https://example.invalid/in.mp4']

describe('APIMart 万相 2.7 Image', () => {
  it('标准版默认文生图发具体比例与 2K，Pro 换平台模型名', async () => {
    expect(await build('apimart-wan-2.7-image', {})).toEqual({ model: 'wan2.7-image', prompt: 'test', resolution: '2K', n: 1, size: '1:1' })
    expect(await build('apimart-wan-2.7-image', { apimartWan27ImageVariant: 'pro', apimartWan27ImageResolution: '4K', apimartWan27ImageAspectRatio: '16:9' }))
      .toMatchObject({ model: 'wan2.7-image-pro', resolution: '4K', size: '16:9' })
  })

  it('有输入图时只发 image_urls 不发比例；4K 只允许 Pro 非组图文生图', async () => {
    const edit = await build('apimart-wan-2.7-image', { uploadedFilePaths: img(2) })
    expect(edit).toMatchObject({ image_urls: img(2), resolution: '2K' })
    expect(edit).not.toHaveProperty('size')
    await expect(build('apimart-wan-2.7-image', { apimartWan27ImageResolution: '4K' })).rejects.toThrow('4K')
    await expect(build('apimart-wan-2.7-image', { apimartWan27ImageVariant: 'pro', apimartWan27ImageResolution: '4K', uploadedFilePaths: img(1) })).rejects.toThrow('4K')
    await expect(build('apimart-wan-2.7-image', { apimartWan27ImageVariant: 'pro', apimartWan27ImageResolution: '4K', apimartWan27ImageSequential: true })).rejects.toThrow('4K')
    await expect(build('apimart-wan-2.7-image', { uploadedFilePaths: img(10) })).rejects.toThrow('9')
  })

  it('组图模式最多 12 张，非组图最多 4 张；按张数计价', async () => {
    expect(await build('apimart-wan-2.7-image', { apimartWan27ImageSequential: true, apimartWan27ImageCount: 12 }))
      .toMatchObject({ enable_sequential: true, n: 12 })
    await expect(build('apimart-wan-2.7-image', { apimartWan27ImageCount: 5 })).rejects.toThrow('1–4')
    // 宿主参数校验只看静态范围，静态上限必须放到组图的 12。
    expect(model('apimart-wan-2.7-image').params.find(param => param.id === 'apimartWan27ImageCount')).toMatchObject({ max: 12 })
    expect(price('apimart-wan-2.7-image', { apimartWan27ImageCount: 3 })).toBeCloseTo(0.0648)
    expect(price('apimart-wan-2.7-image', { apimartWan27ImageVariant: 'pro', apimartWan27ImageCount: 2 })).toBeCloseTo(0.1088)
  })
})

describe('APIMart FLUX 3 Video', () => {
  it('按素材显式发送 t2v / i2v，关键帧保持顺序', async () => {
    expect(await build('apimart-flux-3-video', {})).toEqual({
      model: 'flux-3-video', prompt: 'test', duration: 5, resolution: 'hd', audio: true, mode: 't2v', aspect_ratio: '16:9',
    })
    expect(await build('apimart-flux-3-video', { uploadedFilePaths: img(3), apimartFlux3VideoResolution: 'fhd', apimartFlux3VideoDuration: 12 }))
      .toMatchObject({ mode: 'i2v', image_urls: img(3), aspect_ratio: 'auto', resolution: 'fhd', duration: 12 })
    // 先选了 9:16 再上传首帧：比例选项已隐藏，残留取值不能发。
    expect(await build('apimart-flux-3-video', { uploadedFilePaths: img(1), apimartFlux3VideoAspectRatio: '9:16' })).toMatchObject({ aspect_ratio: 'auto' })
    expect(await build('apimart-flux-3-video', { apimartFlux3VideoAspectRatio: '9:16' })).toMatchObject({ aspect_ratio: '9:16' })
  })

  it('视频续写只发视频，缺视频时拒绝；续写按更高单价计费', async () => {
    const body = await build('apimart-flux-3-video', { apimartFlux3VideoMode: 'extend', uploadedVideoFilePaths: vid, uploadedFilePaths: img(1) })
    expect(body).toMatchObject({ mode: 'v2v', video_url: vid[0], aspect_ratio: 'auto' })
    expect(body).not.toHaveProperty('image_urls')
    await expect(build('apimart-flux-3-video', { apimartFlux3VideoMode: 'extend' })).rejects.toThrow('1 段视频')
    expect(price('apimart-flux-3-video', { apimartFlux3VideoDuration: 10 })).toBeCloseTo(1.36)
    expect(price('apimart-flux-3-video', { apimartFlux3VideoMode: 'extend', apimartFlux3VideoResolution: 'fhd' })).toBeCloseTo(2.12)
  })
})

describe('Fal FLUX 3 Video', () => {
  it('版本、模式与素材决定端点', async () => {
    expect(await route('fal-flux-3-video', {})).toBe('blackforestlabs/flux-3/text-to-video')
    expect(await route('fal-flux-3-video', { uploadedFilePaths: img(1) })).toBe('blackforestlabs/flux-3/image-to-video')
    expect(await route('fal-flux-3-video', { falFlux3VideoMode: 'extend', uploadedVideoFilePaths: vid })).toBe('blackforestlabs/flux-3/extend-video')
    expect(await route('fal-flux-3-video', { falFlux3VideoMode: 'edit', uploadedVideoFilePaths: vid })).toBe('blackforestlabs/flux-3/edit-video')
    expect(await route('fal-flux-3-video', { falFlux3VideoVersion: 'max' })).toBe('blackforestlabs/flux-3-max/text-to-video')
    expect(await route('fal-flux-3-video', { falFlux3VideoVersion: 'max', falFlux3VideoMode: 'edit', uploadedFilePaths: img(2) })).toBe('blackforestlabs/flux-3-max/image-to-video')
  })

  it('各分支只发送对应端点定义的字段', async () => {
    expect(await build('fal-flux-3-video', { falFlux3VideoResolution: '2160p', falFlux3VideoAspectRatio: '9:16' }))
      .toEqual({ prompt: 'test', resolution: '2160p', duration: 5, generate_audio: true, aspect_ratio: '9:16' })
    expect(await build('fal-flux-3-video', { uploadedFilePaths: img(1) })).toMatchObject({ image_url: img(1)[0], aspect_ratio: 'auto' })
    expect(await build('fal-flux-3-video', { falFlux3VideoVersion: 'max', uploadedFilePaths: img(2), falFlux3VideoReasoning: 'low' }))
      .toMatchObject({ image_url: img(2)[0], end_image_url: img(2)[1], reasoning_level: 'low' })
    expect(await build('fal-flux-3-video', { falFlux3VideoMode: 'edit', uploadedVideoFilePaths: vid })).toEqual({ prompt: 'test', video_url: vid[0] })
    const extend = await build('fal-flux-3-video', { falFlux3VideoMode: 'extend', uploadedVideoFilePaths: vid, falFlux3VideoResolution: '2160p' })
    expect(extend).toEqual({ prompt: 'test', video_url: vid[0], resolution: '720p', duration: 5, generate_audio: true })
    await expect(build('fal-flux-3-video', { falFlux3VideoMode: 'extend' })).rejects.toThrow('1 段视频')
  })

  it('按端点公布的单价估价，编辑按输入视频时长', () => {
    expect(price('fal-flux-3-video', { falFlux3VideoResolution: '1440p', falFlux3VideoDuration: 10 })).toBeCloseTo(3.2)
    expect(price('fal-flux-3-video', { falFlux3VideoMode: 'extend', falFlux3VideoResolution: '1080p' })).toBeCloseTo(2.65)
    expect(price('fal-flux-3-video', { falFlux3VideoVersion: 'max', falFlux3VideoResolution: '2160p' })).toBeCloseTo(0.85)
    expect(price('fal-flux-3-video', { falFlux3VideoMode: 'edit', uploadedVideoFilePaths: vid, __videoDurationSeconds: [8] })).toBeCloseTo(0.24)
  })
})

describe('Groq Orpheus 语音合成', () => {
  it('请求体与官方示例一致，固定 wav', async () => {
    expect(await build('groq-orpheus-v1-english', { prompt: fixture.englishRequest.input, groqOrpheusEnglishVoice: 'austin' })).toEqual(fixture.englishRequest)
    expect(await build('groq-orpheus-arabic-saudi', { prompt: fixture.arabicRequest.input, groqOrpheusArabicVoice: 'noura' })).toEqual(fixture.arabicRequest)
  })

  it('超过 200 字符或使用清单外音色时在发请求前拒绝', async () => {
    await expect(build('groq-orpheus-v1-english', { prompt: 'a'.repeat(201) })).rejects.toThrow('200')
    await expect(build('groq-orpheus-v1-english', { groqOrpheusEnglishVoice: 'noura' })).rejects.toThrow('noura')
    await expect(build('groq-orpheus-arabic-saudi', { groqOrpheusArabicVoice: 'troy' })).rejects.toThrow('troy')
  })

  it('按字符计价：英文 $22、阿拉伯语 $40 每百万字符', () => {
    expect(price('groq-orpheus-v1-english', { prompt: 'a'.repeat(100) })).toBeCloseTo(0.0022)
    expect(price('groq-orpheus-arabic-saudi', { prompt: 'a'.repeat(100) })).toBeCloseTo(0.004)
  })

  function execution(fetch: ReturnType<typeof vi.fn>): ProviderExecutionInput {
    return {
      apiKey: 'fixture-key', route: '/v1/audio/speech', method: 'POST', body: fixture.englishRequest, requestId: 'fixture-request',
      runtime: fakeRuntimeContext(fetch),
    }
  }

  it('二进制 wav 变为音频 URI，请求打到 Groq OpenAI 兼容前缀', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array(fixture.audioBytes), { headers: { 'content-type': 'audio/wav' } }))
    await expect(groq.execute(execution(fetch))).resolves.toMatchObject({ status: 'completed', url: 'data:audio/wav;base64,UklGRg==' })
    expect(fetch.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/audio/speech')
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual(fixture.englishRequest)
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer fixture-key' })
  })

  it('官方错误体与空音频都不能成为成功结果，且同步接口不轮询', async () => {
    const failing = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(fixture.error.payload), { status: fixture.error.status }))
    await expect(groq.execute(execution(failing))).rejects.toMatchObject({ code: 'provider_http_error', details: { status: 400 } })
    const empty = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array(), { headers: { 'content-type': 'audio/wav' } }))
    await expect(groq.execute(execution(empty))).rejects.toMatchObject({ code: 'empty_result' })
    await expect(groq.continuePolling({ apiKey: 'k', route: '/v1/audio/speech', taskId: 't', runtime: fakeRuntimeContext(vi.fn()) } as never)).rejects.toMatchObject({ code: 'unsupported_provider' })
  })
})
