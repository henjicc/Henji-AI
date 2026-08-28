import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  generate: vi.fn(),
  continuePolling: vi.fn(),
  llmChatStream: vi.fn(),
  llmModelStep: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
      mocks.handlers.set(channel, handler)
    },
  },
}))

vi.mock('../services/ai-runtime/runtime', () => ({
  cancelRuntimeTask: vi.fn(),
  continuePolling: mocks.continuePolling,
  generate: mocks.generate,
  getEstimate: vi.fn(),
  getProviderKeyStatus: vi.fn(),
  parseJsonObject: (value: unknown, label: string) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`${label} must be an object`)
    }
    return value
  },
  recordSample: vi.fn(),
}))

vi.mock('../services/ai-runtime/pending-results', () => ({
  consumePendingResult: vi.fn(),
}))

vi.mock('../services/ai-runtime/sdk-runtime', () => ({
  sdkRuntimeContext: {},
}))

vi.mock('../services/llm/runtime', () => ({
  cancelLlmRuntimeTask: vi.fn(),
  llmChatStream: mocks.llmChatStream,
  llmModelStep: mocks.llmModelStep,
}))

vi.mock('../services/llm/sdk/capability-smoke', () => ({
  verifyModelCapabilities: vi.fn(),
}))

vi.mock('../../../src/core/llm/capabilitySmoke', () => ({
  modelCapabilitySmokeRequestSchema: { parse: (input: unknown) => input },
}))

import { registerAiRuntimeIpc } from './ai-runtime'
import { registerLlmRuntimeIpc } from './llm-runtime'

interface TestSender {
  send: ReturnType<typeof vi.fn>
}

function handler(channel: string) {
  const registered = mocks.handlers.get(channel)
  if (!registered) throw new Error(`Missing handler: ${channel}`)
  return registered
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  registerAiRuntimeIpc()
  registerLlmRuntimeIpc()
})

describe('AI/LLM IPC 契约', () => {
  it('ai:generate 与 ai:continuePolling 的 payload/返回字段保持不变', async () => {
    const generateResponse = {
      status: 'completed',
      url: 'https://example.com/a.png',
      filePath: '/managed/a.png',
      taskId: 'server-task',
      metadata: { seed: 7 },
      trace: {
        modelId: 'model-a',
        providerId: 'provider-a',
        requestId: 'request-a',
        phase: 'generate',
        route: '/v1/generate',
        method: 'POST',
        taskId: 'server-task',
        requestBody: { prompt: 'hello' },
        responseBody: { seed: 7 },
      },
    }
    mocks.generate.mockResolvedValueOnce(generateResponse)
    const event = { sender: { send: vi.fn() } }

    await expect(handler('ai:generate')(event, {
      modelId: 'model-a',
      params: { prompt: 'hello' },
      requestId: 'request-a',
    })).resolves.toEqual({ ok: true, data: generateResponse })
    expect(mocks.generate).toHaveBeenCalledWith({
      modelId: 'model-a',
      params: { prompt: 'hello' },
      requestId: 'request-a',
    })

    const pollingResponse = {
      ...generateResponse,
      trace: { ...generateResponse.trace, phase: 'continuePolling' },
    }
    mocks.continuePolling.mockResolvedValueOnce(pollingResponse)
    await expect(handler('ai:continuePolling')(event, {
      modelId: 'model-a',
      taskId: 'server-task',
      params: { prompt: 'hello' },
    })).resolves.toEqual({ ok: true, data: pollingResponse })
    expect(mocks.continuePolling).toHaveBeenCalledWith({
      modelId: 'model-a',
      taskId: 'server-task',
      params: { prompt: 'hello' },
    })
  })

  it('llm:chatStream 保留完整 request payload 与 streamId 事件包络', async () => {
    mocks.llmChatStream.mockImplementationOnce(async (_request, emit) => {
      emit({ type: 'Token', data: '完成' })
    })
    const sender: TestSender = { send: vi.fn() }
    const request = {
      requestId: 'chat-request',
      providerId: 'provider-a',
      providerFamilyId: 'provider-family-a',
      endpointProfile: 'global',
      credentialId: 'provider-family-a-global-key',
      modelId: 'model-a',
      adapter: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      reasoning: { enabled: true, effort: 'high' },
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: [{ type: 'text', text: 'hello' }], name: 'tester' },
      ],
      capabilities: { streaming: true },
      tools: [{ type: 'function', name: 'test' }],
      policy: { retry: false },
      memory: { summary: 'memo' },
      metadata: { source: 'contract-test' },
    }

    await expect(handler('llm:chatStream')({ sender }, {
      streamId: 'stream-a',
      request,
    })).resolves.toEqual({ ok: true, data: undefined })
    expect(mocks.llmChatStream).toHaveBeenCalledWith(request, expect.any(Function))
    expect(sender.send).toHaveBeenCalledWith('llm:chatStream:event', {
      streamId: 'stream-a',
      event: { type: 'Token', data: '完成' },
    })
  })

  it('llm:modelStep 保留完整 input、返回结构与 streamId 事件包络', async () => {
    const input = {
      requestId: 'model-step-request',
      runId: 'run-a',
      stepId: 'step-a',
      providerId: 'provider-a',
      modelId: 'model-a',
      adapter: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      messages: [{ role: 'user', content: 'hello' }],
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
      settings: { maxOutputTokens: 100, maxRetries: 0 },
      providerOptions: { providerA: { custom: true } },
    }
    const result = {
      requestId: input.requestId,
      runId: input.runId,
      stepId: input.stepId,
      providerId: input.providerId,
      modelId: input.modelId,
      text: '完成',
      reasoningText: '',
      structuredOutput: null,
      toolCalls: [],
      responseMessages: [{ role: 'assistant', content: '完成' }],
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        inputNoCacheTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1,
        textTokens: 1,
        reasoningTokens: 0,
        totalTokens: 2,
      },
      providerMetadataSummary: {},
      warnings: [],
      elapsedMs: 10,
    }
    mocks.llmModelStep.mockImplementationOnce(async (_input, emit) => {
      emit({ type: 'TextDelta', text: '完成' })
      return result
    })
    const sender: TestSender = { send: vi.fn() }

    await expect(handler('llm:modelStep')({ sender }, {
      streamId: 'model-step-stream',
      input,
    })).resolves.toEqual({ ok: true, data: result })
    expect(mocks.llmModelStep).toHaveBeenCalledWith(input, expect.any(Function))
    expect(sender.send).toHaveBeenCalledWith('llm:modelStep:event', {
      streamId: 'model-step-stream',
      event: { type: 'TextDelta', text: '完成' },
    })
  })
})
