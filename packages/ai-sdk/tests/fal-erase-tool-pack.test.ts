import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { createModularGenerationClient } from '../src/generation/core'
import { catalog } from '../src/catalog'
import { pack as defaultFalPack } from '../src/packs/provider-packs/fal'
import {
  models,
  pack,
} from '../src/packs/tool-packs/fal-image-edit-tools'
import type { JsonObject } from '../src/types/runtime'
import type { ModelRuntimeDefinition } from '../src/types/model'

interface Fixture {
  endpoint: string
  input: JsonObject
  submit: JsonObject
  status: JsonObject
  result: JsonObject
}

const fixtures = Object.fromEntries(['flux-pro-erase', 'bria-eraser', 'finegrain-eraser'].map((name) => [
  name,
  JSON.parse(fs.readFileSync(new URL(`./fixtures/fal-tools/${name}.json`, import.meta.url), 'utf8')) as Fixture,
]))

function fixtureRuntime(fixture: Fixture, calls: Array<{ url: string; init?: RequestInit }>) {
  let uploads = 0
  return {
    transport: {
      fetch: async (url: string | URL, init?: RequestInit) => {
        const target = String(url)
        calls.push({ url: target, init })
        if (target.startsWith('https://rest.fal.ai/storage/upload/initiate')) {
          uploads += 1
          return Response.json({
            upload_url: `https://upload.fixture.invalid/${uploads}`,
            file_url: `https://cdn.fixture.invalid/${uploads}.png`,
          })
        }
        if (target.startsWith('https://upload.fixture.invalid/')) return new Response('', { status: 200 })
        if (target === `https://queue.fal.run/${fixture.endpoint}`) return Response.json(fixture.submit)
        if (target.endsWith('/status')) return Response.json(fixture.status)
        if (target.includes('/requests/')) return Response.json(fixture.result)
        throw new Error(`Unexpected fixture URL: ${target}`)
      },
    },
    credentials: { get: async () => 'fixture-key' },
    media: {
      read: async (source: string) => ({
        bytes: new Uint8Array(source.endsWith('mask') ? [0, 255] : [137, 80, 78, 71]),
        mimeType: 'image/png',
        filename: source.endsWith('mask') ? 'mask.png' : 'source.png',
      }),
    },
  }
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

describe('Fal image erase optional tool packs', () => {
  it('默认兼容目录仍为99，默认Fal pack不含3个可选工具', () => {
    expect(catalog).toHaveLength(99)
    expect(models.map((model) => model.meta.id)).toEqual([
      'fal-flux-pro-erase', 'fal-bria-eraser', 'fal-finegrain-eraser',
    ])
    expect(defaultFalPack.models).toHaveLength(31)
    expect(defaultFalPack.models.some((model) => model.meta.tags?.includes('erase'))).toBe(false)
  })

  it.each([
    ['flux-pro-erase', 'fal-flux-pro-erase'],
    ['bria-eraser', 'fal-bria-eraser'],
    ['finegrain-eraser', 'fal-finegrain-eraser'],
  ])('%s 单模型契约完成上传、创建、轮询与结果', async (fixtureName, modelId) => {
    const fixture = fixtures[fixtureName]
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const sourceModel = models.find((candidate) => candidate.meta.id === modelId)
    if (!sourceModel) throw new Error(`Missing ${modelId}`)
    const model = fastModel(sourceModel)
    const client = createModularGenerationClient({
      runtime: fixtureRuntime(fixture, calls),
      packs: [{ models: [model], providers: pack.providers }],
    })
    const built: JsonObject[] = []
    const created = await client.generate({
      modelId,
      requestId: `${modelId}-create`,
      params: { image: ['uxp://source'], mask: ['uxp://mask'], mode: 'standard' },
    }, { onRequestBuilt: ({ requestBody }) => built.push(requestBody as JsonObject) })
    expect(created.status).toBe('pending')
    expect(built[0]).toEqual({
      ...fixture.input,
      image_url: 'https://cdn.fixture.invalid/1.png',
      mask_url: 'https://cdn.fixture.invalid/2.png',
    })
    const result = await client.continuePolling({ modelId, taskId: String(created.taskId) })
    expect(result.status).toBe('completed')
    expect(result.url).toContain('https://fixture.invalid/')
    expect(calls).toHaveLength(7)
    client.dispose()
  }, 15_000)

  it.each(models)('$meta.id 的失败状态由Fal公共内核拒绝', async (sourceModel) => {
    const model = fastModel(sourceModel)
    const fixtureName = sourceModel.meta.id.replace(/^fal-/, '').replace('flux-pro-erase', 'flux-pro-erase')
    const fixture = fixtures[fixtureName]
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const failedFixture: Fixture = {
      ...fixture,
      status: { status: 'FAILED', error: 'fixture rejected' },
    }
    const client = createModularGenerationClient({
      runtime: fixtureRuntime(failedFixture, calls),
      packs: [{ models: [model], providers: pack.providers }],
    })
    const created = await client.generate({
      modelId: model.meta.id,
      params: { image: ['uxp://source'], mask: ['uxp://mask'] },
    })
    await expect(client.continuePolling({
      modelId: model.meta.id,
      taskId: String(created.taskId),
    })).rejects.toMatchObject({ code: 'provider_task_failed' })
    client.dispose()
  })

  it('聚合distribution pack只装入3个工具并用统一生成内核完成全链路', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const client = createModularGenerationClient({
      runtime: fixtureRuntime(fixtures['bria-eraser'], calls),
      packs: [pack],
    })
    expect(client.catalog.list()).toHaveLength(3)
    const created = await client.generate({
      modelId: 'fal-bria-eraser',
      requestId: 'aggregate-bria-fixture',
      params: { image: ['uxp://source'], mask: ['uxp://mask'] },
    })
    const result = await client.continuePolling({
      modelId: 'fal-bria-eraser',
      taskId: String(created.taskId),
      requestId: 'aggregate-bria-poll',
    })
    expect(result.url).toBe('https://fixture.invalid/bria-erase.png')
    client.dispose()
  }, 15_000)

  it('取消与错误继续由统一生成客户端负责', async () => {
    const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const client = createModularGenerationClient({
      runtime: {
        transport: { fetch },
        credentials: { get: async () => 'fixture-key' },
        media: { read: async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/png', filename: 'x.png' }) },
      },
      packs: [{ models: [fastModel(models[0])], providers: pack.providers }],
    })
    const pending = client.generate({
      modelId: 'fal-flux-pro-erase',
      requestId: 'erase-cancel',
      params: { image: ['uxp://source'], mask: ['uxp://mask'] },
    })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    client.cancel({ namespace: 'generation', taskId: 'erase-cancel' })
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    await expect(client.generate({ modelId: 'not-imported', params: {} })).rejects.toThrow(/Unable to resolve/)
    client.dispose()
  })
})
