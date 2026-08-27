import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearCancelFlag,
  createAIClient,
  defineModel,
  isCancelled,
  registerAbortController,
  resolveProvider,
  unregisterProvider,
  type ModelStepInput,
  type ProviderAdapter,
  type RuntimeContext,
} from '../src'
import { pack as kieZImagePack } from '../src/packs/models/kie/z-image'

const CLIENT_PROVIDER_ID = 'client-test-provider'
const SECOND_CLIENT_PROVIDER_ID = 'second-client-test-provider'

afterEach(() => {
  unregisterProvider(CLIENT_PROVIDER_ID)
  unregisterProvider(SECOND_CLIENT_PROVIDER_ID)
  clearCancelFlag('generation', 'shared-task')
  clearCancelFlag('llm', 'shared-task')
})

function createRuntime(
  fetch: RuntimeContext['transport']['fetch'] = async () => {
    throw new Error('Unexpected transport request')
  }
): RuntimeContext {
  return {
    transport: { fetch },
    credentials: {
      get: (_scope, providerId) => providerId === CLIENT_PROVIDER_ID || providerId === 'openai'
        ? 'test-key'
        : undefined,
    },
    media: {
      read: async () => ({
        bytes: new Uint8Array(),
        mimeType: 'application/octet-stream',
        filename: 'unused',
      }),
    },
  }
}

function createTestModel() {
  return defineModel({
    meta: {
      id: 'client-test-model',
      canonicalModelId: 'client-test-model',
      provider: CLIENT_PROVIDER_ID,
      type: 'image',
      aliases: ['client-test-alias'],
      aliasParamDefaults: {
        'client-test-alias': { quality: 'high' },
      },
      aliasParamMappings: {
        'client-test-alias': { legacyPrompt: 'prompt' },
      },
      polling: { interval: 1, maxAttempts: 2 },
    },
    params: [
      { id: 'prompt', type: 'text', order: 1, default: '' },
      {
        id: 'quality',
        type: 'dropdown',
        order: 2,
        default: 'standard',
        options: [{ value: 'standard' }, { value: 'high' }],
      },
    ],
    endpoints: '/v1/client-test',
    request: {
      builder: (params) => ({
        prompt: params.prompt,
        quality: params.quality,
        builtBy: 'real-catalog-builder',
      }),
    },
    pricing: { currency: '$', fixed: 0 },
  })
}

describe('createAIClient', () => {
  it('显式 modular 选择时根 client 目录严格只装配所选 pack，chat 仍可用', () => {
    const client = createAIClient({
      runtime: createRuntime(),
      generation: { mode: 'modular', packs: [kieZImagePack] },
    })
    expect(client.catalog.list().map((model) => model.meta.id)).toEqual(['kie-z-image'])
    expect(client.providers.list()).toEqual(['kie'])
    expect(client.chat.stream).toBeTypeOf('function')
    client.dispose()
  })

  it('通过真实模型索引、builder 与 provider registry 跑通生成和续轮询', async () => {
    const execute = vi.fn<ProviderAdapter['execute']>(async (input) => ({
      status: 'pending',
      url: '',
      taskId: 'provider-task-1',
      metadata: { requestBody: input.body },
    }))
    const continuePolling = vi.fn<ProviderAdapter['continuePolling']>(async (input) => ({
      status: 'completed',
      url: 'https://example.com/result.png',
      taskId: input.taskId,
      metadata: { route: input.route },
    }))
    const adapter: ProviderAdapter = { execute, continuePolling }
    const client = createAIClient({
      runtime: createRuntime(),
      providers: [{ id: CLIENT_PROVIDER_ID, adapter }],
      models: [createTestModel()],
    })
    const requestPhases: string[] = []

    try {
      await expect(client.generate({
        modelId: 'client-test-alias',
        requestId: 'client-generate',
        params: { legacyPrompt: 'hello' },
      }, {
        onRequestBuilt: (info) => requestPhases.push(`${info.method}:${info.route}`),
      })).resolves.toEqual({
        status: 'pending',
        url: '',
        taskId: 'provider-task-1',
        metadata: {
          requestBody: {
            prompt: 'hello',
            quality: 'high',
            builtBy: 'real-catalog-builder',
          },
        },
      })

      await expect(client.continuePolling({
        modelId: 'client-test-model',
        taskId: 'provider-task-1',
        requestId: 'client-poll',
      }, {
        onRequestBuilt: (info) => requestPhases.push(`${info.method}:${info.route}`),
      })).resolves.toMatchObject({
        status: 'completed',
        url: 'https://example.com/result.png',
        taskId: 'provider-task-1',
      })

      expect(requestPhases).toEqual(['POST:/v1/client-test', 'GET:/v1/client-test'])
      expect(execute).toHaveBeenCalledOnce()
      expect(continuePolling).toHaveBeenCalledOnce()
      expect(client.catalog.get('client-test-alias')?.meta.id).toBe('client-test-model')
      expect(client.catalog.listByType('image').some((model) => model.meta.id === 'client-test-model')).toBe(true)
      expect(client.catalog.listByProvider(CLIENT_PROVIDER_ID)).toHaveLength(1)
      expect(client.providers.list()).toContain(CLIENT_PROVIDER_ID)
      await expect(client.providers.testConnection(CLIENT_PROVIDER_ID)).resolves.toMatchObject({
        providerId: CLIENT_PROVIDER_ID,
        status: 'saved_unverified',
      })
    } finally {
      client.dispose()
    }

    expect(() => resolveProvider(CLIENT_PROVIDER_ID)).toThrow(/unknown_provider/)
  })

  it('通过同一假 Transport 跑通 chat.stream 与 chat.modelStep 的真实编排', async () => {
    const fetch = vi.fn(async () => new Response([
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":"完成"},"finish_reason":null}]}',
      '',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }))
    const client = createAIClient({ runtime: createRuntime(fetch) })
    const streamEvents: string[] = []

    await expect(client.chat.stream({
      requestId: 'client-chat',
      providerId: 'openai',
      modelId: 'test-model',
      baseUrl: 'https://example.com/v1',
      messages: [{ role: 'user', content: '测试' }],
    }, (event) => streamEvents.push(event.type))).resolves.toMatchObject({
      providerId: 'openai',
      modelId: 'test-model',
      outputChars: 2,
    })

    const input = {
      requestId: 'client-model-step',
      runId: 'client-run',
      stepId: 'client-step',
      providerId: 'openai',
      modelId: 'test-model',
      baseUrl: 'https://example.com/v1',
      messages: [{ role: 'user', content: '测试' }],
      output: { mode: 'text' },
      capabilities: {
        image: false,
        video: false,
        audio: false,
        streaming: true,
        toolCall: false,
        parallelTools: false,
        structuredOutputMode: 'none',
        reasoning: false,
        sampling: true,
        usage: true,
      },
      settings: { maxRetries: 0 },
    } as ModelStepInput
    await expect(client.chat.modelStep(input, () => undefined)).resolves.toMatchObject({
      text: '完成',
      finishReason: 'stop',
    })

    expect(streamEvents).toContain('Token')
    expect(fetch).toHaveBeenCalledTimes(2)
    client.dispose()
  })

  it('cancel 按服务端 taskId 终止真实轮询，且不会取消另一类同名任务', async () => {
    const llmController = new AbortController()
    registerAbortController('llm', 'shared-task', llmController)
    let pollingSignal: AbortSignal | undefined
    const adapter: ProviderAdapter = {
      execute: async () => ({ status: 'pending', url: '', taskId: 'shared-task', metadata: {} }),
      continuePolling: async (input) => {
        pollingSignal = input.signal
        return await new Promise((_resolve, reject) => {
          input.signal?.addEventListener('abort', () => reject(new Error('polling aborted')), {
            once: true,
          })
        })
      },
    }
    const client = createAIClient({
      runtime: createRuntime(),
      providers: [{ id: CLIENT_PROVIDER_ID, adapter }],
      models: [createTestModel()],
    })
    const polling = client.continuePolling({
      modelId: 'client-test-model',
      taskId: 'shared-task',
      requestId: 'different-log-request-id',
    })
    await vi.waitFor(() => expect(pollingSignal).toBeDefined())

    client.cancel({ namespace: 'generation', taskId: 'shared-task' })

    await expect(polling).rejects.toThrow('polling aborted')
    expect(pollingSignal?.aborted).toBe(true)
    expect(llmController.signal.aborted).toBe(false)
    expect(isCancelled('llm', 'shared-task')).toBe(false)
    client.dispose()
  })

  it('并发 client 只注销自己登记的 provider，构造失败会回滚本次污染', () => {
    const adapter: ProviderAdapter = {
      execute: async () => ({ status: 'completed', url: '', metadata: {} }),
      continuePolling: async () => ({ status: 'completed', url: '', metadata: {} }),
    }
    const first = createAIClient({
      runtime: createRuntime(),
      providers: [{ id: CLIENT_PROVIDER_ID, adapter }],
    })
    const second = createAIClient({
      runtime: createRuntime(),
      providers: [{ id: SECOND_CLIENT_PROVIDER_ID, adapter }],
    })

    first.dispose()
    expect(() => resolveProvider(CLIENT_PROVIDER_ID)).toThrow(/unknown_provider/)
    expect(resolveProvider(SECOND_CLIENT_PROVIDER_ID)).toBe(adapter)
    second.dispose()

    expect(() => createAIClient({
      runtime: createRuntime(),
      providers: [
        { id: CLIENT_PROVIDER_ID, adapter },
        { id: 'fal', adapter },
      ],
    })).toThrow(/provider_already_registered/)
    expect(() => resolveProvider(CLIENT_PROVIDER_ID)).toThrow(/unknown_provider/)
  })
})
