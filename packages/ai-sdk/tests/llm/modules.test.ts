import { describe, expect, it, vi } from 'vitest'

import { createModelCapabilityDiscovery } from '../../src/discovery'
import {
  createGroqLlmModule,
  GROQ_BASE_URL,
  GROQ_DEFAULT_MODEL_CONFIG,
} from '../../src/llm/groq'
import {
  createLlmModuleClient,
  defineLlmModuleDescriptor,
  type LlmModule,
  type LlmModuleDescriptor,
  type LlmModuleEvent,
} from '../../src/llm/modules'
import type { RuntimeContext } from '../../src/runtime'

function runtime(logs: Array<Record<string, unknown>> = []): RuntimeContext {
  return {
    transport: { fetch: async () => { throw new Error('LLM module fixture must not use network') } },
    credentials: { get: async () => undefined },
    media: { read: async () => { throw new Error('LLM module fixture must not read media') } },
    logger: {
      info: (_message, context) => logs.push({ level: 'info', ...context }),
      warn: (_message, context) => logs.push({ level: 'warn', ...context }),
      error: (_message, context) => logs.push({ level: 'error', ...context }),
    },
  }
}

function descriptor(input: {
  id?: string
  namespace?: string
  sourceKind?: 'builtin' | 'external' | 'plugin'
  providerId?: string
  modelId?: string
  modes?: Array<'request-response' | 'event-stream'>
} = {}): LlmModuleDescriptor {
  return {
    id: input.id ?? 'plugin.fixture.chat',
    source: {
      kind: input.sourceKind ?? 'plugin',
      namespace: input.namespace ?? 'com.example.fixture',
    },
    providerId: input.providerId ?? 'fixture-provider',
    modelId: input.modelId ?? 'fixture-model',
    displayName: 'Fixture model',
    capabilities: {
      ...GROQ_DEFAULT_MODEL_CONFIG.capabilities,
      image: true,
      audio: true,
      contextWindow: 8_192,
      maxOutputTokens: 2_048,
    },
    executionModes: input.modes ?? ['request-response', 'event-stream'],
    tags: ['fixture', 'plugin'],
  }
}

function moduleOf(
  value = descriptor(),
  execute: LlmModule['execute'] = async () => ({
    output: 'fixture output',
    reasoningOutput: '',
    usage: null,
    finishReason: 'stop',
  }),
  extra: Pick<LlmModule, 'discover' | 'dispose'> = {}
): LlmModule {
  return { descriptor: value, execute, ...extra }
}

const REQUEST = { messages: [{ role: 'user' as const, content: 'fixture prompt' }] }

describe('@henjicc/ai-sdk/llm/modules', () => {
  it('统一执行流式 token、reasoning、usage、finish 与 Done，并记录脱敏生命周期', async () => {
    const logs: Array<Record<string, unknown>> = []
    const events: LlmModuleEvent[] = []
    const execute = vi.fn<LlmModule['execute']>(async (request, context) => {
      expect(request).toMatchObject({
        providerId: 'fixture-provider',
        modelId: 'fixture-model',
        capabilities: { image: true, audio: true },
      })
      expect(context.mode).toBe('event-stream')
      await context.emit({ type: 'ReasoningToken', data: 'think' })
      await context.emit({ type: 'Token', data: 'answer' })
      return {
        output: 'answer',
        reasoningOutput: 'think',
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          reasoningTokens: 1,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          totalTokens: 6,
        },
        finishReason: 'stop',
        providerMetadata: { fixture: true },
      }
    })
    const client = createLlmModuleClient({ runtime: runtime(logs), modules: [moduleOf(descriptor(), execute)] })

    const outcome = await client.execute('plugin.fixture.chat', REQUEST, {
      requestId: 'module-stream',
      mode: 'event-stream',
      onEvent: async (event) => { events.push(event) },
    })

    expect(outcome).toMatchObject({
      providerId: 'fixture-provider', modelId: 'fixture-model', output: 'answer',
      reasoningOutput: 'think', finishReason: 'stop', inputChars: 14, outputChars: 11,
    })
    expect(events.map((event) => event.type)).toEqual([
      'ReasoningToken', 'Token', 'Usage', 'Finish', 'Done',
    ])
    expect(events.at(-1)).toMatchObject({
      type: 'Done', data: { providerId: 'fixture-provider', modelId: 'fixture-model' },
    })
    expect(logs.map((entry) => entry.event)).toEqual([
      'llm.module.execute.start', 'llm.module.execute.completed',
    ])
    expect(JSON.stringify(logs)).not.toContain('fixture prompt')
    await client.dispose()
  })

  it('非流式模式返回相同 outcome，拒绝增量事件并给出可修正提示', async () => {
    const nonStreaming = descriptor({ modes: ['request-response'] })
    nonStreaming.capabilities.streaming = false
    const client = createLlmModuleClient({ runtime: runtime() })
    client.register(moduleOf(nonStreaming))

    await expect(client.execute(nonStreaming.id, REQUEST, { mode: 'request-response' }))
      .resolves.toMatchObject({ output: 'fixture output', finishReason: 'stop' })
    await expect(client.execute(nonStreaming.id, REQUEST, { mode: 'event-stream' }))
      .rejects.toThrow(/does not support event-stream.*request-response/)

    await client.unregister(nonStreaming.id)
    client.register(moduleOf(nonStreaming, async (_request, context) => {
      await context.emit({ type: 'Token', data: 'invalid' })
      return { output: '', reasoningOutput: '', usage: null, finishReason: null }
    }))
    await expect(client.execute(nonStreaming.id, REQUEST, { mode: 'request-response' }))
      .rejects.toThrow(/emitted Token in request-response mode.*event-stream/)
    await client.dispose()
  })

  it('request 坐标串线、未知模块与活动 requestId 冲突均返回可修正事实', async () => {
    let release: (() => void) | undefined
    const blocking = moduleOf(descriptor(), async () => await new Promise((resolve) => {
      release = () => resolve({ output: '', reasoningOutput: '', usage: null, finishReason: null })
    }))
    const client = createLlmModuleClient({ runtime: runtime(), modules: [blocking] })

    await expect(client.execute(blocking.descriptor.id, {
      ...REQUEST, providerId: 'wrong-provider', modelId: 'wrong-model',
    })).rejects.toThrow(/owns fixture-provider\/fixture-model.*wrong-provider\/wrong-model/)
    await expect(client.execute('missing.module', REQUEST))
      .rejects.toThrow(/Available modules: plugin\.fixture\.chat/)

    const first = client.execute(blocking.descriptor.id, REQUEST, { requestId: 'duplicate-request' })
    await Promise.resolve()
    await expect(client.execute(blocking.descriptor.id, REQUEST, { requestId: 'duplicate-request' }))
      .rejects.toThrow(/already active.*unique requestId.*cancel/)
    release?.()
    await first
    await client.dispose()
  })

  it('Abort、cancel 与 timeout 归一到稳定错误并发出 Error 终态', async () => {
    const module = moduleOf(descriptor(), async (_request, context) => await new Promise((_resolve, reject) => {
      const fail = () => reject(new DOMException('aborted', 'AbortError'))
      if (context.signal.aborted) fail()
      else context.signal.addEventListener('abort', fail, { once: true })
    }))
    const client = createLlmModuleClient({ runtime: runtime(), modules: [module] })
    const cancelledEvents: LlmModuleEvent[] = []
    const cancelled = client.execute(module.descriptor.id, REQUEST, {
      requestId: 'cancel-me', onEvent: (event) => { cancelledEvents.push(event) },
    })
    client.cancel('cancel-me')
    await expect(cancelled).rejects.toThrow(/\[cancelled\].*cancel-me/)
    expect(cancelledEvents.at(-1)).toMatchObject({ type: 'Error' })

    await expect(client.execute(module.descriptor.id, REQUEST, {
      requestId: 'timeout-me', timeoutMs: 5,
    })).rejects.toThrow(/\[llm_timeout\].*timeout-me/)

    const controller = new AbortController()
    controller.abort()
    await expect(client.execute(module.descriptor.id, REQUEST, {
      requestId: 'already-aborted', signal: controller.signal,
    })).rejects.toThrow(/\[cancelled\].*already-aborted/)
    await client.dispose()
  })

  it('drainSource 等待在途任务但保留注册；unregisterSource 阻止新任务并只 dispose 一次', async () => {
    const dispose = vi.fn()
    const abortable = moduleOf(descriptor(), async (_request, context) => await new Promise((_resolve, reject) => {
      context.signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), { once: true })
    }), { dispose })
    const otherDispose = vi.fn()
    const other = moduleOf(descriptor({
      id: 'plugin.other.chat', namespace: 'com.example.other', providerId: 'other', modelId: 'other',
    }), undefined, { dispose: otherDispose })
    const client = createLlmModuleClient({ runtime: runtime(), modules: [abortable, other] })

    const first = client.execute(abortable.descriptor.id, REQUEST, { requestId: 'drain-me' })
    await Promise.resolve()
    await expect(client.drainSource('com.example.fixture')).resolves.toBe(1)
    await expect(first).rejects.toThrow('[cancelled]')
    expect(client.get(abortable.descriptor.id)).toBeDefined()
    expect(dispose).not.toHaveBeenCalled()

    const second = client.execute(abortable.descriptor.id, REQUEST, { requestId: 'unregister-me' })
    await Promise.resolve()
    await expect(client.unregisterSource('com.example.fixture')).resolves.toBe(1)
    await expect(second).rejects.toThrow('[cancelled]')
    expect(client.get(abortable.descriptor.id)).toBeUndefined()
    expect(dispose).toHaveBeenCalledOnce()
    expect(otherDispose).not.toHaveBeenCalled()
    await client.dispose()
    expect(dispose).toHaveBeenCalledOnce()
    expect(otherDispose).toHaveBeenCalledOnce()
  })

  it('module ID 与 provider/model 坐标拒绝覆盖，内置 Groq 冲突列出双方来源', async () => {
    const builtin = createGroqLlmModule()
    const duplicateId = moduleOf(descriptor({
      id: builtin.descriptor.id,
      namespace: 'com.example.shadow-id',
      providerId: 'shadow',
      modelId: 'shadow',
    }))
    const shadowGroq = moduleOf(descriptor({
      id: 'plugin.shadow.groq',
      namespace: 'com.example.shadow-groq',
      providerId: GROQ_DEFAULT_MODEL_CONFIG.providerId,
      modelId: GROQ_DEFAULT_MODEL_CONFIG.modelId,
    }))
    const client = createLlmModuleClient({ runtime: runtime(), modules: [builtin] })

    expect(() => client.register(duplicateId)).toThrow(
      /groq\.chat\.openai\/gpt-oss-20b.*com\.example\.shadow-id.*@henjicc\/ai-sdk/
    )
    expect(() => client.register(shadowGroq)).toThrow(
      /groq\/openai\/gpt-oss-20b.*com\.example\.shadow-groq.*groq\.chat.*@henjicc\/ai-sdk/
    )
    expect(client.list()).toEqual([builtin.descriptor])
    await client.dispose()
  })

  it('Groq 内置 module 复用现有 SSE/usage 内核并同时支持非流式与流式呈现', async () => {
    const fetch = vi.fn(async () => new Response([
      'data: {"choices":[{"delta":{"reasoning":"think","content":"answer"},"finish_reason":"stop"}]}',
      '',
      'data: {"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3},"choices":[]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')))
    const groqRuntime: RuntimeContext = {
      transport: { fetch },
      credentials: { get: async (scope, providerId) => (
        scope === 'llm' && providerId === 'groq' ? 'credential-placeholder' : undefined
      ) },
      media: { read: async () => { throw new Error('Groq module fixture does not read media') } },
    }
    const client = createLlmModuleClient({ runtime: groqRuntime, modules: [createGroqLlmModule()] })
    const events: LlmModuleEvent[] = []
    const outcome = await client.execute('groq.chat.openai/gpt-oss-20b', REQUEST, {
      requestId: 'groq-module-stream', mode: 'event-stream', onEvent: (event) => { events.push(event) },
    })
    expect(fetch.mock.calls[0]?.[0]).toBe(`${GROQ_BASE_URL}/chat/completions`)
    expect(outcome).toMatchObject({
      output: 'answer', reasoningOutput: 'think', finishReason: 'stop',
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    })
    expect(events.map((event) => event.type)).toEqual([
      'ReasoningToken', 'Token', 'Usage', 'Finish', 'Done',
    ])

    fetch.mockImplementationOnce(async () => new Response([
      'data: {"choices":[{"delta":{"content":"silent-stream"},"finish_reason":"stop"}]}',
      '', 'data: [DONE]', '',
    ].join('\n')))
    const nonStreamingEvents: LlmModuleEvent[] = []
    await expect(client.execute('groq.chat.openai/gpt-oss-20b', REQUEST, {
      requestId: 'groq-module-complete', mode: 'request-response',
      onEvent: (event) => { nonStreamingEvents.push(event) },
    })).resolves.toMatchObject({ output: 'silent-stream' })
    expect(nonStreamingEvents.map((event) => event.type)).toEqual(['Finish', 'Done'])
    await client.dispose()
  })

  it('descriptor 注册快照不可被插件事后篡改，非法能力与重复模式立即变红', async () => {
    const mutable = descriptor()
    const client = createLlmModuleClient({ runtime: runtime() })
    const handle = client.register(moduleOf(mutable))
    mutable.id = 'mutated'
    mutable.source.namespace = 'mutated.source'
    mutable.capabilities.image = false
    mutable.executionModes.push('request-response')
    expect(handle.descriptor).toMatchObject({
      id: 'plugin.fixture.chat',
      source: { namespace: 'com.example.fixture' },
      capabilities: { image: true },
      executionModes: ['request-response', 'event-stream'],
    })

    const invalid = descriptor({ id: 'invalid.module', providerId: 'invalid', modelId: 'invalid' })
    invalid.executionModes = ['event-stream', 'event-stream']
    expect(() => client.register(moduleOf(invalid))).toThrow(/execution mode is duplicated/)
    const falseStreaming = descriptor({ id: 'invalid.streaming', providerId: 'invalid', modelId: 'streaming' })
    falseStreaming.capabilities.streaming = false
    expect(() => client.register(moduleOf(falseStreaming))).toThrow(/event-stream.*streaming is false/)
    await client.dispose()
  })

  it('动态模型发现复用同一 Abort/timeout/资源边界并拒绝重复模型', async () => {
    const discover = vi.fn<NonNullable<LlmModule['discover']>>(async () => [{
      modelId: 'fixture-model', displayName: 'Fixture', contextWindow: 8_192, maxOutputTokens: 2_048,
    }])
    const module = moduleOf(descriptor(), undefined, { discover })
    const client = createLlmModuleClient({ runtime: runtime(), modules: [module] })
    await expect(client.discover(module.descriptor.id, { requestId: 'discover-models' })).resolves.toEqual([{
      modelId: 'fixture-model', displayName: 'Fixture', contextWindow: 8_192, maxOutputTokens: 2_048,
    }])

    await client.unregister(module.descriptor.id)
    client.register(moduleOf(descriptor(), undefined, {
      discover: async () => [
        { modelId: 'same', displayName: 'Same', contextWindow: null, maxOutputTokens: null },
        { modelId: 'same', displayName: 'Same 2', contextWindow: null, maxOutputTokens: null },
      ],
    }))
    await expect(client.discover(module.descriptor.id)).rejects.toThrow(/duplicate modelId: same/)

    await client.unregister(module.descriptor.id)
    client.register(moduleOf(descriptor(), undefined, {
      discover: async (context) => await new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), { once: true })
      }),
    }))
    await expect(client.discover(module.descriptor.id, { timeoutMs: 5 }))
      .rejects.toThrow('[llm_timeout]')
    await client.dispose()
  })

  it('统一 discovery 接收 LLM module，并拒绝与内置 Groq 模型的同坐标覆盖', () => {
    const plugin = defineLlmModuleDescriptor(descriptor({
      id: 'plugin.shadow.groq', namespace: 'com.example.shadow-groq',
      providerId: 'groq', modelId: 'openai/gpt-oss-20b',
    }))
    expect(() => createModelCapabilityDiscovery({
      llmModels: [GROQ_DEFAULT_MODEL_CONFIG], llmModules: [plugin],
    })).toThrow(/capability_discovery_id_conflict.*plugin source.*LLM module.*llm-model/)

    const discovery = createModelCapabilityDiscovery({ llmModules: [plugin] })
    expect(discovery.search({ providerIds: 'groq', operations: 'chat' })).toMatchObject([{
      id: 'groq:openai/gpt-oss-20b', sourceKind: 'llm-module',
      profile: { acceptedInputContentKinds: ['text', 'image', 'audio'] },
    }])
  })
})
