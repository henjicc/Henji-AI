import { describe, expect, it, vi } from 'vitest'

import type { AgentRunState } from '../../../../../src/core/assistant/events'
import { AGENT_RUNTIME_SCHEMA_VERSION, type AgentStartRunRequest } from '../../../../../src/core/assistant/runtimeContracts'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import { AgentToolGateway } from '../tools/gateway'
import { AgentToolRegistry } from '../tools/registry'
import { AgentRunner } from './runner'

function hostContext(): HostContextSnapshot {
  return {
    schemaVersion: 'agent-contract/v2', rendererSessionId: 'renderer-1', revision: 1,
    scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: null, selectedNodeId: null }, generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null }, uiReady: true,
    availableCapabilities: [], capturedAt: new Date().toISOString(),
  }
}

function request(contextWindow = 8_000): AgentStartRunRequest {
  const now = new Date().toISOString()
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION, threadId: 'thread-1', goal: '继续处理历史任务',
    approvalMode: 'ask',
    profile: {
      id: 'profile', name: '测试', primary: { providerId: 'provider', modelId: 'model' },
      summarizer: { providerId: 'provider', modelId: 'model' },
      settings: { timeoutMs: 5_000, maxRetries: 0, maxOutputTokens: 1_000, contextWindowBudget: contextWindow },
      verifications: [{
        providerId: 'provider', modelId: 'model', adapterVersion: 'test', verifiedAt: now,
        checks: ['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel'].map((id) => ({
          id: id as 'text' | 'toolCall' | 'structuredOutput' | 'streaming' | 'usage' | 'cancel',
          status: 'passed' as const, latencyMs: 1,
        })),
        totalLatencyMs: 6,
        usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2 },
        cost: { status: 'unknown' },
      }],
      createdAt: now, updatedAt: now,
    },
    models: [{
      providerId: 'provider', modelId: 'model', displayName: '模型', adapter: 'openai-compatible', enabled: true,
      capabilities: {
        text: true, image: false, video: false, audio: false,
        streaming: true, toolCall: true, parallelTools: false, jsonOutput: true,
        structuredOutputMode: 'json', reasoning: false, sampling: true,
        contextWindow, maxOutputTokens: 1_000, usage: true,
      },
    }],
  }
}

function result(input: ModelStepInput, overrides: Partial<ModelStepResult> = {}): ModelStepResult {
  return {
    requestId: input.requestId, runId: input.runId, stepId: input.stepId,
    providerId: input.providerId, modelId: input.modelId, text: '已完成', reasoningText: '',
    structuredOutput: null, toolCalls: [], responseMessages: [{ role: 'assistant', content: '已完成' }],
    finishReason: 'stop',
    usage: {
      inputTokens: 20, inputNoCacheTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0,
      outputTokens: 2, textTokens: 2, reasoningTokens: 0, totalTokens: 22,
    },
    providerMetadataSummary: {}, warnings: [], elapsedMs: 1, ...overrides,
  }
}

function routerResult(input: ModelStepInput): ModelStepResult {
  return result(input, {
    text: '', structuredOutput: {
      intent: 'general', candidateIntents: ['general'], toolDomains: ['catalog'],
      complexity: 'simple', reason: '持续对话',
    }, responseMessages: [{ role: 'assistant', content: '' }],
  })
}

function summaryResult(input: ModelStepInput): ModelStepResult {
  return result(input, {
    text: '', structuredOutput: {
      version: 'agent-semantic-summary/v2',
      goal: '继续历史任务',
      constraints: ['使用中文'],
      progress: { done: [], inProgress: ['继续历史任务'], blocked: [] },
      keyDecisions: ['保留线性会话'],
      nextSteps: ['确认下一步'],
      criticalContext: ['历史已压缩'],
    }, responseMessages: [],
  })
}

function runtime() {
  const registry = new AgentToolRegistry()
  return {
    registry,
    gateway: new AgentToolGateway({
      registry, getHostContext: hostContext, appendPermissionAudit: async () => undefined,
    }),
  }
}

describe('AgentRunner 语义压缩与 overflow 恢复', () => {
  it('上下文超预算时真实调用 summarizer、保存 compaction 并继续主模型', async () => {
    const { registry, gateway } = runtime()
    const appendSessionCompaction = vi.fn(async () => undefined)
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      if (input.stepId.startsWith('router:')) return routerResult(input)
      if (input.stepId.startsWith('summarizer:')) return summaryResult(input)
      expect(JSON.stringify(input.messages)).toContain('SESSION_SEMANTIC_SUMMARY')
      return result(input)
    })
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const history = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `${index}:${'中文约束'.repeat(250)}`,
    }))
    new AgentRunner({
      runId: 'run-compaction', request: request(16_000), conversationHistory: history,
      conversationHistorySequences: history.map((_, index) => index + 1),
      dependencies: {
        registry, gateway, getHostContext: hostContext, runModelStep,
        cancelModelStep: vi.fn(), appendSessionCompaction, onTerminal: terminalResolve,
      },
    }).start()

    await expect(terminal).resolves.toMatchObject({ status: 'completed' })
    expect(runModelStep.mock.calls.filter(([input]) => input.stepId.startsWith('summarizer:'))).toHaveLength(1)
    expect(appendSessionCompaction).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-1',
      payload: expect.objectContaining({ coveredThroughSequence: expect.any(Number) }),
    }))
  })

  it('Provider overflow 只压缩重试一次且使用独立 retry stepId', async () => {
    const { registry, gateway } = runtime()
    let primaryCalls = 0
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      if (input.stepId.startsWith('router:')) return routerResult(input)
      if (input.stepId.startsWith('summarizer:')) return summaryResult(input)
      primaryCalls += 1
      if (primaryCalls === 1) throw Object.assign(new Error('overflow'), { category: 'context_overflow' })
      return result(input)
    })
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const history = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `短消息-${index}`,
    }))
    new AgentRunner({
      runId: 'run-overflow', request: request(32_000), conversationHistory: history,
      conversationHistorySequences: history.map((_, index) => index + 1),
      dependencies: {
        registry, gateway, getHostContext: hostContext, runModelStep,
        cancelModelStep: vi.fn(), appendSessionCompaction: async () => undefined,
        onTerminal: terminalResolve,
      },
    }).start()

    await expect(terminal).resolves.toMatchObject({ status: 'completed' })
    expect(primaryCalls).toBe(2)
    expect(runModelStep.mock.calls.some(([input]) => input.stepId === 'step-1-overflow-retry')).toBe(true)
  })

  it('summarizer 返回无效结果时退回确定性压缩并继续运行', async () => {
    const { registry, gateway } = runtime()
    const appendSessionCompaction = vi.fn(async () => undefined)
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      if (input.stepId.startsWith('router:')) return routerResult(input)
      if (input.stepId.startsWith('summarizer:')) {
        return result(input, { text: '非结构化摘要', structuredOutput: null, responseMessages: [] })
      }
      return result(input)
    })
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const history = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `${index}:${'中文历史'.repeat(250)}`,
    }))
    new AgentRunner({
      runId: 'run-compaction-fallback', request: request(16_000), conversationHistory: history,
      conversationHistorySequences: history.map((_, index) => index + 1),
      dependencies: {
        registry, gateway, getHostContext: hostContext, runModelStep,
        cancelModelStep: vi.fn(), appendSessionCompaction, onTerminal: terminalResolve,
      },
    }).start()

    await expect(terminal).resolves.toMatchObject({ status: 'completed' })
    expect(appendSessionCompaction).not.toHaveBeenCalled()
    expect(runModelStep.mock.calls.filter(([input]) => input.stepId.startsWith('summarizer:'))).toHaveLength(1)
  })

  it('压缩后再次 overflow 直接结构化失败，不进入下一轮循环', async () => {
    const { registry, gateway } = runtime()
    let primaryCalls = 0
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      if (input.stepId.startsWith('router:')) return routerResult(input)
      if (input.stepId.startsWith('summarizer:')) return summaryResult(input)
      primaryCalls += 1
      throw Object.assign(new Error('overflow'), { category: 'context_overflow' })
    })
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    const history = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `短消息-${index}`,
    }))
    new AgentRunner({
      runId: 'run-overflow-twice', request: request(32_000), conversationHistory: history,
      conversationHistorySequences: history.map((_, index) => index + 1),
      dependencies: {
        registry, gateway, getHostContext: hostContext, runModelStep,
        cancelModelStep: vi.fn(), appendSessionCompaction: async () => undefined,
        onTerminal: terminalResolve,
      },
    }).start()

    await expect(terminal).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'CONTEXT_OVERFLOW_AFTER_COMPACTION' },
    })
    expect(primaryCalls).toBe(2)
  })
})
