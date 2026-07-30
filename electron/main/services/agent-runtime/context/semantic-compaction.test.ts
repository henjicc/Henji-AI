import { describe, expect, it, vi } from 'vitest'

import type { ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import { isContextOverflowError, runSemanticCompaction } from './semantic-compaction'

const model = {
  providerId: 'provider', modelId: 'summarizer', adapter: 'openai-compatible',
  capabilities: {
    streaming: true, toolCall: true, parallelTools: false,
    structuredOutputMode: 'json' as const, reasoning: false, sampling: true, usage: true,
  },
  limits: { contextWindow: 8_000, contextWindowSource: 'profile_fallback' as const },
  settings: { timeoutMs: 5_000, maxRetries: 0, maxOutputTokens: 1_000 },
}

function result(input: ModelStepInput, goal: string): ModelStepResult {
  return {
    requestId: input.requestId, runId: input.runId, stepId: input.stepId,
    providerId: input.providerId, modelId: input.modelId,
    text: '', reasoningText: '',
    structuredOutput: {
      version: 'agent-semantic-summary/v2',
      goal,
      constraints: ['始终使用中文'],
      progress: { done: [], inProgress: ['持续会话'], blocked: [] },
      keyDecisions: ['采用线性会话'],
      nextSteps: ['确认是否继续'],
      criticalContext: ['用户讨论持续会话'],
    },
    toolCalls: [], responseMessages: [], finishReason: 'stop',
    usage: {
      inputTokens: 100, inputNoCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0,
      outputTokens: 20, textTokens: 20, reasoningTokens: 0, totalTokens: 120,
    },
    providerMetadataSummary: {}, warnings: [], elapsedMs: 1,
  }
}

describe('runSemanticCompaction', () => {
  it('通过正式 summarizer ModelStep 产生结构化摘要和 usage', async () => {
    const runModelStep = vi.fn(async (input: ModelStepInput) => result(input, '完成持续会话'))
    const compacted = await runSemanticCompaction({
      runId: 'run-1', turn: 2, model,
      history: [{ role: 'user', content: '请始终使用中文' }],
      runModelStep, signal: new AbortController().signal,
    })

    expect(compacted.summary.constraints).toContain('始终使用中文')
    expect(compacted.usage.totalTokens).toBe(120)
    expect(runModelStep.mock.calls[0]?.[0].trace).toEqual({ kind: 'summarizer', turn: 2 })
  })

  it('拒绝把不可验证的工具完成声明提升为语义事实', async () => {
    const runModelStep = vi.fn(async (input: ModelStepInput) => result(input, '工具已完成写入'))
    await expect(runSemanticCompaction({
      runId: 'run-unsafe', turn: 1, model,
      history: [{ role: 'assistant', content: '我可能做完了' }],
      runModelStep, signal: new AbortController().signal,
    })).rejects.toThrow('SEMANTIC_SUMMARY_EXECUTION_CLAIM')
  })

  it('优先使用结构化错误字段识别 overflow，并保留兼容兜底', () => {
    expect(isContextOverflowError({ category: 'context_overflow' })).toBe(true)
    expect(isContextOverflowError({ code: 'CONTEXT_LENGTH_EXCEEDED' })).toBe(true)
    expect(isContextOverflowError(new Error('maximum context length exceeded'))).toBe(true)
    expect(isContextOverflowError(new Error('network unavailable'))).toBe(false)
  })
})
