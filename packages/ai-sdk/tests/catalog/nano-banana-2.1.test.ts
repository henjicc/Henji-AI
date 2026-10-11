import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apimartNanoBanana21Model as apimart } from '../../src/catalog/apimart/nano-banana-2.1.model'
import { kieNanoBanana21Model as kie } from '../../src/catalog/kie/nano-banana-2.1.model'
import { falNanoBanana21Model as fal } from '../../src/catalog/fal/nano-banana-2.1.model'
import { grsaiNanoBanana21Model as grsai } from '../../src/catalog/grsai/nano-banana-2.1.model'
import type { JsonObject } from '../../src/types/runtime'
import type { ModelRuntimeDefinition } from '../../src/types/model'

const build = async (model: ModelRuntimeDefinition, params: JsonObject = {}) => await model.request!.builder!({ prompt: 'fixture prompt', ...params }) as JsonObject
const fixture = (name: string): { examples: JsonObject[]; officialOpenApiYaml?: string } => JSON.parse(readFileSync(resolve(__dirname, '../fixtures/nano-banana-2.1', `${name}.json`), 'utf8'))

describe('Nano Banana 2.1 官方请求契约', () => {
  it('APIMart 官方字面请求及Ext分别映射，输出数量不可混用', async () => {
    for (const sample of fixture('apimart').examples.filter(e => typeof e.model === 'string' && typeof e.prompt === 'string')) {
      const ext = sample.model === 'gemini-nano-banana-2.1-ext'
      const actual = await build(apimart, { prompt: sample.prompt, apimartNanoBanana21Channel: ext ? 'ext' : 'official',
        apimartNanoBanana21AspectRatio: sample.size ?? 'smart', apimartNanoBanana21Resolution: sample.resolution ?? '1K',
        apimartNanoBanana21NumImages: sample.n ?? 1, images: sample.image_urls ?? [] })
      expect(actual).toMatchObject(Object.fromEntries(Object.entries(sample).filter(([key]) => ['model', 'prompt', 'size', 'resolution', 'n', 'image_urls'].includes(key))))
    }
    expect(await build(apimart, { apimartNanoBanana21NumImages: 4 })).toMatchObject({ n: 4 })
    await expect(build(apimart, { apimartNanoBanana21Channel: 'ext', apimartNanoBanana21NumImages: 2 })).rejects.toThrow()
    await expect(build(apimart, { apimartNanoBanana21Channel: 'ext', apimartNanoBanana21Resolution: '2K', apimartNanoBanana21AspectRatio: '8:1' })).rejects.toThrow()
    expect(await build(apimart, { apimartNanoBanana21Channel: 'ext' })).toMatchObject({ official_fallback: false })
  })

  it('KIE保持原生auto与格式、10图边界和20000字符，不截断', async () => {
    expect(fixture('kie').officialOpenApiYaml).toContain('maxItems: 10')
    const images = Array.from({ length: 10 }, (_, i) => `https://example.invalid/${i}.png`)
    expect(await build(kie, { images, prompt: '字'.repeat(20000) })).toMatchObject({ model: 'nano-banana-2-1', input: { image_input: images, aspect_ratio: 'auto', resolution: '1K', output_format: 'jpg' } })
    await expect(build(kie, { images: [...images, 'extra.png'] })).rejects.toThrow()
    await expect(build(kie, { prompt: '字'.repeat(20001) })).rejects.toThrow()
  })

  it('Fal生成/编辑以素材自动选路，PDF只有上传入口，不发送旧audio或off思考', async () => {
    const endpoints = fal.endpoints
    if (typeof endpoints !== 'object' || !endpoints.selector) throw new Error('缺少路由')
    expect(await endpoints.selector({})).toBe('google/nano-banana-2.1')
    for (const media of [{ images: ['a.png'] }, { uploadedVideos: ['v.mp4'] }, { falNanoBanana21Pdf: ['f.pdf'] }]) {
      expect(await endpoints.selector(media)).toBe('google/nano-banana-2.1/edit')
    }
    for (const name of ['fal-generation', 'fal-edit']) {
      for (const sample of fixture(name).examples.filter(e => typeof e.prompt === 'string')) {
        const actual = await build(fal, { prompt: sample.prompt, images: sample.image_urls ?? [],
          falNanoBanana21AspectRatio: sample.aspect_ratio ?? 'smart', falNanoBanana21NumImages: sample.num_images ?? 1,
          falNanoBanana21Resolution: sample.resolution ?? '1K', falNanoBanana21Thinking: sample.thinking_level ?? 'medium',
          falNanoBanana21LimitGenerations: sample.limit_generations ?? true })
        expect(actual).toMatchObject(Object.fromEntries(Object.entries(sample).filter(([key]) => ['prompt', 'image_urls', 'aspect_ratio', 'num_images', 'resolution', 'thinking_level', 'limit_generations'].includes(key))))
      }
    }
    expect(await build(fal, { falNanoBanana21Pdf: ['f.pdf'], videos: ['v.mp4'], audios: ['old.mp3'] })).toMatchObject({ pdf_url: 'f.pdf', video_url: 'v.mp4', thinking_level: 'medium' })
    expect(await build(fal, { audios: ['old.mp3'] })).not.toHaveProperty('audio_url')
    await expect(build(fal, { falNanoBanana21Thinking: 'off' })).rejects.toThrow()
    await expect(build(fal, { falNanoBanana21NumImages: 5 })).rejects.toThrow()
  })

  it('Grsai公告只替换model；未公布图数量的渠道不套用旧14张限制', async () => {
    const literal = fixture('grsai').examples[0]
    expect(await build(grsai, { prompt: literal.prompt, grsaiNanoBanana21AspectRatio: literal.aspectRatio })).toEqual({ model: 'nano-banana-2.1', prompt: literal.prompt, aspectRatio: '1:1', imageSize: '1K' })
    const images = Array.from({ length: 25 }, (_, i) => `${i}.png`)
    expect(await build(grsai, { images })).toMatchObject({ images })
    expect(await build(apimart, { uploadedImages: images })).toMatchObject({ image_urls: images })
    expect(await build(fal, { images })).toMatchObject({ image_urls: images })
  })

  it.each([apimart, kie, fal, grsai])('$meta.id拒绝非法分辨率与空提示词', async model => {
    await expect(build(model, { prompt: '' })).rejects.toThrow()
    const id = model.params.find(p => p.id.endsWith('Resolution'))!.id
    await expect(build(model, { [id]: '0.5K' })).rejects.toThrow()
  })

  it('按供应商计费契约估算，Fal没有旧版搜索/思考固定加价', () => {
    expect(apimart.pricing.calculator!({ apimartNanoBanana21Resolution: '4K', apimartNanoBanana21NumImages: 4 })).toBeCloseTo(0.09072 * 4)
    expect(apimart.pricing.calculator!({ apimartNanoBanana21Channel: 'ext', apimartNanoBanana21Resolution: '4K' })).toBe(0.03)
    expect(kie.pricing.calculator!({ kieNanoBanana21Resolution: '4K' })).toBe(0.045)
    expect(fal.pricing.calculator!({ falNanoBanana21Resolution: '4K', falNanoBanana21NumImages: 2 })).toBeCloseTo(0.268)
    expect(fal.pricing.calculator!({ falNanoBanana21WebSearch: true, falNanoBanana21Thinking: 'high' })).toBe(0.04)
    expect(grsai.pricing.calculator!({ grsaiNanoBanana21Resolution: '4K' })).toBe(0.12)
  })
})
