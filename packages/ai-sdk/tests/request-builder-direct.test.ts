import { describe, expect, it } from 'vitest'

import { catalogIndex } from '../src/catalog'
import { buildRequest, normalizeRequestBody } from '../src/protocols'
import type { ModelRuntimeDefinition } from '../src/types/model'

async function buildNormalized(modelId: string, params: Record<string, unknown>) {
  const model = catalogIndex.get(modelId)
  expect(model).toBeDefined()
  const built = await buildRequest(params, model)
  return {
    ...built,
    body: normalizeRequestBody(built.body, model?.runtimeConstraints),
  }
}

describe('主进程直连 SDK catalog 请求契约', () => {
  it('统一等待异步 endpoint selector 和 builder', async () => {
    const model = {
      meta: { id: 'async-model', provider: 'test', type: 'image', tags: [] },
      params: [],
      endpoints: { selector: async () => '/async-route' },
      request: { builder: async () => ({ ready: true }) },
    } satisfies ModelRuntimeDefinition

    await expect(buildRequest({}, model)).resolves.toEqual({
      route: '/async-route', method: 'POST', body: { ready: true },
    })
  })

  it('Fal Seedream v4 保留智能比例提示、编辑路由和请求体', async () => {
    await expect(buildNormalized('fal-ai-bytedance-seedream-v4', {
      prompt: 'legacy-contract', uploadedFilePaths: ['https://fixture.invalid/landscape.png'],
      __firstImageRatio: 16 / 9, falSeedreamV4AspectRatio: 'smart',
      falSeedreamV4Resolution: '4K', falSeedream40NumImages: 2,
    })).resolves.toEqual({
      route: 'fal-ai/bytedance/seedream/v4/edit', method: 'POST',
      body: {
        prompt: 'legacy-contract', image_size: { width: 4096, height: 3072 }, num_images: 2,
        enable_safety_checker: false, image_urls: ['https://fixture.invalid/landscape.png'],
      },
    })
  })

  it('Fal Seedream v4.5 保留异步智能比例和运行时约束归一化', async () => {
    await expect(buildNormalized('fal-ai-bytedance-seedream-v4.5', {
      prompt: 'legacy-contract', uploadedFilePaths: ['https://fixture.invalid/portrait.png'],
      __firstImageRatio: 9 / 16, falSeedreamV45AspectRatio: 'smart',
      falSeedreamV45Resolution: '2K', falSeedream45NumImages: 3,
    })).resolves.toEqual({
      route: 'fal-ai/bytedance/seedream/v4.5/edit', method: 'POST',
      body: {
        prompt: 'legacy-contract', image_size: { width: 1920, height: 2731 }, num_images: 3,
        enable_safety_checker: false, image_urls: ['https://fixture.invalid/portrait.png'],
      },
    })
  })

  it('KIE Seedream 4.0 保留智能比例映射和编辑模型', async () => {
    await expect(buildNormalized('kie-seedream-4.0', {
      prompt: 'legacy-contract', uploadedFilePaths: ['https://fixture.invalid/landscape.png'],
      __firstImageRatio: 16 / 9, kieSeedream40AspectRatio: 'smart',
      kieSeedream40Resolution: '4K', kieSeedream40MaxImages: 2,
    })).resolves.toEqual({
      route: '/api/v1/jobs/createTask', method: 'POST',
      body: {
        model: 'bytedance/seedream-v4-edit',
        input: {
          prompt: 'legacy-contract', image_size: 'landscape_16_9', image_resolution: '4K',
          max_images: 2, image_urls: ['https://fixture.invalid/landscape.png'],
        },
      },
    })
  })

  it('KIE Seedream 4.5 保留智能比例映射、质量和编辑模型', async () => {
    await expect(buildNormalized('kie-seedream-4.5', {
      prompt: 'legacy-contract', uploadedFilePaths: ['https://fixture.invalid/portrait.png'],
      __firstImageRatio: 9 / 16, kieSeedreamAspectRatio: 'smart', kieSeedreamQuality: '4K',
    })).resolves.toEqual({
      route: '/api/v1/jobs/createTask', method: 'POST',
      body: {
        model: 'seedream/4.5-edit',
        input: {
          prompt: 'legacy-contract', aspect_ratio: '9:16', quality: 'high',
          image_urls: ['https://fixture.invalid/portrait.png'],
        },
      },
    })
  })
})
