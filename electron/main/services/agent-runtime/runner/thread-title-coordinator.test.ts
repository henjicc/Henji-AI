import { describe, expect, it } from 'vitest'

import type {
  AgentThreadTitleContext,
  AgentThreadTitleUpdate,
} from '../../../../../src/core/assistant/threadTitle'
import type { ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import type { AgentRuntimeModel } from './models'
import {
  AgentThreadTitleCoordinator,
  normalizeGeneratedThreadTitle,
} from './thread-title-coordinator'

const model: AgentRuntimeModel = {
  providerId: 'provider',
  modelId: 'summarizer',
  adapter: 'openai-compatible',
  capabilities: {
    image: false,
    video: false,
    audio: false,
    streaming: true,
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: false,
    sampling: true,
    usage: true,
  },
  limits: {
    contextWindow: 32_000,
    contextWindowSource: 'model',
  },
  settings: {
    timeoutMs: 5_000,
    maxRetries: 0,
    maxOutputTokens: 1_000,
  },
}

function result(input: ModelStepInput, title: string): ModelStepResult {
  return {
    requestId: input.requestId,
    runId: input.runId,
    stepId: input.stepId,
    providerId: input.providerId,
    modelId: input.modelId,
    text: '',
    reasoningText: '',
    structuredOutput: { title },
    toolCalls: [],
    responseMessages: [],
    finishReason: 'stop',
    usage: {
      inputTokens: 20,
      inputNoCacheTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 6,
      textTokens: 6,
      reasoningTokens: 0,
      totalTokens: 26,
    },
    providerMetadataSummary: {},
    warnings: [],
    elapsedMs: 10,
  }
}

function context(
  generationStage: AgentThreadTitleContext['generationStage'],
  userInstructions: string[]
): AgentThreadTitleContext {
  return {
    threadId: 'thread-1',
    currentTitle: '原始标题',
    generationStage,
    userMessageCount: userInstructions.length,
    userInstructions,
  }
}

describe('AgentThreadTitleCoordinator', () => {
  it('首条指令生成初始标题', async () => {
    const updates: AgentThreadTitleUpdate[] = []
    const coordinator = new AgentThreadTitleCoordinator({
      runId: 'run-1',
      threadId: 'thread-1',
      model,
      runModelStep: async (input) => result(input, '  “优化助手历史记录。”  '),
      getContext: async () => context(0, ['优化助手历史记录']),
      updateTitle: async (input) => {
        updates.push(input)
        return { updated: true, title: input.title, generationStage: input.nextStage }
      },
    })

    await coordinator.refresh()

    expect(updates).toEqual([expect.objectContaining({
      title: '优化助手历史记录',
      expectedStage: 0,
      nextStage: 1,
    })])
  })

  it('第 3 条用户指令后精炼标题，第 2 条时不重复生成', async () => {
    let modelCalls = 0
    const updates: AgentThreadTitleUpdate[] = []
    const createCoordinator = (
      titleContext: AgentThreadTitleContext
    ): AgentThreadTitleCoordinator => new AgentThreadTitleCoordinator({
      runId: 'run-2',
      threadId: 'thread-1',
      model,
      runModelStep: async (input) => {
        modelCalls += 1
        return result(input, '智能助手历史与标题优化')
      },
      getContext: async () => titleContext,
      updateTitle: async (input) => {
        updates.push(input)
        return { updated: true, title: input.title, generationStage: input.nextStage }
      },
    })

    await createCoordinator(context(1, ['第一条', '第二条'])).refresh()
    await createCoordinator(context(1, ['第一条', '第二条', '第三条'])).refresh()

    expect(modelCalls).toBe(1)
    expect(updates).toEqual([expect.objectContaining({
      expectedStage: 1,
      nextStage: 2,
    })])
  })

  it('清理模型返回的引号、标记、换行和句末标点', () => {
    expect(normalizeGeneratedThreadTitle('  ## “助手\n界面优化。”  '))
      .toBe('助手 界面优化')
  })
})
