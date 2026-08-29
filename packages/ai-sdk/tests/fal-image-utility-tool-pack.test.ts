import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import { catalog } from '../src/catalog'
import { createModularGenerationClient } from '../src/generation/core'
import { models, pack } from '../src/packs/tool-packs/fal-image-utility-tools'
import type { ModelRuntimeDefinition } from '../src/types/model'
import type { JsonObject } from '../src/types/runtime'

interface Fixture {
  endpoint: string
  input: JsonObject
  submit: JsonObject
  status: JsonObject
  result: JsonObject
}

const fixtureNames = [
  'relighting',
  'control-light',
  'outpaint',
  'product-photography',
  'photo-restoration',
  'pixelcut-background-removal',
] as const

const fixtures = Object.fromEntries(fixtureNames.map((name) => [
  name,
  JSON.parse(fs.readFileSync(new URL(`./fixtures/fal-tools/${name}.json`, import.meta.url), 'utf8')) as Fixture,
]))

function modelById(modelId: string): ModelRuntimeDefinition {
  const model = models.find((candidate) => candidate.meta.id === modelId)
  if (!model) throw new Error(`Missing ${modelId}`)
  return model
}

function fastModel(model: ModelRuntimeDefinition): ModelRuntimeDefinition {
  return {
    ...model,
    meta: {
      ...model.meta,
      polling: model.meta.polling ? { ...model.meta.polling, interval: 1 } : undefined,
    },
  }
}

function fixtureRuntime(fixture: Fixture, builtRequests: JsonObject[]) {
  return {
    transport: {
      fetch: async (url: string | URL, init?: RequestInit) => {
        const target = String(url)
        if (target.startsWith('https://rest.fal.ai/storage/upload/initiate')) {
          return Response.json({
            upload_url: 'https://upload.fixture.invalid/source',
            file_url: 'https://cdn.fixture.invalid/source.png',
          })
        }
        if (target === 'https://upload.fixture.invalid/source') return new Response('', { status: 200 })
        if (target === `https://queue.fal.run/${fixture.endpoint}`) {
          builtRequests.push(JSON.parse(String(init?.body)) as JsonObject)
          return Response.json(fixture.submit)
        }
        if (target.endsWith('/status')) return Response.json(fixture.status)
        if (target.includes('/requests/')) return Response.json(fixture.result)
        throw new Error(`Unexpected fixture URL: ${target}`)
      },
    },
    credentials: { get: async () => 'fixture-key' },
    media: {
      read: async () => ({
        bytes: new Uint8Array([137, 80, 78, 71]),
        mimeType: 'image/png',
        filename: 'source.png',
      }),
    },
  }
}

describe('Fal 图片实用工具 pack', () => {
  it('独立分发 6 个工具，不进入默认 catalog 且不暴露隐藏字段', () => {
    expect(models.map((model) => model.meta.id)).toEqual([
      'fal-image-apps-v2-relighting',
      'fal-control-light',
      'fal-image-apps-v2-outpaint',
      'fal-image-apps-v2-product-photography',
      'fal-image-apps-v2-photo-restoration',
      'fal-pixelcut-background-removal',
    ])
    expect(catalog.some((model) => models.some((tool) => tool.meta.id === model.meta.id))).toBe(false)
    expect(models.every((model) => model.inputLimits?.images?.exact === 1)).toBe(true)
    expect(models.every((model) => model.requirements?.[0].require.images?.exact === 1)).toBe(true)
    expect(models.every((model) => model.params.every((param) => (
      !['prompt', 'negativePrompt', 'seed', 'outputFormat', 'enableSafetyChecker', 'syncMode'].includes(param.id)
    )))).toBe(true)
  })

  it('重打光使用 18 个官方风格与对象比例，非法风格回落 natural', () => {
    const model = modelById('fal-image-apps-v2-relighting')
    const style = model.params.find((param) => param.id === 'lightingStyle')
    expect(style?.options).toHaveLength(18)
    expect(model.request.builder({
      image: ['uxp://source'],
      lightingStyle: 'unknown',
      aspectRatio: 'smart',
      __firstImageRatio: 16 / 9,
      prompt: '不应进入请求',
    })).toEqual({
      image_url: 'uxp://source',
      lighting_style: 'natural',
      aspect_ratio: { ratio: '16:9' },
    })
    expect(model.pricing.fixed).toBe(0.04)
  })

  it('ControlLight 支持 0..1 并保留合法的 0，不下发高级或提示词字段', () => {
    const model = modelById('fal-control-light')
    expect(model.request.builder({
      image: ['uxp://source'],
      lightingLevel: 0,
      prompt: '不应进入请求',
      numInferenceSteps: 8,
      guidanceScale: 20,
    })).toEqual({
      image_url: 'uxp://source',
      lighting_level: 0,
    })
    expect(model.pricing.calculator?.({})).toBe(0.03)
  })

  it('扩图夹紧官方范围、截断提示词并拒绝全 0 无操作', () => {
    const model = modelById('fal-image-apps-v2-outpaint')
    expect(model.request.builder({
      image: ['uxp://source'],
      expandLeft: 999,
      expandRight: -1,
      expandTop: 0,
      expandBottom: 1.6,
      zoomOutPercentage: 99,
      prompt: `  ${'x'.repeat(510)}  `,
    })).toEqual({
      image_url: 'uxp://source',
      expand_left: 700,
      expand_right: 0,
      expand_top: 0,
      expand_bottom: 2,
      zoom_out_percentage: 90,
      prompt: 'x'.repeat(500),
    })
    expect(() => model.request.builder({
      image: ['uxp://source'],
      expandLeft: 0,
      expandRight: 0,
      expandTop: 0,
      expandBottom: 0,
      zoomOutPercentage: 0,
    })).toThrow(/至少需要扩展一侧/)
    expect(model.pricing.calculator?.({})).toBe(0.035)
  })

  it('商品摄影使用特殊媒体字段，照片修复要求至少一项功能开启', () => {
    const product = modelById('fal-image-apps-v2-product-photography')
    expect(product.request.builder({
      image: ['uxp://source'],
      aspectRatio: 'smart',
      __firstImageRatio: 3 / 4,
      prompt: '不应进入请求',
    })).toEqual({
      product_image_url: 'uxp://source',
      aspect_ratio: { ratio: '3:4' },
    })
    expect(product.runtimeConstraints?.mediaFields).toEqual([
      { field: 'product_image_url', kind: 'image' },
    ])

    const restoration = modelById('fal-image-apps-v2-photo-restoration')
    expect(restoration.request.builder({
      image: ['uxp://source'],
      enhanceResolution: false,
      fixColors: true,
      removeScratches: false,
      aspectRatio: '4:3',
    })).toEqual({
      image_url: 'uxp://source',
      enhance_resolution: false,
      fix_colors: true,
      remove_scratches: false,
      aspect_ratio: { ratio: '4:3' },
    })
    expect(() => restoration.request.builder({
      image: ['uxp://source'],
      enhanceResolution: false,
      fixColors: false,
      removeScratches: false,
    })).toThrow(/至少需要开启一项/)
    expect(product.pricing.fixed).toBe(0.04)
    expect(restoration.pricing.fixed).toBe(0.04)
  })

  it('Pixelcut 隐藏输出格式并固定 sync_mode=false，确保返回 CDN URL', () => {
    const model = modelById('fal-pixelcut-background-removal')
    expect(model.params[0]).toMatchObject({
      id: 'image',
      accept: ['image/jpeg', 'image/png'],
    })
    expect(model.request.builder({ image: ['uxp://source'], outputFormat: 'zip' })).toEqual({
      image_url: 'uxp://source',
      sync_mode: false,
    })
    expect(model.pricing.fixed).toBe(0.016)
  })

  it('六个工具都优先读取标准宿主媒体键，不要求重复填写 image 参数', () => {
    for (const model of models) {
      const defaults = Object.fromEntries(model.params.map((param) => [param.id, param.default]))
      const request = model.request.builder({
        ...defaults,
        image: [],
        images: ['legacy-source.png'],
        uploadedFilePaths: ['managed-source.png'],
      })
      const mediaField = model.meta.id.includes('product-photography')
        ? 'product_image_url'
        : 'image_url'
      expect(request[mediaField], model.meta.id).toBe('managed-source.png')
    }
  })

  it.each([
    ['relighting', 'fal-image-apps-v2-relighting', {
      image: ['uxp://source'], lightingStyle: 'golden_hour', aspectRatio: '4:3',
    }],
    ['control-light', 'fal-control-light', { image: ['uxp://source'], lightingLevel: 0.75 }],
    ['outpaint', 'fal-image-apps-v2-outpaint', {
      image: ['uxp://source'], expandLeft: 200, expandRight: 200, expandTop: 0, expandBottom: 0,
      zoomOutPercentage: 20, prompt: 'continue the sunset landscape naturally',
    }],
    ['product-photography', 'fal-image-apps-v2-product-photography', {
      image: ['uxp://source'], aspectRatio: '1:1',
    }],
    ['photo-restoration', 'fal-image-apps-v2-photo-restoration', {
      image: ['uxp://source'], enhanceResolution: true, fixColors: true, removeScratches: true, aspectRatio: '4:3',
    }],
    ['pixelcut-background-removal', 'fal-pixelcut-background-removal', { image: ['uxp://source'] }],
  ] as const)('%s 通过 Fal 公共上传、队列、轮询与结果解析完成全链路', async (
    fixtureName,
    modelId,
    params,
  ) => {
    const fixture = fixtures[fixtureName]
    const builtRequests: JsonObject[] = []
    const sourceModel = modelById(modelId)
    const client = createModularGenerationClient({
      runtime: fixtureRuntime(fixture, builtRequests),
      packs: [{ models: [fastModel(sourceModel)], providers: pack.providers }],
    })

    try {
      const created = await client.generate({ modelId, params })
      expect(created.status).toBe('pending')
      const completed = await client.continuePolling({ modelId, taskId: String(created.taskId) })
      expect(completed.status).toBe('completed')
      expect(completed.url).toContain('https://fixture.invalid/')
      expect(builtRequests).toHaveLength(1)
      const mediaField = modelId.includes('product-photography') ? 'product_image_url' : 'image_url'
      expect(builtRequests[0]).toEqual({
        ...fixture.input,
        [mediaField]: 'https://cdn.fixture.invalid/source.png',
      })
    } finally {
      client.dispose()
    }
  }, 15_000)

  it('所有 builder 都主动拒绝缺图，不依赖特定宿主的表单校验', () => {
    for (const model of models) {
      expect(() => model.request.builder({ image: [] })).toThrow(/必须且只能提供 1 张/)
    }
  })
})
