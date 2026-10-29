import type { OperationRecord } from '../services/application-runtime/operationStore'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  record: undefined as OperationRecord | undefined,
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  generate: vi.fn(),
  continuePolling: vi.fn(),
  consumePendingResult: vi.fn(),
  recoverSavedGenerationResult: vi.fn(),
  llmChatStream: vi.fn(),
  llmModelStep: vi.fn(),
  testProviderConnection: vi.fn(),
  resolveContainerGeneratedFolder: vi.fn(),
}))

vi.mock('@henjicc/ai-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@henjicc/ai-sdk')>(),
  testProviderConnection: mocks.testProviderConnection,
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
      mocks.handlers.set(channel, handler)
    },
  },
}))

vi.mock('../services/application-runtime/runtime', () => ({ getApplicationRuntime: () => ({ operations: { store: { get: () => mocks.record, save: (record: OperationRecord) => { mocks.record = record } } } }) }))

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
  recoverSavedGenerationResult: mocks.recoverSavedGenerationResult,
}))

vi.mock('../services/documents/runtime', () => ({
  resolveContainerGeneratedFolder: mocks.resolveContainerGeneratedFolder,
}))
vi.mock('../services/logging', () => ({ createMainLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

vi.mock('../services/ai-runtime/pending-results', () => ({
  consumePendingResult: mocks.consumePendingResult,
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
import { registerLogSecret } from '../../../src/core/logging/sanitize'

interface TestSender {
  send: ReturnType<typeof vi.fn>
}

function handler(channel: string) {
  const registered = mocks.handlers.get(channel)
  if (!registered) throw new Error(`Missing handler: ${channel}`)
  return registered
}

beforeEach(() => {
  mocks.record = { operationId: '00000000-0000-4000-8000-000000000001', callerId: '00000000-0000-4000-8000-000000000002', capabilityId: 'create_visible_generation_task', state: 'completed', input: {}, inputDigest: '', approval: { decision: 'auto', reason: '额度内' }, paidReservations: [{ category: 'generation', estimatedCny: 1, reservedAt: Date.now(), generationTaskIds: ['request-a', 'r1', 'r3'], approval: { decision: 'auto', reason: '额度内' } }] }
  mocks.handlers.clear()
  vi.clearAllMocks()
  registerAiRuntimeIpc()
  registerLlmRuntimeIpc()
})

describe('AI/LLM IPC 契约', () => {
  it('连接测试和聊天流只替换已登记密钥，业务文本与包络保持原样', async () => {
    const key = 'opaque-provider-echo-value'
    registerLogSecret(key, 'ipc-fixture')
    mocks.testProviderConnection.mockResolvedValueOnce({ ok: false, message: `rejected ${key}; password=ordinary` })
    const sender = { send: vi.fn() }
    await expect(handler('ai:testProviderConnection')({ sender }, { providerId: 'test' })).resolves.toEqual({ ok: true, data: { ok: false, message: 'rejected ***; password=ordinary' } })
    mocks.llmChatStream.mockImplementationOnce(async (_request, emit) => emit({ type: 'Error', data: `rejected ${key}; token=ordinary` }))
    await handler('llm:chatStream')({ sender }, { streamId: 'stream-id', request: { providerId: 'test', modelId: 'test', messages: [] } })
    expect(sender.send).toHaveBeenCalledWith('llm:chatStream:event', { streamId: 'stream-id', event: { type: 'Error', data: 'rejected ***; token=ordinary' } })
  })

  it('聊天流跨 delta 脱敏，普通未匹配尾段在终态之前释放', async () => {
    const key = 'opaque-chat-split-credential'
    registerLogSecret(key, 'chat-split-fixture')
    const sender = { send: vi.fn() }
    mocks.llmChatStream.mockImplementationOnce(async (_request, emit) => {
      emit({ type: 'Token', data: 'hello opaque-chat-' })
      emit({ type: 'ReasoningToken', data: 'opaque-chat-split-' })
      emit({ type: 'Token', data: 'split-credential' })
      emit({ type: 'ReasoningToken', data: 'credential' })
      emit({ type: 'Token', data: ' opaque-chat-' })
      emit({ type: 'Done', data: {} })
    })
    await handler('llm:chatStream')({ sender }, { streamId: key, request: { providerId: 'test', modelId: 'test', messages: [] } })
    const payloads = sender.send.mock.calls.map(call => call[1] as { streamId: string; event: { type: string; data: string } })
    expect(payloads.every(payload => payload.streamId === key)).toBe(true)
    expect(payloads.filter(payload => payload.event.type === 'Token').map(payload => payload.event.data).join('')).toBe('hello *** opaque-chat-')
    expect(payloads.filter(payload => payload.event.type === 'ReasoningToken').map(payload => payload.event.data).join('')).toBe('***')
    expect(payloads.at(-1)?.event.type).toBe('Done')
  })
  it('ai:generate 与 ai:continuePolling 的 payload/返回字段保持不变', async () => {
    const generateResponse = {
      status: 'completed',
      url: 'https://example.com/a.png',
      filePath: '/managed/a.png',
      createdFilePaths: ['/managed/a.png'],
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
      paidReceipt: { operationId: '00000000-0000-4000-8000-000000000001', callerId: '00000000-0000-4000-8000-000000000002' },
      modelId: 'model-a',
      params: { prompt: 'hello' },
      requestId: 'request-a',
    })).resolves.toEqual({ ok: true, data: generateResponse })
    expect(mocks.generate).toHaveBeenCalledWith({
      modelId: 'model-a',
      params: { prompt: 'hello' },
      requestId: 'request-a',
    }, {})

    const pollingResponse = {
      ...generateResponse,
      trace: { ...generateResponse.trace, phase: 'continuePolling' },
    }
    mocks.continuePolling.mockResolvedValueOnce(pollingResponse)
    await expect(handler('ai:continuePolling')(event, {
      modelId: 'model-a',
      taskId: 'server-task',
      params: { prompt: 'hello' },
      requestId: 'request-a',
    })).resolves.toEqual({ ok: true, data: pollingResponse })
    expect(mocks.continuePolling).toHaveBeenCalledWith({
      modelId: 'model-a',
      taskId: 'server-task',
      params: { prompt: 'hello' },
      requestId: 'request-a',
    }, {})
  })

  it('画布所在项目的“生成结果”由宿主解析后交给运行时，不进 SDK 请求；项目找不到时回落作品目录', async () => {
    const event = { sender: { send: vi.fn() } }
    mocks.generate.mockResolvedValue({ status: 'completed', url: 'u' })
    mocks.continuePolling.mockResolvedValue({ status: 'completed', url: 'u' })
    mocks.resolveContainerGeneratedFolder.mockResolvedValueOnce('/work/项目/海报/生成结果')
    await handler('ai:generate')(event, { modelId: 'model-a', params: {}, requestId: 'r1', paidReceipt: { operationId: '00000000-0000-4000-8000-000000000001', callerId: '00000000-0000-4000-8000-000000000002' }, outputContainer: { kind: 'project', projectId: 'proj_1' } })
    expect(mocks.resolveContainerGeneratedFolder).toHaveBeenCalledWith({ kind: 'project', projectId: 'proj_1' })
    expect(mocks.generate).toHaveBeenLastCalledWith({ modelId: 'model-a', params: {}, requestId: 'r1' }, { outputDirectory: '/work/项目/海报/生成结果' })
    mocks.resolveContainerGeneratedFolder.mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'ProjectNotFoundError' }))
    await handler('ai:continuePolling')(event, { modelId: 'model-a', taskId: 't', requestId: 'r2', outputContainer: { kind: 'project', projectId: 'gone' } })
    expect(mocks.continuePolling).toHaveBeenLastCalledWith({ modelId: 'model-a', taskId: 't', params: undefined, requestId: 'r2' }, {})
    // 作品目录本身不用解析
    mocks.resolveContainerGeneratedFolder.mockClear()
    await handler('ai:generate')(event, { modelId: 'model-a', params: {}, requestId: 'r3', paidReceipt: { operationId: '00000000-0000-4000-8000-000000000001', callerId: '00000000-0000-4000-8000-000000000002' }, outputContainer: { kind: 'user' } })
    expect(mocks.resolveContainerGeneratedFolder).not.toHaveBeenCalled()
    await expect(handler('ai:generate')(event, { modelId: 'model-a', params: {}, outputContainer: { kind: 'project' } })).resolves.toMatchObject({ ok: false })
  })

  it('ai:consumePendingResult 保留缓存结果的新建文件所有权', async () => {
    const cached = {
      url: 'https://example.com/cached.png',
      filePath: '/managed/cached.png',
      createdFilePaths: ['/managed/cached.png'],
      metadata: { seed: 9 },
    }
    mocks.consumePendingResult.mockReturnValue(cached)

    await expect(handler('ai:consumePendingResult')(
      { sender: { send: vi.fn() } },
      { serverTaskId: 'server-task' },
    )).resolves.toEqual({ ok: true, data: cached })
    expect(mocks.consumePendingResult).toHaveBeenCalledWith('server-task')
  })

  it('ai:consumePendingResult 优先返回已落库回执，不回落到内存缓存', async () => {
    const persisted = {
      url: 'https://example.com/persisted.png',
      filePath: '/managed/persisted.png',
      createdFilePaths: ['/managed/persisted.png'],
      status: 'completed',
    }
    mocks.recoverSavedGenerationResult.mockResolvedValue(persisted)
    mocks.consumePendingResult.mockReturnValue({ url: 'https://example.com/cached.png' })

    await expect(handler('ai:consumePendingResult')(
      { sender: { send: vi.fn() } },
      { serverTaskId: 'server-task' },
    )).resolves.toEqual({ ok: true, data: persisted })
    expect(mocks.recoverSavedGenerationResult).toHaveBeenCalledWith('server-task')
    expect(mocks.consumePendingResult).not.toHaveBeenCalled()
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
    const echoedKey = 'opaque-model-step-credential'
    registerLogSecret(echoedKey, 'model-step-fixture')
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
      text: `完成 ${echoedKey}`,
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
      emit({ type: 'TextDelta', text: `完成 ${echoedKey.slice(0, 15)}` })
      emit({ type: 'TextDelta', text: echoedKey.slice(15) })
      emit({ type: 'ReasoningDelta', text: echoedKey.slice(0, 15) })
      emit({ type: 'ReasoningDelta', text: echoedKey.slice(15) })
      return result
    })
    const sender: TestSender = { send: vi.fn() }

    await expect(handler('llm:modelStep')({ sender }, {
      streamId: 'model-step-stream',
      input,
    })).resolves.toEqual({ ok: true, data: { ...result, text: '完成 ***' } })
    expect(mocks.llmModelStep).toHaveBeenCalledWith(input, expect.any(Function))
    expect(sender.send).toHaveBeenCalledWith('llm:modelStep:event', {
      streamId: 'model-step-stream',
      event: { type: 'TextDelta', text: '***' },
    })
    expect(sender.send).toHaveBeenCalledWith('llm:modelStep:event', { streamId: 'model-step-stream', event: { type: 'ReasoningDelta', text: '***' } })
  })
})
