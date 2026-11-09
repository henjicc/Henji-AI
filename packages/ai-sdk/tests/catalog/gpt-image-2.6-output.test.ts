import { describe, expect, it } from 'vitest'

import { apimartGptImage26Model } from '../../src/catalog/apimart/gpt-image-2.6.model'
import { falGptImage26Model } from '../../src/catalog/fal/gpt-image-2.6.model'
import { kieGptImage26Model } from '../../src/catalog/kie/gpt-image-2.6.model'
import { gpt26FalFrame, gpt26SheetFrame } from '../../src/catalog/shared/gptImage26Output'
import type { ModelRuntimeDefinition } from '../../src/types/model'
import type { JsonObject } from '../../src/types/runtime'

const build = async (model: ModelRuntimeDefinition, params: JsonObject) => await model.request!.builder!({ prompt: 'A lantern', ...params }) as JsonObject
const route = (params: JsonObject) => {
  const endpoints = falGptImage26Model.endpoints
  return typeof endpoints === 'object' && 'selector' in endpoints ? endpoints.selector({ prompt: 'x', ...params }) : endpoints
}
const img = (n: number) => Array.from({ length: n }, (_, i) => `https://example.invalid/${i}.png`)

describe('GPT Image 2.6 动图与矢量图', () => {
  it('拼图规则：单帧按 512×512 面积换算，按取整后的实际尺寸判断拼图宽高比', () => {
    expect(gpt26SheetFrame('1:1', 9)).toEqual({ width: 512, height: 512, sheetPixels: 512 * 512 * 9 })
    // 16:9 的 4×2 拼图宽高比约 3.6，无法靠缩小解决。
    expect(() => gpt26SheetFrame('16:9', 6)).toThrow(/3:1/)
    // 3:1 单帧取整为 880×288，3×3 拼图 2640×864 超过 3:1。
    expect(() => gpt26SheetFrame('3:1', 9)).toThrow(/3:1/)
    const wide = gpt26SheetFrame('16:9', 9)
    expect(wide.width % 16).toBe(0)
    expect(wide.width * 3).toBeLessThanOrEqual(3840)
  })

  it('Fal 单帧不低于 655,360 像素，帧数超出 8,294,400 像素预算时给出最多帧数', () => {
    const frame = gpt26FalFrame('1:1', 9)
    expect(frame.width * frame.height).toBeGreaterThanOrEqual(655_360)
    expect(frame.width % 16 + frame.height % 16).toBe(0)
    expect(() => gpt26FalFrame('1:1', 16)).toThrow(/最多 12 帧/)
  })

  it('APIMart 官方渠道：动图换单帧像素尺寸、去掉分辨率与背景；矢量图只发 1 张并带矢量化模型', async () => {
    const gif = await build(apimartGptImage26Model, { gpt26Channel: 'official', gpt26Output: 'gif', gpt26AspectRatio: '1:1', gpt26FrameCount: 12, gpt26FrameDuration: 155, images: img(2) })
    expect(gif).toMatchObject({ output_format: 'gif', size: '512x512', frame_count: 12, frame_duration_ms: 160, image_urls: img(2) })
    expect(gif).not.toHaveProperty('resolution')
    expect(gif).not.toHaveProperty('background')
    const svg = await build(apimartGptImage26Model, { gpt26Channel: 'official', gpt26Output: 'svg', gpt26Count: 4 })
    expect(svg).toMatchObject({ output_format: 'svg', n: 1, svg: { model: 'gpt-5.4-mini' } })
    await expect(build(apimartGptImage26Model, { gpt26Channel: 'official', gpt26Output: 'svg', images: img(1) })).rejects.toThrow(/只支持文生图/)
    // 智能比例在少帧数（4×2 拼图）下只挑拼得出来的比例：16:9 的首图落到 3:2。
    const smart = await build(apimartGptImage26Model, { gpt26Channel: 'official', gpt26Output: 'gif', gpt26FrameCount: 6, images: img(1), __firstImageRatio: 16 / 9 })
    expect(smart.size).toBe(`${Math.floor(512 * Math.sqrt(1.5) / 16) * 16}x${Math.floor(512 / Math.sqrt(1.5) / 16) * 16}`)
    // Ext 渠道不开放输出类型，残留值不进入请求。
    expect(await build(apimartGptImage26Model, { gpt26Channel: 'ext', gpt26Output: 'svg' })).not.toHaveProperty('output_format')
  })

  it('Fal：动图在编辑端点也可用，固定 1 份输出；矢量图走文生图端点', async () => {
    expect(route({ falGptImage26Output: 'gif', images: img(1) })).toBe('openai/gpt-image-2.6/flare/edit')
    const gif = await build(falGptImage26Model, { falGptImage26Output: 'gif', falGptImage26Count: 4, images: img(1), falGptImage26Mask: ['https://example.invalid/m.png'] })
    expect(gif).toMatchObject({ output_format: 'gif', num_images: 1, frame_count: 9, frame_duration_ms: 200 })
    expect(gif).not.toHaveProperty('mask_url')
    expect(gif).not.toHaveProperty('background')
    const svg = await build(falGptImage26Model, { falGptImage26Output: 'svg', falGptImage26SvgModel: 'gpt-5.5' })
    expect(svg).toMatchObject({ output_format: 'svg', svg_model: 'gpt-5.5', num_images: 1 })
    await expect(build(falGptImage26Model, { falGptImage26Output: 'svg', images: img(1) })).rejects.toThrow(/只支持文生图/)
  })

  it('KIE：动图与矢量图只能文生图，Economy 没有矢量图', async () => {
    await expect(build(kieGptImage26Model, { kieGpt26Output: 'gif', images: img(1) })).rejects.toThrow(/只支持文生图/)
    await expect(build(kieGptImage26Model, { kieGpt26Variant: 'economy', kieGpt26Output: 'svg' })).rejects.toThrow(/Economy/)
    const gif = await build(kieGptImage26Model, { kieGpt26Output: 'gif', kieGpt26AspectRatio: '1:1' })
    expect(gif.input).toMatchObject({ output_format: 'gif', size: '512x512', frame_count: 9 })
    expect(gif.input).not.toHaveProperty('aspect_ratio')
  })

  it('估价：动图按整张拼图的像素折算输出 token', () => {
    const calc = (params: JsonObject) => apimartGptImage26Model.pricing!.calculator!({ gpt26Channel: 'official', gpt26AspectRatio: '1:1', gpt26Quality: 'high', ...params })
    const gif = calc({ gpt26Output: 'gif', gpt26FrameCount: 9 })
    // 3×3 拼图 1536×1536 是 1024×1024 的 2.25 倍：1756 × 2.25 token × $24/1M。
    expect(gif).toBeCloseTo(Math.ceil(1756 * 2.25) * 24 / 1_000_000, 6)
  })
})
