import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apimartGptImage25Model as apimart } from '../../src/catalog/apimart/gpt-image-2.5.model'
import { falGptImage25Model as fal } from '../../src/catalog/fal/gpt-image-2.5.model'
import { grsaiGptImage25Model as grsai } from '../../src/catalog/grsai/gpt-image-2.5.model'
import { kieGptImage25Model as kie } from '../../src/catalog/kie/gpt-image-2.5.model'
import { GPT25_OUTPUT_REFERENCE } from '../../src/catalog/shared/gptImage25Pricing'
import { GRSAI_GPT25_SIZES } from '../../src/catalog/grsai/gptImage25Sizes'
import type { JsonObject, JsonValue } from '../../src/types/runtime'
import type { ModelRuntimeDefinition } from '../../src/types/model'

const models = [apimart, fal, grsai, kie]
const build = async (model: ModelRuntimeDefinition, params: JsonObject = {}) => await model.request!.builder!({ prompt: 'A product photo', ...params }) as JsonObject
function fixture(name: string): { examples: JsonObject[]; requestSchema: { properties: { model: { enum: string[] }; input: { properties: Record<string, { enum?: string[] }> } } } } {
  return JSON.parse(readFileSync(resolve(__dirname, '../fixtures/gpt-image-2.5', `${name}.json`), 'utf8'))
}

describe('GPT Image 2.5 official request contracts', () => {
  it.each(['flare', 'sunburst'])('KIE %s follows each official branch and its enum set', async variant => {
    for (const mode of ['t2i', 'i2i']) {
      const official = fixture(`kie-${variant}-${mode}`).requestSchema
      const params = mode === 'i2i' ? { images: ['https://example.invalid/input.png'] } : {}
      const body = await build(kie, { ...params, gpt25Variant: variant })
      expect(official.properties.model.enum).toContain(body.model)
      const input = body.input as JsonObject
      expect(Object.keys(input).every(key => key in official.properties.input.properties)).toBe(true)
      for (const [key, schema] of Object.entries(official.properties.input.properties)) {
        if (schema.enum && input[key] !== undefined) expect(schema.enum).toContain(input[key])
      }
      expect(input.input_urls).toEqual(mode === 'i2i' ? params.images : undefined)
    }
  })

  it.each(['flare', 'sunburst'])('Fal %s uses the new endpoint and ten-output contract', async variant => {
    for (const images of [[], ['https://example.invalid/ref.png']]) {
      const params = { images, gpt25Variant: variant, gpt25Count: 10, gpt25Quality: 'max', gpt25Background: 'transparent' }
      const route = fal.endpoints
      if (typeof route !== 'object' || !('selector' in route)) throw new Error('Missing selector')
      expect(await route.selector(params)).toBe(`openai/gpt-image-2.5/${variant}/${images.length ? 'edit' : 'text-to-image'}`)
      expect(await build(fal, params)).toMatchObject({ num_images: 10, quality: 'max', background: 'transparent', image_size: { width: 1024, height: 1024 } })
    }
  })

  it('APIMart reproduces official JSON examples without optional output format', async () => {
    const direct = fixture('apimart').examples.find(e => e.model === 'gpt-image-2.5-flare' && e.quality === 'high' && e.size === '16:9')!
    expect(await build(apimart, { prompt: direct.prompt, gpt25Channel: 'official', gpt25Resolution: '2K', gpt25AspectRatio: '16:9', gpt25Quality: 'high' })).toEqual({ ...direct, background: 'auto' })
    const ext = fixture('apimart-ext').examples.find(e => e.version === 'sunburst' && e.n === 2)!
    expect(await build(apimart, { prompt: ext.prompt, gpt25Variant: 'sunburst', gpt25Resolution: '2K', gpt25AspectRatio: '16:9', gpt25Count: 2, images: ext.image_urls })).toEqual(ext)
  })

  it('keeps APIMart Ext branch free of official-only fields', async () => {
    const body = await build(apimart, { gpt25Quality: 'max', gpt25Background: 'transparent' })
    expect(body).toEqual({ model: 'gpt-image-2.5-ext', version: 'flare', prompt: 'A product photo', size: '1:1', resolution: '1K', n: 1 })
  })

  it.each(['uploadedFilePaths', 'images', 'uploadedImages'])('routes and estimates smart ratios from %s', async key => {
    for (const model of models) {
      const body = await build(model, { [key]: ['https://example.invalid/ref.png'], __firstImageRatio: 16 / 9 })
      const media = body.images ?? body.image_urls ?? (body.input as JsonObject)?.input_urls
      expect(media).toEqual(['https://example.invalid/ref.png'])
    }
    expect((await build(kie, { [key]: ['x'], __firstImageRatio: 27 / 16 })).input).toMatchObject({ aspect_ratio: '27:16' })
    expect((await build(kie, { [key]: ['x'], __firstImageRatio: 27 / 16, gpt25Resolution: '4K' })).input).toMatchObject({ aspect_ratio: '16:9' })
    expect((await build(kie, { __firstImageRatio: 27 / 16 })).input).toMatchObject({ aspect_ratio: '1:1' })
  })

  it('applies Grsai version-specific pixels, quality and background', async () => {
    expect(await build(grsai, { gpt25Variant: 'standard', gpt25Resolution: '4K', gpt25Quality: 'max', gpt25Transparent: true })).toEqual({ model: 'gpt-image-2.5', prompt: 'A product photo', aspectRatio: '1:1' })
    expect(await build(grsai, { gpt25Variant: 'sunburst', gpt25Resolution: '4K', gpt25Quality: 'max', gpt25Transparent: true, gpt25AspectRatio: '3:2' })).toMatchObject({ model: 'gpt-image-2.5-sunburst', aspectRatio: '3504x2336', quality: 'max', background: 'transparent' })
    expect(await build(grsai)).toMatchObject({ model: 'gpt-image-2.5-flare', quality: 'medium' })
  })

  it('keeps all explicit pixel sizes within the official constraints', () => {
    const sizes = [...Object.values(GPT25_OUTPUT_REFERENCE).map(s => [s.width, s.height]), ...Object.values(GRSAI_GPT25_SIZES).flatMap(row => Object.values(row).map(s => s!.split('x').map(Number)))]
    for (const [width, height] of sizes) {
      expect(width % 16).toBe(0); expect(height % 16).toBe(0)
      expect(Math.max(width, height)).toBeLessThanOrEqual(3840)
      expect(Math.max(width / height, height / width)).toBeLessThanOrEqual(3)
      expect(width * height).toBeGreaterThanOrEqual(655360)
      expect(width * height).toBeLessThanOrEqual(8294400)
    }
  })

  it('estimates current prices by branch, quality, size and count', () => {
    expect(kie.pricing!.calculator!({ gpt25Resolution: '4K' })).toBe(0.08)
    expect(apimart.pricing!.calculator!({ gpt25Resolution: '2K', gpt25Count: 3 })).toBeCloseTo(0.042)
    expect(apimart.pricing!.calculator!({ gpt25Channel: 'official', gpt25Quality: 'high' })).toBeCloseTo(1756 * 24 / 1e6)
    expect(fal.pricing!.calculator!({ gpt25Quality: 'max', gpt25Resolution: '2K', gpt25Count: 2 })).toBeCloseTo(14272 * 30 / 1e6 * 2)
    expect(grsai.pricing!.calculator!({ gpt25Variant: 'sunburst' })).toBe(0.24)
  })

  it.each(models)('$meta.id rejects invalid input instead of silently truncating it', async model => {
    await expect(build(model, { prompt: '' })).rejects.toThrow()
    await expect(build(model, { images: Array(17).fill('https://example.invalid/ref.png') })).rejects.toThrow()
    expect(await build(model)).not.toHaveProperty('output_format')
  })

  it('synthetic-negative: rejects unsupported combinations and empty masks', async () => {
    const cases: Array<[ModelRuntimeDefinition, JsonObject]> = [
      [kie, { prompt: 'x'.repeat(20001) }], [kie, { gpt25Resolution: '2K', gpt25AspectRatio: '9:8' }],
      [grsai, { gpt25Variant: 'flare', gpt25Quality: 'max' }], [grsai, { gpt25Resolution: '2K', gpt25AspectRatio: '3:1' }],
      [fal, { gpt25Count: 11 }], [apimart, { gpt25Count: 5 }], [fal, { gpt25Count: '2' }],
      [fal, { gpt25Mask: ['mask'] }], [fal, { images: ['ref'], gpt25Mask: [''] }],
    ]
    for (const [model, params] of cases) await expect(build(model, params)).rejects.toThrow()
  })

  it.each(['uploadedFilePaths', 'images', 'uploadedImages'])('mask visibility supports %s and source removal', key => {
    const visible = fal.params.find(p => p.id === 'gpt25Mask')!.visible as { condition: (p: Record<string, JsonValue>) => boolean }
    expect(visible.condition({ [key]: ['ref'] })).toBe(true)
    expect(visible.condition({ [key]: [] })).toBe(false)
  })
})
