import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apimartFlux3VideoModel } from '../../src/catalog/apimart/flux-3-video.model'
import { apimartGeminiOmni12FlashModel } from '../../src/catalog/apimart/gemini-omni-1.2-flash.model'
import { apimartMidjourneyModel } from '../../src/catalog/apimart/midjourney.model'
import { apimartMidjourneyVideoModel } from '../../src/catalog/apimart/midjourney-video.model'
import { buildContinuationParams, captureContinuations, findContinuation } from '../../src/catalog/continuation'
import { falFlux3VideoModel } from '../../src/catalog/fal/flux-3-video.model'
import type { ModelRuntimeDefinition, RuntimeInputLimitsConfig } from '../../src/types/model'
import type { JsonObject, JsonValue } from '../../src/types/runtime'

interface Schema { type?: string; enum?: JsonValue[]; properties?: Record<string, Schema>; required?: string[]; minimum?: number; maximum?: number }

const img = (n: number) => Array.from({ length: n }, (_, i) => `https://example.invalid/i${i}.png`)
const vid = ['https://example.invalid/in.mp4']

const build = async (model: ModelRuntimeDefinition, params: JsonObject) => await model.request!.builder!(params) as JsonObject
const route = async (model: ModelRuntimeDefinition, params: JsonObject) => {
  const endpoints = model.endpoints
  return typeof endpoints === 'object' && endpoints.selector ? await endpoints.selector(params) : endpoints
}
const price = (model: ModelRuntimeDefinition, params: JsonObject) => model.pricing.calculator!(params)
const visible = (model: ModelRuntimeDefinition, id: string, params: JsonObject) => {
  const condition = model.params.find(param => param.id === id)?.visible?.condition
  return typeof condition === 'function' ? condition(params) : true
}

/** 模拟宿主：源请求完成 → 取引用 → 生成续接请求参数。 */
function continueFrom(model: ModelRuntimeDefinition, id: string, source: JsonObject, result: { taskId?: string; metadata: JsonValue }): JsonObject {
  const captured = captureContinuations(model, source, result)
  const continuation = findContinuation(model, id)
  if (!captured?.[id] || !continuation) throw new Error(`没有可用的续接 ${id}`)
  return buildContinuationParams(model.meta.id, continuation, source, captured[id])
}

function falSchema(name: string): Schema {
  return JSON.parse(readFileSync(resolve(__dirname, '../fixtures/model-requests-2026-11', `${name}.json`), 'utf8')).requestSchema
}

function apimartFixtureBody(name: string): JsonObject {
  const fixture = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/apimart', `${name}.json`), 'utf8'))
  return fixture.params
}

/** 按官方请求 schema 检查字段名、枚举、范围与必填。 */
function violations(schema: Schema, value: JsonObject): string[] {
  const problems: string[] = []
  for (const [key, child] of Object.entries(value)) {
    const field = schema.properties?.[key]
    if (!field) problems.push(`${key} 不是官方字段`)
    else if (field.enum && !field.enum.includes(child)) problems.push(`${key} 不在枚举内：${JSON.stringify(child)}`)
  }
  for (const key of schema.required ?? []) if (!(key in value)) problems.push(`${key} 缺少必填`)
  return problems
}

describe('APIMart FLUX 3 Video 草稿与转正片', () => {
  const model = apimartFlux3VideoModel

  it('草稿请求发 draft 且分辨率固定 hd，按草稿价计费', async () => {
    const body = await build(model, { prompt: '一只橘猫跳上洒满阳光的木桌', apimartFlux3VideoDraft: true, apimartFlux3VideoResolution: 'fhd' })
    expect(body).toMatchObject({ model: 'flux-3-video', draft: true, resolution: 'hd', mode: 't2v', duration: 5 })
    expect(price(model, { apimartFlux3VideoDraft: true, apimartFlux3VideoResolution: 'fhd' })).toBeCloseTo(0.24)
    expect(price(model, { apimartFlux3VideoDraft: true, apimartFlux3VideoMode: 'extend', apimartFlux3VideoDuration: 10 })).toBeCloseTo(0.96)
    expect(await build(model, { prompt: 'x' })).not.toHaveProperty('draft')
  })

  it('只有草稿结果能转正片，引用是平台任务 ID', () => {
    expect(captureContinuations(model, { prompt: 'x' }, { taskId: 'task_1', metadata: {} })).toBeUndefined()
    expect(captureContinuations(model, { prompt: 'x', apimartFlux3VideoDraft: true }, { taskId: 'task_1', metadata: {} }))
      .toEqual({ 'finalize-draft': { taskId: 'task_1' } })
    expect(captureContinuations(model, { apimartFlux3VideoDraft: true }, { metadata: {} })).toBeUndefined()
    expect(findContinuation(model, 'finalize-draft')).toMatchObject({ submit: 'direct' })
  })

  it('转正片只发官方允许的字段，不发提示词，按草稿的模式与时长计正片价', async () => {
    const source = { prompt: '一只橘猫', apimartFlux3VideoDraft: true, apimartFlux3VideoResolution: 'fhd', apimartFlux3VideoDuration: 10, uploadedFilePaths: img(2) }
    const params = continueFrom(model, 'finalize-draft', source, { taskId: 'task_01K_DRAFT...', metadata: {} })
    expect(params.apimartFlux3VideoDraft).toBe(false)
    expect(await build(model, params)).toEqual(apimartFixtureBody('flux-3-video-draft-finalize-create'))
    expect(price(model, params)).toBeCloseTo(2.32)
    const extend = continueFrom(model, 'finalize-draft', { apimartFlux3VideoDraft: true, apimartFlux3VideoMode: 'extend', uploadedVideoFilePaths: vid }, { taskId: 't', metadata: {} })
    expect(await build(model, extend)).toEqual({ model: 'flux-3-video', draft_from_task_id: 't', resolution: 'hd' })
    expect(price(model, extend)).toBeCloseTo(0.328 * 5)
  })

  it('官方出草稿示例与请求构建一致', async () => {
    const official = apimartFixtureBody('flux-3-video-draft-create')
    expect(await build(model, { prompt: official.prompt, apimartFlux3VideoDraft: true })).toMatchObject(official)
  })
})

describe('Fal FLUX 3 Video 草稿与 draft-enhance', () => {
  const model = falFlux3VideoModel

  it('标准版文生、图生、续写各自路由到草稿端点；Max 与视频编辑没有草稿', async () => {
    expect(await route(model, { falFlux3VideoDraft: true })).toBe('blackforestlabs/flux-3/text-to-video/draft')
    expect(await route(model, { falFlux3VideoDraft: true, uploadedFilePaths: img(1) })).toBe('blackforestlabs/flux-3/image-to-video/draft')
    expect(await route(model, { falFlux3VideoDraft: true, falFlux3VideoMode: 'extend', uploadedVideoFilePaths: vid })).toBe('blackforestlabs/flux-3/extend-video/draft')
    expect(await route(model, { falFlux3VideoDraft: true, falFlux3VideoVersion: 'max' })).toBe('blackforestlabs/flux-3-max/text-to-video')
    expect(await route(model, { falFlux3VideoDraft: true, falFlux3VideoMode: 'edit', uploadedVideoFilePaths: vid })).toBe('blackforestlabs/flux-3/edit-video')
    expect(visible(model, 'falFlux3VideoDraft', { falFlux3VideoVersion: 'max' })).toBe(false)
    expect(visible(model, 'falFlux3VideoDraft', { falFlux3VideoMode: 'edit' })).toBe(false)
    expect(visible(model, 'falFlux3VideoResolution', { falFlux3VideoDraft: true })).toBe(false)
  })

  it('草稿请求符合官方 schema（没有分辨率字段），按草稿价计费', async () => {
    const params = { prompt: 'A red panda', falFlux3VideoDraft: true, falFlux3VideoResolution: '1080p', falFlux3VideoDuration: 8 }
    expect(violations(falSchema('fal-flux-3-text-to-video-draft'), await build(model, params))).toEqual([])
    expect(violations(falSchema('fal-flux-3-image-to-video-draft'), await build(model, { ...params, uploadedFilePaths: img(1) }))).toEqual([])
    expect(violations(falSchema('fal-flux-3-extend-video-draft'), await build(model, { ...params, falFlux3VideoMode: 'extend', uploadedVideoFilePaths: vid }))).toEqual([])
    expect(price(model, params)).toBeCloseTo(0.48)
    expect(price(model, { ...params, falFlux3VideoMode: 'extend' })).toBeCloseTo(0.96)
  })

  it('从草稿结果的 draft_cache 取引用；缓存为空时不能转正片', () => {
    const source = { prompt: 'x', falFlux3VideoDraft: true }
    expect(captureContinuations(model, source, { taskId: 'r', metadata: { video: { url: 'https://v/x.mp4' }, draft_cache: { url: 'https://v/cache.bin' } } }))
      .toEqual({ 'finalize-draft': { draftCacheUrl: 'https://v/cache.bin' } })
    expect(captureContinuations(model, source, { taskId: 'r', metadata: { video: { url: 'https://v/x.mp4' }, draft_cache: null } })).toBeUndefined()
    expect(captureContinuations(model, { prompt: 'x' }, { taskId: 'r', metadata: { draft_cache: { url: 'https://v/cache.bin' } } })).toBeUndefined()
  })

  it('转正片走 draft-enhance，只发缓存地址，按 1080p 增强价 × 草稿时长计费', async () => {
    const source = { prompt: 'x', falFlux3VideoDraft: true, falFlux3VideoDuration: 10, falFlux3VideoMode: 'extend', uploadedVideoFilePaths: vid }
    const params = continueFrom(model, 'finalize-draft', source, { taskId: 'r', metadata: { draft_cache: { url: 'https://v/cache.bin' } } })
    expect(params).toMatchObject({ falFlux3VideoDraft: false, falFlux3VideoResolution: '1080p' })
    expect(await route(model, params)).toBe('blackforestlabs/flux-3/draft-enhance')
    const body = await build(model, params)
    expect(body).toEqual({ draft_cache_url: 'https://v/cache.bin' })
    expect(violations(falSchema('fal-flux-3-draft-enhance'), body)).toEqual([])
    expect(price(model, params)).toBeCloseTo(2.9)
  })
})

describe('Midjourney 图转视频续接', () => {
  it('只有 Imagine 结果能做成视频，只带提示词过去，带进输入区再提交', () => {
    const source = { prompt: 'a cat --ar 16:9', apimartMidjourneySpeed: 'turbo', apimartMidjourneyStyleReference: img(1) }
    expect(captureContinuations(apimartMidjourneyModel, source, { taskId: 'mj_1', metadata: {} })).toEqual({ animate: { taskId: 'mj_1' } })
    expect(captureContinuations(apimartMidjourneyModel, { ...source, apimartMidjourneyMode: 'edit' }, { taskId: 'mj_1', metadata: {} })).toBeUndefined()
    expect(captureContinuations(apimartMidjourneyModel, { ...source, apimartMidjourneyMode: 'blend' }, { taskId: 'mj_1', metadata: {} })).toBeUndefined()
    const continuation = findContinuation(apimartMidjourneyModel, 'animate')
    expect(continuation).toMatchObject({ targetModelId: 'apimart-midjourney-video', submit: 'edit' })
    expect(continuation!.params(source)).toEqual({ prompt: 'a cat --ar 16:9' })
  })

  it('视频模型从续接引用读 task_id，首帧与动画模式只在续接时出现', async () => {
    const params = { ...continueFrom(apimartMidjourneyModel, 'animate', { prompt: 'a cat' }, { taskId: 'mj_1', metadata: {} }), apimartMidjourneyVideoIndex: '2', apimartMidjourneyVideoAnimateMode: 'auto' }
    expect(await build(apimartMidjourneyVideoModel, params)).toEqual({
      prompt: 'a cat', video_type: 'vid_1.1_i2v_480', animate_mode: 'auto', motion: 'high', batch_size: 1, task_id: 'mj_1', index: 2,
    })
    expect(visible(apimartMidjourneyVideoModel, 'apimartMidjourneyVideoIndex', params)).toBe(true)
    expect(visible(apimartMidjourneyVideoModel, 'apimartMidjourneyVideoAnimateMode', params)).toBe(true)
    expect(visible(apimartMidjourneyVideoModel, 'apimartMidjourneyVideoIndex', {})).toBe(false)
    expect(visible(apimartMidjourneyVideoModel, 'apimartMidjourneyVideoAnimateMode', {})).toBe(false)
    const limits = apimartMidjourneyVideoModel.inputLimits as (params: JsonObject) => RuntimeInputLimitsConfig
    expect(limits(params).images).toEqual({ max: 0 })
    expect(limits({}).images).toEqual({ max: 2 })
    // 续接引用与旧工程里手填的任务 ID 都能单独构成输入。
    expect(apimartMidjourneyVideoModel.alternativeInputParamIds).toEqual(expect.arrayContaining(['__continuation', 'apimartMidjourneyVideoTaskId']))
    expect(apimartMidjourneyVideoModel.params.map(param => param.id)).not.toContain('apimartMidjourneyVideoTaskId')
  })

  it('上传首尾帧时发 image_urls，自动动画降为手动', async () => {
    expect(await build(apimartMidjourneyVideoModel, { prompt: 'x', uploadedFilePaths: img(2), apimartMidjourneyVideoAnimateMode: 'auto' }))
      .toMatchObject({ image_urls: [img(2)[0]], end_url: img(2)[1], animate_mode: 'manual', video_type: 'vid_1.1_i2v_start_end_480' })
    await expect(build(apimartMidjourneyVideoModel, { prompt: 'x' })).rejects.toThrow('首帧')
  })

  it('旧工程里手填的来源任务 ID 仍能提交，有首帧时以首帧为准', async () => {
    expect(await build(apimartMidjourneyVideoModel, { prompt: '', apimartMidjourneyVideoTaskId: ' old_task ', apimartMidjourneyVideoIndex: '1' }))
      .toMatchObject({ task_id: 'old_task', index: 1 })
    const withImage = await build(apimartMidjourneyVideoModel, { prompt: '', apimartMidjourneyVideoTaskId: 'old_task', uploadedFilePaths: img(1) })
    expect(withImage).toMatchObject({ image_urls: img(1) })
    expect(withImage).not.toHaveProperty('task_id')
  })
})

describe('Gemini Omni 1.2 Flash 续写自己的结果', () => {
  const model = apimartGeminiOmni12FlashModel

  it('切到续写、去掉源素材、时长收到 10 秒内，沿用渠道', () => {
    const source = { prompt: 'mountains', apimartGeminiOmni12Channel: 'ext', apimartGeminiOmni12Duration: 15, uploadedFilePaths: img(1), images: img(1), __videoDurationSeconds: [5] }
    const params = continueFrom(model, 'extend', source, { taskId: 'task_01PREVIOUS', metadata: {} })
    expect(params).toMatchObject({ apimartGeminiOmni12Mode: 'extend', apimartGeminiOmni12Channel: 'ext', apimartGeminiOmni12Duration: 10, prompt: 'mountains' })
    for (const key of ['uploadedFilePaths', 'images', '__videoDurationSeconds']) expect(params).not.toHaveProperty(key)
    expect(findContinuation(model, 'extend')).toMatchObject({ submit: 'edit' })
    expect(findContinuation(model, 'extend')?.targetModelId).toBeUndefined()
  })

  it('续写请求发 extend_from_task_id，不发视频与比例，按新增秒数计费', async () => {
    const params = { ...continueFrom(model, 'extend', { prompt: 'x' }, { taskId: 'task_01PREVIOUS', metadata: {} }), prompt: 'The camera continues panning across the mountains.', apimartGeminiOmni12Duration: 8 }
    const official = apimartFixtureBody('gemini-omni-1.2-flash-extend-from-task-create')
    expect(await build(model, params)).toEqual({ ...official, resolution: '720p' })
    expect(price(model, params)).toBeCloseTo(0.48)
    const ext = await build(model, { ...params, apimartGeminiOmni12Channel: 'ext' })
    expect(ext).toMatchObject({ model: 'gemini-omni-1.2-flash-ext', extend_from_task_id: 'task_01PREVIOUS' })
    expect(ext).not.toHaveProperty('video_urls')
    expect(price(model, { ...params, apimartGeminiOmni12Channel: 'ext' })).toBeCloseTo(0.192)
    await expect(build(model, { ...params, prompt: '' })).rejects.toThrow('提示词')
  })

  it('续接时不要求输入视频、不能再上传素材，渠道与模式不显示', () => {
    const params = continueFrom(model, 'extend', { prompt: 'x', apimartGeminiOmni12Mode: 'edit' }, { taskId: 't', metadata: {} })
    const requirement = model.requirements!.find(item => item.id === 'apimart-gemini-omni-12-input-video')!
    const when = requirement.when as (params: JsonObject) => boolean
    expect(when(params)).toBe(false)
    expect(when({ apimartGeminiOmni12Mode: 'extend' })).toBe(true)
    const rule = (model.inputLimits as RuntimeInputLimitsConfig).rules!.find(item => typeof item.when === 'function')!
    expect((rule.when as (params: JsonObject) => boolean)(params)).toBe(true)
    expect(rule).toMatchObject({ images: { max: 0 }, videos: { exact: 0 } })
    expect(visible(model, 'apimartGeminiOmni12Channel', params)).toBe(false)
    expect(visible(model, 'apimartGeminiOmni12Mode', params)).toBe(false)
    expect(visible(model, 'apimartGeminiOmni12AspectRatio', params)).toBe(false)
    expect(visible(model, 'apimartGeminiOmni12Channel', {})).toBe(true)
  })

  it('没有续接引用时续写仍需要 1 段视频', async () => {
    await expect(build(model, { prompt: 'x', apimartGeminiOmni12Mode: 'extend' })).rejects.toThrow('1 段输入视频')
    expect(await build(model, { prompt: 'x', apimartGeminiOmni12Mode: 'extend', uploadedVideoFilePaths: vid })).toMatchObject({ video_urls: vid, omni_reference_task_type: 'extend' })
  })
})
