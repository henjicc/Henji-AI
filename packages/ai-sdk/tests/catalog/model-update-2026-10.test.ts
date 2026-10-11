import { describe, expect, it } from 'vitest'
import { apimartSeedance20MiniModel as mini } from '../../src/catalog/apimart/seedance-2.0-mini.model'
import { kieSeedance25Model as seedance } from '../../src/catalog/kie/seedance-2.5.model'
import { kieMiniMaxH3Model as h3 } from '../../src/catalog/kie/minimax-h3.model'
import { apimartGeminiOmniFlashModel as omni } from '../../src/catalog/apimart/gemini-omni-flash.model'
import { falMiniMaxH3Model as falH3 } from '../../src/catalog/fal/minimax-h3.model'
import { bailianQwenAudio31TtsFlashModel as tts } from '../../src/catalog/bailian/qwen-audio-3.1-tts-flash.model'
import type { JsonObject } from '../../src/types/runtime'

describe('2026-10首批改价与参数', () => {
  it.each([['480p', 0.01815, 0.01105], ['720p', 0.03903, 0.02376]] as const)('APIMart Mini %s四个费率档', (resolution, withoutVideo, withVideo) => {
    expect(mini.pricing.calculator!({ apimartSeedance20MiniResolution: resolution, apimartSeedance20MiniDuration: 5 })).toBeCloseTo(5 * withoutVideo)
    expect(mini.pricing.calculator!({ apimartSeedance20MiniMode: 'reference-to-video', apimartSeedance20MiniResolution: resolution, apimartSeedance20MiniDuration: 5, videos: ['video.mp4'], __firstVideoDurationSeconds: 3 })).toBeCloseTo(8 * withVideo, 8)
  })
  it('KIE Seedance2.5及H3按输入与输出计价，参考图第6张起收费', () => {
    expect(seedance.pricing.calculator!({ kieSeedance25Resolution: '1080p', kieSeedance25Duration: 10 })).toBeCloseTo(7.9)
    expect(seedance.pricing.calculator!({ kieSeedance25Mode: 'reference-to-video', kieSeedance25Resolution: '1080p', kieSeedance25Duration: 10, uploadedVideos: ['v.mp4'], __firstVideoDurationSeconds: 3 })).toBeCloseTo(13 * 0.475)
    expect(seedance.pricing.calculator!({ kieSeedance25Mode: 'reference-to-video', kieSeedance25Resolution: '1080p', kieSeedance25Duration: 10, videos: ['v1.mp4', 'v2.mp4'], __videoDurationSeconds: [2, 5] })).toBeCloseTo(17 * 0.475)
    for (const [resolution, rate] of [['768P', 0.04], ['2K', 0.065]] as const) {
      expect(h3.pricing.calculator!({ kieMiniMaxH3Resolution: resolution, kieMiniMaxH3Duration: 6, images: Array(7).fill('image.png'), videos: ['v.mp4'], __firstVideoDurationSeconds: 3 })).toBeCloseTo(9 * rate + 0.04)
    }
  })
  it.each([['4', 0.15], ['6', 0.175], ['8', 0.2], ['10', 0.225]] as const)('Omni Ext360p %s秒', (duration, cost) => {
    const params = { apimartGeminiOmniFlashChannel: 'ext', apimartGeminiOmniFlashResolution: '360p', apimartGeminiOmniFlashExtDuration: duration }
    expect(omni.request!.builder!({ ...params, prompt: 'fixture' })).toMatchObject({ model: 'gemini-omni-1.1-flash-ext', resolution: '360p', duration: Number(duration) })
    expect(omni.pricing.calculator!(params)).toBe(cost)
    expect(omni.pricing.calculator!({ ...params, uploadedVideos: ['v.mp4'] })).toBe(0.04)
  })
  it('Omni按渠道分别限制图数量，preview16、Ext3、Ext首帧1', () => {
    const images = Array(16).fill('image.png')
    expect(omni.request!.builder!({ prompt: 'fixture', images })).toMatchObject({ image_urls: images })
    expect(() => omni.request!.builder!({ prompt: 'fixture', images: [...images, 'extra.png'] })).toThrow()
    expect(() => omni.request!.builder!({ prompt: 'fixture', apimartGeminiOmniFlashChannel: 'ext', images })).toThrow()
  })
  it.each(['text-to-video', 'image-to-video', 'reference-to-video'])('Fal H3 %s扩写开关使用统一字段', async mode => {
    const images = mode === 'text-to-video' ? [] : ['first.png']
    if (typeof falH3.endpoints !== 'object' || !falH3.endpoints.selector) throw new Error('缺少路由')
    expect(await falH3.endpoints.selector({ falMiniMaxH3Mode: mode, images })).toBe(`minimax/h3/${mode}`)
    for (const enabled of [true, false]) {
      const body = falH3.request!.builder!({ prompt: 'fixture', falMiniMaxH3Mode: mode, falMiniMaxH3PromptExpansion: enabled, falMiniMaxH3PromptExpansionMode: 'quality', images }) as JsonObject
      expect(body.prompt_expansion_mode).toBe(enabled ? 'quality' : 'disabled')
      expect(body).not.toHaveProperty('enable_prompt_expansion')
    }
  })
  it('Qwen TTS估算为有限值，按全文预算与语速单调变化，无长度上限', () => {
    const price = tts.pricing.calculator!({ text: '甲'.repeat(100) })
    expect(price).toBeCloseTo((300 * 1.5 + 10000 * 12) / 1e6)
    expect(tts.pricing.calculator!({ text: '甲'.repeat(100), bailianQwenTtsSpeed: 0.5 })).toBeGreaterThan(price)
    expect(tts.pricing.calculator!({ text: '甲'.repeat(100000) })).toBeGreaterThan(price)
    expect(tts.pricing.description).toContain('估算上限')
    expect(tts.pricing.estimateKind).toBe('upper-bound')
  })
})
