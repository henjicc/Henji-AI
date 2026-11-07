import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { falLtx23Model } from '../../src/catalog/fal/ltx-2.3.model'
import { resolvePricingMediaContext, type PricingMediaMetadataReaders } from '../../src'
import type { JsonObject } from '../../src/types/runtime'

const selector = (falLtx23Model.endpoints as { selector: (params: JsonObject) => Promise<string> }).selector
const build = (params: JsonObject) => falLtx23Model.request.builder(params) as JsonObject
const price = (params: JsonObject) => falLtx23Model.pricing.calculator!(params)

const readers: PricingMediaMetadataReaders = {
  image: async () => ({ width: 1, height: 1, fileSizeBytes: 1 }),
  video: async () => ({ width: 1, height: 1, durationSeconds: 1 }),
  audio: async () => ({ durationSeconds: 7.5 }),
}

interface RequestSchema { required: string[]; properties: Record<string, { enum?: string[] }> }
const officialSchema = (JSON.parse(readFileSync(
  resolve(__dirname, '../fixtures/model-requests-2026-11/fal-ltx-2.3-audio-to-video.json'), 'utf8',
)) as { requestSchema: RequestSchema }).requestSchema

function expectOfficialBody(body: JsonObject): void {
  for (const field of officialSchema.required) expect(body).toHaveProperty(field)
  for (const [field, value] of Object.entries(body)) {
    expect(officialSchema.properties).toHaveProperty(field)
    const allowed = officialSchema.properties[field].enum
    if (allowed) expect(allowed).toContain(value)
  }
}

describe('Fal LTX-2.3 音频生视频', () => {
  it('按官方 schema 发 audio_url、可选首帧与提示词，智能比例发 auto，不发其他模式的字段', async () => {
    const params = {
      falLtx23Mode: 'audio-to-video', falLtx23AspectRatio: 'smart', falLtx23Duration: 10, falLtx23Fps: 50,
      prompt: ' 一个人对着麦克风低语 ', uploadedAudioFilePaths: ['https://cdn/voice.mp3'], uploadedFilePaths: ['https://cdn/face.png'],
    }
    await expect(selector(params)).resolves.toBe('fal-ai/ltx-2.3/audio-to-video')
    const withImage = build(params)
    expect(withImage).toEqual({
      audio_url: 'https://cdn/voice.mp3', image_url: 'https://cdn/face.png', prompt: '一个人对着麦克风低语', aspect_ratio: 'auto',
    })
    const promptOnly = build({ falLtx23Mode: 'audio-to-video', falLtx23AspectRatio: '9:16', audios: ['https://cdn/voice.mp3'], prompt: 'x' })
    expect(promptOnly).toEqual({ audio_url: 'https://cdn/voice.mp3', prompt: 'x', aspect_ratio: '9:16' })
    expectOfficialBody(withImage)
    expectOfficialBody(promptOnly)
  })

  it('缺音频或无图又无提示词时拒绝提交', () => {
    expect(() => build({ falLtx23Mode: 'audio-to-video', prompt: 'x' })).toThrow('需要上传 1 段音频')
    expect(() => build({ falLtx23Mode: 'audio-to-video', uploadedAudios: ['a.mp3'] })).toThrow('需要填写提示词')
    expect(build({ falLtx23Mode: 'audio-to-video', uploadedAudios: ['a.mp3'], images: ['f.png'] }))
      .toEqual({ audio_url: 'a.mp3', image_url: 'f.png', aspect_ratio: 'auto' })
  })

  it('按探针补齐的音频时长 × $0.10 估价，读不到时按 20 秒上限估，其他模式不读音频', async () => {
    const audioParams = { falLtx23Mode: 'audio-to-video', audios: ['a.mp3'] }
    const resolved = await resolvePricingMediaContext(falLtx23Model.pricing.mediaContext, audioParams, readers)
    expect(resolved).toMatchObject({ complete: true, params: { __audioDurationSeconds: 7.5 } })
    expect(price(resolved.params)).toBeCloseTo(0.75)
    expect(price(audioParams)).toBeCloseTo(2)

    const textParams = { falLtx23Mode: 'text-image-to-video', falLtx23Duration: 6 }
    await expect(resolvePricingMediaContext(falLtx23Model.pricing.mediaContext, textParams, readers))
      .resolves.toEqual({ params: textParams, complete: true, missingTargets: [] })
  })
})
