import { describe, expect, it, vi } from 'vitest'

import { createModularGenerationClient } from '../src/generation/core'
import { pack as kieZImagePack } from '../src/packs/models/kie/z-image'
import { pack as kieGptImage2Pack } from '../src/packs/models/kie/gpt-image-2'
import { pack as kiePack } from '../src/packs/provider-packs/kie'
import type { RuntimeContext } from '../src/runtime'

function runtime(): RuntimeContext {
  return {
    transport: { fetch: async () => { throw new Error('Unexpected network') } },
    credentials: { get: async () => undefined },
    media: { read: async () => { throw new Error('Unexpected media read') } },
  }
}

describe('modular generation client', () => {
  it('零模型/零供应商可创建且生命周期不产生网络', () => {
    const client = createModularGenerationClient({ runtime: runtime() })
    expect(client.catalog.list()).toEqual([])
    expect(client.providers.list()).toEqual([])
    expect(() => client.catalog.get('missing')).not.toThrow()
    expect(() => client.generate({ modelId: 'missing', params: {} })).rejects.toThrow(
      /Unable to resolve provider for model: missing/
    )
    client.dispose()
  })

  it('单模型 pack 的目录严格只有该模型，其他内置 modelId 被拒绝', async () => {
    const client = createModularGenerationClient({ runtime: runtime(), packs: [kieZImagePack] })
    expect(client.catalog.list().map((model) => model.meta.id)).toEqual(['kie-z-image'])
    expect(client.providers.list()).toEqual(['kie'])
    await expect(client.generate({ modelId: 'fal-ai-gpt-image-2', params: {} })).rejects.toThrow(
      /Unable to resolve provider for model: fal-ai-gpt-image-2/
    )
    client.dispose()
  })

  it('KIE provider pack 只装配 KIE 的 27 个模型', () => {
    const client = createModularGenerationClient({ runtime: runtime(), packs: [kiePack] })
    expect(client.catalog.list()).toHaveLength(27)
    expect(new Set(client.catalog.list().map((model) => model.meta.provider))).toEqual(new Set(['kie']))
    expect(client.providers.list()).toEqual(['kie'])
    client.dispose()
  })

  it('可组合同一供应商的多个单模型完整 pack，provider 自动复用', () => {
    const client = createModularGenerationClient({
      runtime: runtime(),
      packs: [kieZImagePack, kieGptImage2Pack],
    })
    expect(client.catalog.list().map((model) => model.meta.id)).toEqual([
      'kie-z-image',
      'kie-gpt-image-2',
    ])
    expect(client.providers.list()).toEqual(['kie'])
    client.dispose()
  })

  it('一个完整 KIE 媒体模型 pack 独立跑通上传、创建、轮询与结果读取', async () => {
    const calls: string[] = []
    const client = createModularGenerationClient({
      runtime: {
        transport: {
          fetch: async (url) => {
            const target = String(url)
            calls.push(target)
            if (target === 'https://kieai.redpandaai.co/api/file-stream-upload') {
              return new Response(JSON.stringify({
                data: { fileUrl: 'https://files.kie.ai/fixture/uploaded.png' },
              }), { status: 200, headers: { 'content-type': 'application/json' } })
            }
            if (target === 'https://api.kie.ai/api/v1/jobs/createTask') {
              return new Response(JSON.stringify({
                code: 200,
                success: true,
                data: { taskId: 'kie-modular-task' },
              }), { status: 200, headers: { 'content-type': 'application/json' } })
            }
            if (target.includes('/api/v1/jobs/recordInfo?taskId=kie-modular-task')) {
              return new Response(JSON.stringify({
                code: 200,
                success: true,
                data: {
                  state: 'success',
                  resultJson: JSON.stringify({
                    resultUrls: ['https://files.kie.ai/fixture/result.png'],
                  }),
                },
              }), { status: 200, headers: { 'content-type': 'application/json' } })
            }
            throw new Error(`Unexpected fixture URL: ${target}`)
          },
        },
        credentials: { get: async () => 'fixture-key' },
        media: {
          read: async () => ({
            bytes: new Uint8Array([137, 80, 78, 71]),
            mimeType: 'image/png',
            filename: 'uxp-layer.png',
          }),
        },
      },
      packs: [kieGptImage2Pack],
    })

    const created = await client.generate({
      modelId: 'kie-gpt-image-2',
      requestId: 'kie-modular-create',
      params: {
        prompt: 'fixture edit',
        uploadedFilePaths: ['uxp://active-layer'],
        kieGptImage2AspectRatio: '1:1',
        kieGptImage2Resolution: '1K',
      },
    })
    expect(created).toMatchObject({ status: 'pending', taskId: 'kie-modular-task' })
    const result = await client.continuePolling({
      modelId: 'kie-gpt-image-2',
      taskId: 'kie-modular-task',
      requestId: 'kie-modular-poll',
    })
    expect(result).toMatchObject({
      status: 'completed',
      url: 'https://files.kie.ai/fixture/result.png',
    })
    expect(calls).toEqual([
      'https://kieai.redpandaai.co/api/file-stream-upload',
      'https://api.kie.ai/api/v1/jobs/createTask',
      'https://api.kie.ai/api/v1/jobs/recordInfo?taskId=kie-modular-task',
    ])
    client.dispose()
  })

  it('显式 provider 执行、取消与 dispose 不依赖全局 registry', async () => {
    const execute = vi.fn(async () => ({
      status: 'completed' as const,
      url: 'memory://fixture',
      metadata: {},
    }))
    const model = kieZImagePack.models[0]
    const client = createModularGenerationClient({
      runtime: {
        ...runtime(),
        credentials: { get: async () => 'fixture-key' },
      },
      models: [model],
      providers: [{
        id: 'kie',
        adapter: {
          execute,
          continuePolling: async () => ({ status: 'completed', url: '', metadata: {} }),
        },
      }],
    })

    await expect(client.generate({
      modelId: 'kie-z-image',
      requestId: 'modular-execute',
      params: { prompt: 'fixture' },
    })).resolves.toMatchObject({ status: 'completed', url: 'memory://fixture' })
    expect(execute).toHaveBeenCalledOnce()
    client.dispose()
    expect(() => client.catalog.list()).toThrow(/client_disposed/)
  })
})
