import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createGenerationClient,
  defineModel,
  resolveProvider,
  unregisterProvider,
  type ProviderAdapter,
  type RuntimeContext,
} from '../src'

const PROVIDER_ID = 'generation-client-test-provider'

afterEach(() => unregisterProvider(PROVIDER_ID))

function runtime(): RuntimeContext {
  return {
    transport: { fetch: async () => { throw new Error('Unexpected network') } },
    credentials: { get: (_scope, providerId) => providerId === PROVIDER_ID ? 'fixture-key' : undefined },
    media: { read: async () => { throw new Error('Unexpected media read') } },
  }
}

const model = defineModel({
  meta: {
    id: 'generation-client-test-model',
    canonicalModelId: 'generation-client-test-model',
    provider: PROVIDER_ID,
    type: 'image',
  },
  params: [{ id: 'prompt', type: 'text', order: 1, default: '' }],
  endpoints: '/v1/generate',
  request: { builder: (params) => ({ prompt: params.prompt }) },
  pricing: { currency: '$', fixed: 0 },
})

describe('createGenerationClient', () => {
  it('复用真实生成内核并保持 99 模型目录与生命周期', async () => {
    const execute = vi.fn<ProviderAdapter['execute']>(async (input) => ({
      status: 'completed',
      url: 'https://example.com/generated.png',
      metadata: { body: input.body },
    }))
    const adapter: ProviderAdapter = {
      execute,
      continuePolling: async () => ({ status: 'completed', url: '', metadata: {} }),
    }
    const client = createGenerationClient({
      runtime: runtime(),
      providers: [{ id: PROVIDER_ID, adapter }],
      models: [model],
    })

    expect(client.catalog.list()).toHaveLength(100)
    expect('chat' in client).toBe(false)
    await expect(client.generate({
      modelId: model.meta.id,
      requestId: 'generation-client-test',
      params: { prompt: 'hello' },
    })).resolves.toMatchObject({
      status: 'completed',
      url: 'https://example.com/generated.png',
      metadata: { body: { prompt: 'hello' } },
    })
    expect(execute).toHaveBeenCalledOnce()

    client.dispose()
    expect(() => client.catalog.list()).toThrow(/client_disposed/)
    expect(() => resolveProvider(PROVIDER_ID)).toThrow(/unknown_provider/)
  })
})
