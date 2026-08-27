import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BUILTIN_PROVIDER_IDS,
  buildRequest,
  createModelIndex,
  defineModel,
  executeGenerate,
  listProviders,
  registerProvider,
  resolveProvider,
  unregisterProvider,
  type ProviderAdapter,
  type ProviderExecutionInput,
} from '../src'
import { fakeRuntimeContext } from './providers/test-helpers'

const FAKE_PROVIDER_ID = 'test-transcript-provider'

afterEach(() => {
  unregisterProvider(FAKE_PROVIDER_ID)
})

function fakeProvider(
  execute: (input: ProviderExecutionInput) => Promise<Awaited<ReturnType<ProviderAdapter['execute']>>>
): ProviderAdapter {
  return {
    execute,
    continuePolling: async () => ({
      status: 'failed',
      url: '',
      metadata: { reason: 'not-used' },
    }),
  }
}

describe('开放模型类型与供应商注册', () => {
  it('假供应商 + 假类型走真实注册、索引、请求构建和执行路径', async () => {
    const execute = vi.fn(async (input: ProviderExecutionInput) => ({
      status: 'completed' as const,
      url: 'memory://transcript/1',
      metadata: { receivedBody: input.body },
    }))
    registerProvider(FAKE_PROVIDER_ID, fakeProvider(execute))

    const model = defineModel({
      meta: {
        id: 'test-transcript-model',
        canonicalModelId: 'test-transcript-model',
        provider: FAKE_PROVIDER_ID,
        type: 'transcript',
      },
      params: [
        {
          id: 'prompt',
          type: 'text',
          order: 1,
          default: '',
        },
      ],
      endpoints: '/v1/transcript',
      request: {
        builder: (params) => ({ text: params.prompt, source: 'sdk-builder' }),
      },
      pricing: { currency: '$', fixed: 0 },
    })

    const index = createModelIndex([model])
    const indexedModel = index.get('test-transcript-model')
    expect(indexedModel?.meta.type).toBe('transcript')
    expect(index.providerIds()).toEqual([FAKE_PROVIDER_ID])

    const request = await buildRequest({ prompt: 'hello' }, indexedModel)
    expect(request).toEqual({
      route: '/v1/transcript',
      method: 'POST',
      body: { text: 'hello', source: 'sdk-builder' },
    })

    const result = await executeGenerate(FAKE_PROVIDER_ID, {
      apiKey: 'test-key',
      ...request,
      requestId: 'test-request',
      runtime: fakeRuntimeContext(async () => {
        throw new Error('fake provider must not bypass its adapter through transport')
      }),
    })

    expect(result.status).toBe('completed')
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]?.[0].body).toEqual({ text: 'hello', source: 'sdk-builder' })
  })

  it('重复注册拒绝覆盖，注销语义可预测且可用于测试隔离', () => {
    const first = fakeProvider(async () => ({ status: 'completed', url: 'memory://first', metadata: {} }))
    const second = fakeProvider(async () => ({ status: 'completed', url: 'memory://second', metadata: {} }))

    registerProvider(FAKE_PROVIDER_ID, first)
    expect(() => registerProvider(FAKE_PROVIDER_ID, second)).toThrow(/provider_already_registered/)
    expect(resolveProvider(FAKE_PROVIDER_ID)).toBe(first)
    expect(unregisterProvider(FAKE_PROVIDER_ID)).toBe(true)
    expect(unregisterProvider(FAKE_PROVIDER_ID)).toBe(false)
  })

  it('8 个内置供应商保持初始化，listProviders 返回隔离快照', () => {
    const snapshot = listProviders()
    expect(new Set(snapshot)).toEqual(new Set(BUILTIN_PROVIDER_IDS))

    snapshot.length = 0
    expect(new Set(listProviders())).toEqual(new Set(BUILTIN_PROVIDER_IDS))
  })
})
