import { describe, expect, it } from 'vitest'

import { falPixverseV6Model } from '../../src/catalog/fal/pixverse-v6.model'
import type { JsonObject } from '../../src/types/runtime'
import { expectFalOfficialBody } from './falOfficialInput'

const selector = (falPixverseV6Model.endpoints as { selector: (params: JsonObject) => Promise<string> }).selector
const build = (params: JsonObject) => falPixverseV6Model.request.builder(params) as JsonObject
const price = (params: JsonObject) => falPixverseV6Model.pricing.calculator!(params)
const defaults = Object.fromEntries(falPixverseV6Model.params.map((param) => [param.id, param.default])) as JsonObject

async function route(params: JsonObject): Promise<{ endpoint: string; body: JsonObject }> {
  const endpoint = await selector(params)
  const body = build(params)
  expectFalOfficialBody(endpoint, body)
  return { endpoint, body }
}

describe('Fal PixVerse V6', () => {
  it('默认标准版文生视频：16:9、720p、5 秒、带音频，按有音频单价计费', async () => {
    const { endpoint, body } = await route({ ...defaults, prompt: '城市夜景' })
    expect(endpoint).toBe('fal-ai/pixverse/v6/text-to-video')
    expect(body).toEqual({
      prompt: '城市夜景', resolution: '720p', duration: 5, generate_audio_switch: true,
      thinking_type: 'auto', generate_multi_clip_switch: false, aspect_ratio: '16:9',
    })
    expect(price({ ...defaults })).toBeCloseTo(0.3)
    expect(price({ ...defaults, falPixverseV6GenerateAudio: false })).toBeCloseTo(0.225)
  })

  it('标准版按图片数自动路由：1 张图生视频不发比例，2 张走首尾帧并按智能比例取首图比例', async () => {
    const single = await route({ ...defaults, prompt: 'x', falPixverseV6Style: 'anime', images: ['https://cdn/a.png'] })
    expect(single.endpoint).toBe('fal-ai/pixverse/v6/image-to-video')
    expect(single.body).toMatchObject({ image_url: 'https://cdn/a.png', style: 'anime' })
    expect(single.body).not.toHaveProperty('aspect_ratio')
    const pair = await route({ ...defaults, prompt: 'x', falPixverseV6AspectRatio: 'smart', __firstImageRatio: 0.56, uploadedFilePaths: ['https://cdn/a.png', 'https://cdn/b.png'] })
    expect(pair.endpoint).toBe('fal-ai/pixverse/v6/transition')
    expect(pair.body).toMatchObject({ first_image_url: 'https://cdn/a.png', end_image_url: 'https://cdn/b.png', aspect_ratio: '9:16' })
  })

  it('续写只发官方续写字段，Max 下续写模式不生效', async () => {
    const params = { ...defaults, prompt: '继续向前走', falPixverseV6Mode: 'video-extension', falPixverseV6Duration: 8, falPixverseV6Resolution: '1080p', videos: ['https://cdn/clip.mp4'] }
    const { endpoint, body } = await route(params)
    expect(endpoint).toBe('fal-ai/pixverse/v6/extend')
    expect(body).toEqual({ prompt: '继续向前走', resolution: '1080p', duration: 8, generate_audio_switch: true, video_url: 'https://cdn/clip.mp4' })
    expect(price(params)).toBeCloseTo(0.115 * 8)
    expect(() => build({ ...params, videos: [] })).toThrow('需要上传 1 个视频')
    await expect(selector({ ...params, falPixverseV6Version: 'max' })).resolves.toBe('pixverse/v6/max/text-to-video')
  })

  it('Max 只走文生与图生端点，拒绝首尾帧，按 Max 单价计费', async () => {
    const max = { ...defaults, prompt: 'x', falPixverseV6Version: 'max', falPixverseV6Resolution: '1080p', falPixverseV6Duration: 8 }
    expect((await route(max)).endpoint).toBe('pixverse/v6/max/text-to-video')
    expect((await route({ ...max, images: ['https://cdn/a.png'] })).endpoint).toBe('pixverse/v6/max/image-to-video')
    expect(() => build({ ...max, images: ['a.png', 'b.png'] })).toThrow('不支持首尾帧')
    expect(price(max)).toBeCloseTo(2.016)
  })

  it('时长夹在官方 1–15 秒内', () => {
    expect(build({ ...defaults, prompt: 'x', falPixverseV6Duration: 30 }).duration).toBe(15)
    expect(build({ ...defaults, prompt: 'x', falPixverseV6Duration: 0 }).duration).toBe(1)
  })
})
