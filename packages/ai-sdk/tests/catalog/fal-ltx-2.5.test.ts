import { describe, expect, it } from 'vitest'

import { falLtx25Model } from '../../src/catalog/fal/ltx-2.5.model'
import type { JsonObject } from '../../src/types/runtime'
import { expectFalOfficialBody } from './falOfficialInput'

const selector = (falLtx25Model.endpoints as { selector: (params: JsonObject) => Promise<string> }).selector
const build = (params: JsonObject) => falLtx25Model.request.builder(params) as JsonObject
const price = (params: JsonObject) => falLtx25Model.pricing.calculator!(params)
const defaults = Object.fromEntries(falLtx25Model.params.map((param) => [param.id, param.default])) as JsonObject

async function route(params: JsonObject): Promise<{ endpoint: string; body: JsonObject }> {
  const endpoint = await selector(params)
  const body = build(params)
  expectFalOfficialBody(endpoint, body)
  return { endpoint, body }
}

describe('Fal LTX-2.5', () => {
  it('默认快速档文生视频：发确定秒数而非 auto，不指定镜头运动时不发该字段', async () => {
    const { endpoint, body } = await route({ ...defaults, prompt: ' 海浪 ' })
    expect(endpoint).toBe('lightricks/ltx-2.5/text-to-video/fast')
    expect(body).toEqual({ prompt: '海浪', duration: 6, resolution: '1080p', fps: 25, generate_audio: true, aspect_ratio: '16:9' })
    expect(price({ ...defaults })).toBeCloseTo(0.13 * 6)
  })

  it('图生与首尾帧走 image-to-video，智能比例发 auto，镜头运动按官方枚举发送', async () => {
    const params = { ...defaults, prompt: 'x', falLtx25FastMode: false, falLtx25Resolution: '720p', falLtx25CameraMotion: 'dolly_in', images: ['https://cdn/a.png', 'https://cdn/b.png'] }
    const { endpoint, body } = await route(params)
    expect(endpoint).toBe('lightricks/ltx-2.5/image-to-video/pro')
    expect(body).toMatchObject({ image_url: 'https://cdn/a.png', end_image_url: 'https://cdn/b.png', aspect_ratio: 'auto', camera_motion: 'dolly_in', resolution: '720p' })
    expect(price(params)).toBeCloseTo(0.12 * 6)
  })

  it('Pro 档把快速档独有的分辨率与帧率收回到 Pro 合法值，超过 10 秒拒绝', async () => {
    const pro = { ...defaults, prompt: 'x', falLtx25FastMode: false, falLtx25Resolution: '2160p', falLtx25Fps: 48 }
    const { body } = await route(pro)
    expect(body).toMatchObject({ resolution: '1080p', fps: 25 })
    expect(() => build({ ...pro, falLtx25Duration: 20 })).toThrow('超过 10 秒')
  })

  it('快速档长时长只允许 720p/1080p 与 24/25 帧', async () => {
    const long = { ...defaults, prompt: 'x', falLtx25Duration: 20, falLtx25Resolution: '720p', falLtx25Fps: 24 }
    expect((await route(long)).body).toMatchObject({ duration: 20, resolution: '720p', fps: 24 })
    expect(price(long)).toBeCloseTo(0.09 * 20)
    expect(() => build({ ...long, falLtx25Fps: 50 })).toThrow('超过 10 秒')
    expect(() => build({ ...long, falLtx25Resolution: '1440p' })).toThrow('超过 10 秒')
  })

  it('音频生视频按档位选端点，只发官方字段；按音频时长计价，读不到时按档位上限估', async () => {
    const params = { ...defaults, falLtx25Mode: 'audio-to-video', falLtx25AspectRatio: '9:16', prompt: '歌手演唱', uploadedAudioFilePaths: ['https://cdn/song.mp3'] }
    const { endpoint, body } = await route(params)
    expect(endpoint).toBe('lightricks/ltx-2.5/audio-to-video/fast')
    expect(body).toEqual({ audio_url: 'https://cdn/song.mp3', aspect_ratio: '9:16', prompt: '歌手演唱' })
    await expect(selector({ ...params, falLtx25FastMode: false })).resolves.toBe('lightricks/ltx-2.5/audio-to-video/pro')
    expect(price({ ...params, __audioDurationSeconds: 7.5 })).toBeCloseTo(0.13 * 7.5)
    expect(price(params)).toBeCloseTo(0.13 * 20)
    expect(price({ ...params, falLtx25FastMode: false })).toBeCloseTo(0.17 * 10)
    expect(() => build({ ...params, uploadedAudioFilePaths: [] })).toThrow('需要上传 1 段音频')
    expect(() => build({ ...params, prompt: '' })).toThrow('需要填写提示词')
    // 标准档音频最长 10 秒，快速档 20 秒：超长在本地拦下，不交给供应商才被拒
    expect(() => build({ ...params, falLtx25FastMode: false, __audioDurationSeconds: 12 })).toThrow('最长 10 秒')
    expect(build({ ...params, __audioDurationSeconds: 12 })).toMatchObject({ audio_url: 'https://cdn/song.mp3' })
  })
})
