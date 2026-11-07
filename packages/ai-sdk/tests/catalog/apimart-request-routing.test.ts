import { describe, expect, it } from 'vitest'

import { catalogIndex, type JsonObject } from '@henjicc/ai-sdk'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { registry } from '@/core/ModelRegistry'
import { apimartPresentation } from '@/models/presentation/apimart'

const IDS = [
  'apimart-gpt-image-2.6', 'apimart-kling-4.0', 'apimart-gemini-omni-1.2-flash', 'apimart-wan-3.0',
  'apimart-grok-imagine-video-1.5', 'apimart-minimax-h3-max', 'apimart-flux-3-image', 'apimart-veo-3.1',
  'apimart-seedream-5.0-flash', 'apimart-happyhorse-1.1',
]

function model(id: string) {
  const runtime = catalogIndex.get(id)
  expect(runtime).toBeDefined()
  return runtime!
}

const build = (id: string, params: JsonObject) => model(id).request!.builder!({ prompt: 'test', ...params })
const price = (id: string, params: JsonObject) => model(id).pricing!.calculator!(params)
const img = (count: number) => Array.from({ length: count }, (_, index) => `https://example.com/${index}.png`)
const vid = ['https://example.com/in.mp4']

describe('APIMart 渠道、版本与模式路由', () => {
  it('展示补丁能与运行时定义合成并通过参数约定校验', () => {
    for (const id of IDS) {
      expect(() => registry.register(composeModelDefinition(model(id), apimartPresentation[id]))).not.toThrow()
    }
  })

  it('GPT Image 2.6：Ext 固定 1k 单张并用 version，官方渠道按变体换模型名', async () => {
    const extBody = await build('apimart-gpt-image-2.6', { gpt26Channel: 'ext', gpt26Variant: 'sunburst', gpt26Resolution: '4K', gpt26Count: 4 })
    expect(extBody).toMatchObject({ model: 'gpt-image-2.6-ext', version: 'sunburst', resolution: '1k', n: 1 })
    expect(extBody).not.toHaveProperty('background')
    const official = await build('apimart-gpt-image-2.6', { gpt26Channel: 'official', gpt26Variant: 'sunburst', gpt26Resolution: '2K', gpt26Count: 2 })
    expect(official).toMatchObject({ model: 'gpt-image-2.6-sunburst', resolution: '2k', n: 2, background: 'auto', complexity: 'high' })
    expect(official).not.toHaveProperty('version')
    // 1:1 1K low：2.5 的 196 token × 4.2 → 824 token × $24/1M。
    expect(price('apimart-gpt-image-2.6', { gpt26Channel: 'official', gpt26AspectRatio: '1:1', gpt26Quality: 'low' })).toBeCloseTo(0.019776, 6)
  })

  it('Kling V4：按模式发送首尾帧、参考、编辑与续写字段', async () => {
    expect(await build('apimart-kling-4.0', { uploadedFilePaths: img(2) })).toMatchObject({ model: 'kling-v4', image_urls: img(2), duration: 5 })
    const reference = await build('apimart-kling-4.0', { apimartKlingV4Mode: 'reference-to-video', uploadedFilePaths: img(3), uploadedVideoFilePaths: vid })
    expect(reference).toMatchObject({ omni_reference_task_type: 'reference', aspect_ratio: 'auto', video_urls: vid })
    const edit = await build('apimart-kling-4.0', { apimartKlingV4Mode: 'edit', uploadedVideoFilePaths: vid })
    expect(edit).toMatchObject({ omni_reference_task_type: 'edit', video_url: vid[0], audio_setting: 'origin' })
    expect(edit).not.toHaveProperty('duration')
    const extend = await build('apimart-kling-4.0', { apimartKlingV4Mode: 'extend', uploadedVideoFilePaths: vid, apimartKlingV4Duration: 8 })
    expect(extend).toMatchObject({ omni_reference_task_type: 'extend', duration: 8 })
    expect(extend).not.toHaveProperty('aspect_ratio')
    expect(price('apimart-kling-4.0', { apimartKlingV4Duration: 5 })).toBeCloseTo(0.7)
    expect(price('apimart-kling-4.0', { apimartKlingV4Mode: 'edit', uploadedVideoFilePaths: vid, __videoDurationSeconds: [3.04] })).toBeCloseTo(0.084 * 8)
  })

  it('Gemini Omni 1.2 Flash：渠道换模型名，Ext 不发尾帧，编辑不发时长', async () => {
    expect(await build('apimart-gemini-omni-1.2-flash', { uploadedFilePaths: img(2) }))
      .toMatchObject({ model: 'gemini-omni-1.2-flash', first_frame_image: img(2)[0], last_frame_image: img(2)[1] })
    await expect(async () => build('apimart-gemini-omni-1.2-flash', { apimartGeminiOmni12Channel: 'ext', uploadedFilePaths: img(2) })).rejects.toThrow('尾帧')
    const edit = await build('apimart-gemini-omni-1.2-flash', { apimartGeminiOmni12Channel: 'ext', apimartGeminiOmni12Mode: 'edit', uploadedVideoFilePaths: vid })
    expect(edit).toMatchObject({ model: 'gemini-omni-1.2-flash-ext', omni_reference_task_type: 'edit', video_urls: vid })
    expect(edit).not.toHaveProperty('duration')
    expect((await build('apimart-gemini-omni-1.2-flash', { apimartGeminiOmni12Mode: 'extend', uploadedVideoFilePaths: vid, apimartGeminiOmni12Duration: 15 })).duration).toBe(10)
    // Ext 带图时不传比例才会跟随素材；官方渠道与纯文生照常发送。
    expect(await build('apimart-gemini-omni-1.2-flash', { apimartGeminiOmni12Channel: 'ext', uploadedFilePaths: img(1) })).not.toHaveProperty('aspect_ratio')
    expect(await build('apimart-gemini-omni-1.2-flash', { apimartGeminiOmni12Channel: 'ext', apimartGeminiOmni12AspectRatio: '9:16' })).toMatchObject({ aspect_ratio: '9:16' })
    expect(await build('apimart-gemini-omni-1.2-flash', { uploadedFilePaths: img(1) })).toMatchObject({ aspect_ratio: '16:9' })
  })

  it('Wan 3.0：版本换模型名，参考模式显式声明 reference', async () => {
    expect(await build('apimart-wan-3.0', { apimartWan30Variant: 'prime', uploadedFilePaths: img(2) }))
      .toMatchObject({ model: 'wan3.0-video-prime', generation_type: 'frame', image_urls: img(2), size: 'adaptive' })
    expect(await build('apimart-wan-3.0', { apimartWan30Mode: 'reference-to-video', uploadedVideoFilePaths: vid }))
      .toMatchObject({ model: 'wan3.0-video', generation_type: 'reference', video_urls: vid })
    expect(price('apimart-wan-3.0', { apimartWan30Variant: 'prime', apimartWan30Resolution: '1080P', apimartWan30Duration: 10 })).toBeCloseTo(2.0571)
  })

  it('Grok Imagine Video 1.5：Ext 用 size 且不支持 1080p，官方用 aspect_ratio', async () => {
    expect(await build('apimart-grok-imagine-video-1.5', { apimartGrokVideo15Channel: 'ext', apimartGrokVideo15Resolution: '1080p', apimartGrokVideo15Duration: 3, apimartGrokVideo15AspectRatio: '16:9' }))
      .toMatchObject({ model: 'grok-imagine-1.5-video-ext', resolution: '480p', duration: 6, size: '16:9' })
    expect(await build('apimart-grok-imagine-video-1.5', { apimartGrokVideo15AspectRatio: '4:3', apimartGrokVideo15Resolution: '1080p' }))
      .toMatchObject({ model: 'grok-imagine-video-1.5', aspect_ratio: '4:3', resolution: '1080p' })
  })

  it('MiniMax H3 Max：图生视频不发比例，参考模式默认 adaptive', async () => {
    const frames = await build('apimart-minimax-h3-max', { uploadedFilePaths: img(2) })
    expect(frames).toMatchObject({ model: 'MiniMax-H3-Max', first_frame_image: img(2)[0], last_frame_image: img(2)[1], resolution: '768P' })
    expect(frames).not.toHaveProperty('aspect_ratio')
    expect(await build('apimart-minimax-h3-max', { apimartMiniMaxH3MaxMode: 'reference-to-video', uploadedFilePaths: img(1) }))
      .toMatchObject({ aspect_ratio: 'adaptive', image_urls: img(1) })
  })

  it('Veo 3.1：Ext 按条、官方按秒且没有 Lite', async () => {
    expect(await build('apimart-veo-3.1', { apimartVeo31Mode: 'reference-to-video', uploadedFilePaths: img(3) }))
      .toMatchObject({ model: 'veo3.1-fast', duration: 8, generation_type: 'reference', image_urls: img(3) })
    const official = await build('apimart-veo-3.1', { apimartVeo31Channel: 'official', apimartVeo31Variant: 'lite', apimartVeo31Resolution: '4k', apimartVeo31Duration: 6, uploadedFilePaths: img(1) })
    expect(official).toMatchObject({ model: 'veo3.1-fast-official', resolution: '4K', duration: 6, first_frame_image: img(1)[0] })
    expect(price('apimart-veo-3.1', { apimartVeo31Variant: 'quality', apimartVeo31Resolution: '4k' })).toBe(1.5)
    expect(price('apimart-veo-3.1', { apimartVeo31Channel: 'official', apimartVeo31Variant: 'quality', apimartVeo31Duration: 4 })).toBeCloseTo(1.28)
  })

  it('FLUX 3 与 Seedream 5.0 Flash：发送具体比例与档位', async () => {
    expect(await build('apimart-flux-3-image', { apimartFlux3Variant: 'klein', apimartFlux3Resolution: '4k' }))
      .toMatchObject({ model: 'flux-3-image-klein', aspect_ratio: '1:1', resolution: '4k', n: 1 })
    expect(await build('apimart-seedream-5.0-flash', { uploadedFilePaths: img(1), __firstImageRatio: 16 / 9 }))
      .toMatchObject({ model: 'seedream-5-0-flash', size: '16:9', resolution: '1.5K', image_urls: img(1) })
  })

  it('HappyHorse 1.1：单图走首帧不发比例，参考模式发 image_urls', async () => {
    const frame = await build('apimart-happyhorse-1.1', { uploadedFilePaths: img(1) })
    expect(frame).toMatchObject({ model: 'happyhorse-1.1', first_frame_image: img(1)[0], resolution: '1080P' })
    expect(frame).not.toHaveProperty('size')
    expect(await build('apimart-happyhorse-1.1', { apimartHappyHorse11Mode: 'reference-to-video', uploadedFilePaths: img(3), apimartHappyHorse11AspectRatio: '9:16' }))
      .toMatchObject({ image_urls: img(3), size: '9:16' })
  })
})
