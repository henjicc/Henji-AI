import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import { catalog } from '../src/catalog'
import { createModularGenerationClient } from '../src/generation/core'
import { models, pack } from '../src/packs/tool-packs/fal-multi-angle-tools'
import type { ModelRuntimeDefinition } from '../src/types/model'
import type { JsonObject } from '../src/types/runtime'

interface Fixture {
  endpoint: string
  input: JsonObject
  submit: JsonObject
  status: JsonObject
  result: JsonObject
}

const fixtures = Object.fromEntries([
  'qwen-image-edit-2509-multiple-angles',
  'perspective-change',
].map((name) => [
  name,
  JSON.parse(fs.readFileSync(new URL(`./fixtures/fal-tools/${name}.json`, import.meta.url), 'utf8')) as Fixture,
]))

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

describe('Fal 多角度按需工具 pack', () => {
  it('不进入默认 catalog，两个 profile 独立分发且都没有提示词参数', () => {
    expect(models.map((model) => model.meta.id)).toEqual([
      'fal-qwen-image-edit-2509-multiple-angles',
      'fal-perspective-change',
    ])
    expect(catalog.some((model) => models.some((tool) => tool.meta.id === model.meta.id))).toBe(false)
    expect(models.every((model) => model.params.every((param) => param.id !== 'prompt'))).toBe(true)
    expect(models.every((model) => model.inputLimits?.images?.exact === 1)).toBe(true)
  })

  it('连续档映射官方控制字段、夹紧范围并固定单张输出', () => {
    const model = models[0]
    const body = model.request.builder({
      image: ['uxp://source'],
      __firstImageRatio: 1,
      rotateRightLeft: 120,
      verticalAngle: -2,
      moveForward: 20,
      wideAngleLens: true,
      prompt: '这个字段不应进入请求',
    })
    expect(body).toEqual({
      image_urls: ['uxp://source'],
      image_size: { width: 1024, height: 1024 },
      rotate_right_left: 90,
      vertical_angle: -1,
      move_forward: 10,
      wide_angle_lens: true,
      num_images: 1,
      guidance_scale: 1,
      num_inference_steps: 6,
      acceleration: 'regular',
      enable_safety_checker: true,
      lora_scale: 1.25,
    })
    expect(model.pricing?.calculator?.({})).toBe(0.035)
  })

  it('离散档只接受 9 个官方预设，非法值稳定回落正面', () => {
    const model = models[1]
    expect(model.params.find((param) => param.id === 'targetPerspective')?.options?.map((option) => option.value))
      .toEqual([
        'front', 'left_side', 'right_side', 'back', 'top_down', 'bottom_up',
        'birds_eye', 'three_quarter_left', 'three_quarter_right',
      ])
    expect(model.request.builder({ image: ['uxp://source'], targetPerspective: 'back' })).toEqual({
      image_url: 'uxp://source',
      target_perspective: 'back',
    })
    expect(model.request.builder({ image: ['uxp://source'], targetPerspective: 'unknown' })).toEqual({
      image_url: 'uxp://source',
      target_perspective: 'front',
    })
    expect(model.pricing?.fixed).toBe(0.04)
  })

  it.each([
    ['qwen-image-edit-2509-multiple-angles', 'fal-qwen-image-edit-2509-multiple-angles', {
      image: ['uxp://source'], rotateRightLeft: 45, verticalAngle: 0, moveForward: 0, wideAngleLens: false,
    }],
    ['perspective-change', 'fal-perspective-change', { image: ['uxp://source'], targetPerspective: 'back' }],
  ] as const)('%s 通过 Fal 公共上传、队列、轮询与结果解析完成全链路', async (
    fixtureName,
    modelId,
    params
  ) => {
    const fixture = fixtures[fixtureName]
    const builtRequests: JsonObject[] = []
    const sourceModel = models.find((candidate) => candidate.meta.id === modelId)
    if (!sourceModel) throw new Error(`Missing ${modelId}`)
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
      expect(builtRequests[0]).toEqual({
        ...fixture.input,
        ...(modelId.includes('multiple-angles')
          ? { image_urls: ['https://cdn.fixture.invalid/source.png'] }
          : { image_url: 'https://cdn.fixture.invalid/source.png' }),
      })
    } finally {
      client.dispose()
    }
  }, 15_000)

  it('任一 profile 都在 schema 层声明且只允许 1 张输入图', () => {
    expect(models[0].inputLimits?.images).toEqual({ exact: 1 })
    expect(models[1].inputLimits?.images).toEqual({ exact: 1 })
    expect(models[0].requirements?.[0].require.images).toEqual({ exact: 1 })
    expect(models[1].requirements?.[0].require.images).toEqual({ exact: 1 })
  })
})
