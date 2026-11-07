import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { falKling40FlashModel } from '../../src/catalog/fal/kling-4.0-flash.model'
import { falKling40Model } from '../../src/catalog/fal/kling-4.0.model'
import { kieKling40FlashModel } from '../../src/catalog/kie/kling-4.0-flash.model'
import { kieKling40Model } from '../../src/catalog/kie/kling-4.0.model'
import type { ModelRuntimeDefinition } from '../../src/types/model'
import type { JsonObject, JsonValue } from '../../src/types/runtime'

interface Schema { type?: string; enum?: JsonValue[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; minimum?: number; maximum?: number; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number }

const img = (n: number, tag = 'i') => Array.from({ length: n }, (_, i) => `https://example.invalid/${tag}${i}.png`)
const vid = (n: number, tag = 'v') => Array.from({ length: n }, (_, i) => `https://example.invalid/${tag}${i}.mp4`)
// 与 shot-list / subject-elements 面板写入的值结构一致。
const shot = (prompt: string, duration: number) => ({ id: prompt, prompt, duration })
const imageElement = (name: string, images: string[]) => ({ id: name, name, kind: 'image', images, videos: [] })
const videoElement = (name: string, video: string) => ({ id: name, name, kind: 'video', images: [], videos: [video] })

const build = async (model: ModelRuntimeDefinition, params: JsonObject) => await model.request!.builder!({ prompt: 'A cat on a windowsill', ...params }) as JsonObject
const route = async (model: ModelRuntimeDefinition, params: JsonObject) => {
  const endpoints = model.endpoints
  return typeof endpoints === 'object' && endpoints.selector ? await endpoints.selector(params) : endpoints
}
const price = (model: ModelRuntimeDefinition, params: JsonObject) => model.pricing.calculator!(params)
const visible = (model: ModelRuntimeDefinition, id: string, params: JsonObject) => {
  const condition = model.params.find(param => param.id === id)?.visible?.condition
  return typeof condition === 'function' ? condition(params) : true
}

function schemaOf(name: string): Schema {
  return JSON.parse(readFileSync(resolve(__dirname, '../fixtures/model-requests-2026-11', `${name}.json`), 'utf8')).requestSchema
}

/** 按官方请求 schema 检查字段名、枚举、范围、数量、长度与必填。 */
function violations(schema: Schema, value: JsonValue, path = '$'): string[] {
  const problems: string[] = []
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${path} 不在枚举内：${JSON.stringify(value)}`)
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${path} 小于下限`)
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${path} 大于上限`)
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${path} 过短`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) problems.push(`${path} 超长`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${path} 少于 ${schema.minItems} 项`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${path} 超过 ${schema.maxItems} 项`)
    value.forEach((item, index) => { if (schema.items) problems.push(...violations(schema.items, item, `${path}[${index}]`)) })
  } else if (value && typeof value === 'object' && schema.properties) {
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties[key]
      if (!childSchema) problems.push(`${path}.${key} 不是官方字段`)
      else problems.push(...violations(childSchema, child as JsonValue, `${path}.${key}`))
    }
    for (const key of schema.required ?? []) if (!(key in value)) problems.push(`${path}.${key} 缺少必填`)
  }
  return problems
}

const scenarios: Array<[string, ModelRuntimeDefinition, JsonObject, string, string]> = [
  ['Fal 文生视频分镜', falKling40Model, { falKling40Shots: [shot('wide shot', 4), shot('close up', 6)] }, 'kling/v4/text-to-video', 'fal-kling-4.0-text-to-video'],
  ['Fal 首尾帧分镜', falKling40Model, { images: img(2), falKling40Shots: [shot('opens', 3), shot('closes', 3)] }, 'kling/v4/image-to-video', 'fal-kling-4.0-image-to-video'],
  ['Fal 参考生视频分镜 + 元素', falKling40Model, {
    falKling40Mode: 'reference-to-video', images: img(2), videos: vid(1),
    falKling40Shots: [shot('@Element1 walks in', 5)],
    falKling40Elements: [imageElement('', img(4, 'e')), videoElement('', 'https://example.invalid/e.mp4')],
  }, 'kling/v4/reference-to-video', 'fal-kling-4.0-reference-to-video'],
  ['Fal 视频编辑元素', falKling40Model, { falKling40Mode: 'video-edit', videos: vid(2), falKling40Elements: [imageElement('', img(2, 'e'))] }, 'kling/v4/video-to-video/edit', 'fal-kling-4.0-video-edit'],
  ['Fal Flash 参考元素', falKling40FlashModel, { falKling40FlashMode: 'reference-to-video', falKling40FlashElements: [imageElement('', img(3, 'e'))] }, 'kling/v4/flash/reference-to-video', 'fal-kling-4.0-flash-reference-to-video'],
  ['Fal Flash 视频编辑元素', falKling40FlashModel, { falKling40FlashMode: 'video-edit', videos: vid(1), falKling40FlashElements: [videoElement('', 'https://example.invalid/e.mp4')] }, 'kling/v4/flash/video-to-video', 'fal-kling-4.0-flash-video-edit'],
]

describe('Kling 4.0 分镜与元素请求契约', () => {
  it.each(scenarios)('%s 只发送官方字段并命中正确端点', async (_name, model, params, endpoint, fixture) => {
    expect(await route(model, params)).toBe(endpoint)
    expect(violations(schemaOf(fixture), await build(model, params))).toEqual([])
  })

  it('Fal 分镜与主提示词、时长二选一；元素按正面图与其他角度拆分', async () => {
    const body = await build(falKling40Model, {
      falKling40Mode: 'reference-to-video', falKling40Duration: 10,
      falKling40Shots: [shot('a', 2), shot('b', 3)],
      falKling40Elements: [imageElement('', img(3, 'e')), videoElement('', 'https://example.invalid/e.mp4')],
    })
    expect(body.multi_prompt).toEqual([{ prompt: 'a', duration: 2 }, { prompt: 'b', duration: 3 }])
    expect(body).not.toHaveProperty('prompt')
    expect(body).not.toHaveProperty('duration')
    expect(body.elements).toEqual([
      { frontal_image_url: img(3, 'e')[0], reference_image_urls: img(3, 'e').slice(1) },
      { video_url: 'https://example.invalid/e.mp4' },
    ])
    // 视频编辑不支持分镜，文/图生视频不支持元素：隐藏的残留值不发送。
    const edit = await build(falKling40Model, { falKling40Mode: 'video-edit', videos: vid(1), falKling40Shots: [shot('a', 5)] })
    expect(edit).not.toHaveProperty('multi_prompt')
    const t2v = await build(falKling40Model, { falKling40Elements: [imageElement('', img(2))] })
    expect(t2v).not.toHaveProperty('elements')
    expect(t2v).toMatchObject({ prompt: 'A cat on a windowsill', duration: 5 })
    // 用了分镜就不显示时长。
    expect(visible(falKling40Model, 'falKling40Duration', { falKling40Shots: [shot('a', 5)] })).toBe(false)
    expect(visible(falKling40Model, 'falKling40Duration', { falKling40Shots: [] })).toBe(true)
    expect(visible(falKling40Model, 'falKling40Shots', { falKling40Mode: 'video-edit' })).toBe(false)
  })

  it('提交前拦下不合法的分镜与元素', async () => {
    await expect(build(falKling40Model, { falKling40Shots: [shot('a', 20), shot('b', 15)] })).rejects.toThrow('总时长')
    await expect(build(falKling40Model, { falKling40Shots: [shot('', 5)] })).rejects.toThrow('第 1 镜的提示词')
    await expect(build(falKling40Model, { falKling40Mode: 'reference-to-video', falKling40Elements: [imageElement('', img(1))] })).rejects.toThrow('2–4 张图')
    const videos = Array.from({ length: 4 }, (_, i) => videoElement('', `https://example.invalid/e${i}.mp4`))
    await expect(build(falKling40FlashModel, { falKling40FlashMode: 'reference-to-video', falKling40FlashElements: videos })).rejects.toThrow('视频元素')
  })

  it('KIE 元素按名称引用，Flash 视频元素带 type，名称与素材总数受官方规则约束', async () => {
    const std = (await build(kieKling40Model, {
      kieKling40Mode: 'reference-to-video', videos: vid(1),
      kieKling40Elements: [imageElement('Hero', img(2, 'e')), videoElement('主体2', 'https://example.invalid/e.mp4')],
    })).input as JsonObject
    expect(std.elements).toEqual([{ name: 'Hero', image_urls: img(2, 'e') }, { name: '主体2', video_url: 'https://example.invalid/e.mp4' }])
    expect(violations(schemaOf('kie-kling-4.0-reference'), { model: 'kling-4.0/reference-to-video', input: std })).toEqual([])
    const flash = await build(kieKling40FlashModel, { kieKling40FlashMode: 'reference-to-video', kieKling40FlashElements: [videoElement('Hero', 'https://example.invalid/e.mp4')] })
    expect((flash.input as JsonObject).elements).toEqual([{ name: 'Hero', video_url: 'https://example.invalid/e.mp4', type: 'video' }])
    expect(violations(schemaOf('kie-kling-4.0-flash-reference'), flash)).toEqual([])
    // 关键帧模式没有元素。
    expect((await build(kieKling40Model, { kieKling40Elements: [imageElement('Hero', img(2))] })).input).not.toHaveProperty('elements')
    const reference = (elements: JsonValue[], extra: JsonObject = {}) => build(kieKling40Model, { kieKling40Mode: 'reference-to-video', kieKling40Elements: elements, ...extra })
    await expect(reference([imageElement('image_1', img(2))])).rejects.toThrow('保留名')
    await expect(reference([imageElement('Hero', img(2)), imageElement('hero', img(2))])).rejects.toThrow('重复')
    await expect(reference([imageElement('A B', img(2))])).rejects.toThrow('名称')
    await expect(reference([videoElement('Hero', 'https://example.invalid/e.mp4')], { videos: vid(5) })).rejects.toThrow('合计最多 5')
  })

  it('估价：分镜按各镜秒数之和，参考视频与视频元素都按视频输入计费', async () => {
    expect(price(falKling40Model, { falKling40Resolution: '720p', falKling40Shots: [shot('a', 4), shot('b', 6)] })).toBeCloseTo(0.157 * 10)
    // 1 个视频元素读不到时长按上限 8 秒估：max(8 + 10, 2 × 10) = 20 秒。
    expect(price(falKling40Model, { falKling40Mode: 'reference-to-video', falKling40Duration: 10, falKling40Elements: [videoElement('', 'x.mp4')] })).toBeCloseTo(0.141 * 20)
    expect(price(falKling40Model, { falKling40Mode: 'reference-to-video', falKling40Duration: 10, falKling40Elements: [imageElement('', img(2))] })).toBeCloseTo(0.235 * 10)
    expect(price(falKling40FlashModel, { falKling40FlashMode: 'reference-to-video', falKling40FlashDuration: 10, falKling40FlashElements: [videoElement('', 'x.mp4')] })).toBeCloseTo(0.063 * 20)
    // KIE 官方例子：10 秒输出 + 5 秒输入计 20 秒；15 秒输入计 25 秒。
    expect(price(kieKling40Model, { kieKling40Mode: 'reference-to-video', kieKling40Duration: '10', videos: vid(1), __videoDurationSeconds: [5] })).toBeCloseTo(0.085 * 20)
    expect(price(kieKling40Model, { kieKling40Mode: 'reference-to-video', kieKling40Duration: '10', videos: vid(1), __videoDurationSeconds: [15] })).toBeCloseTo(0.085 * 25)
    expect(price(kieKling40FlashModel, { kieKling40FlashMode: 'reference-to-video', kieKling40FlashDuration: '10', kieKling40FlashElements: [videoElement('Hero', 'x.mp4')] })).toBeCloseTo(0.0565 * 20)
    // 视频元素输入时长超过输出时，估价不能偏低：3 段未知时长按 8 秒计 max(24 + 5, 10) = 29 秒；读到 3 秒时按实际 max(9 + 5, 10) = 14 秒。
    const three = (seconds?: number) => [1, 2, 3].map(n => ({ ...videoElement(`v${n}`, `${n}.mp4`), ...(seconds ? { videoSeconds: seconds } : {}) }))
    expect(price(falKling40Model, { falKling40Mode: 'reference-to-video', falKling40Duration: 5, falKling40Elements: three() })).toBeCloseTo(0.141 * 29)
    expect(price(falKling40Model, { falKling40Mode: 'reference-to-video', falKling40Duration: 5, falKling40Elements: three(3) })).toBeCloseTo(0.141 * 14)
    // 估价用的时长不进请求体。
    expect(JSON.stringify(await build(falKling40Model, { falKling40Mode: 'reference-to-video', falKling40Elements: three(3) }))).not.toContain('videoSeconds')
  })
})
