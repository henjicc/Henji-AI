import { describe, expect, it } from 'vitest'

import { AGENT_RUNTIME_SCHEMA_VERSION, type AgentStartRunRequest } from '../../../../../src/core/assistant/runtimeContracts'
import { canObserveApplicationSurface, selectAgentObservationRuntimeModel, selectAgentRuntimeModels } from './models'

function request(contextWindow: number | null): AgentStartRunRequest {
  const now = new Date().toISOString()
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    threadId: 'thread-model-limits',
    goal: '检查模型限制',
    approvalMode: 'assistant_decides',
    profile: {
      id: 'profile',
      name: '测试档案',
      primary: { providerId: 'provider', modelId: 'model' },
      settings: {
        timeoutMs: 30_000,
        maxRetries: 0,
        maxOutputTokens: 500_000,
        contextWindowBudget: 64_000,
      },
      verifications: [{
        providerId: 'provider',
        modelId: 'model',
        adapterVersion: 'test',
        verifiedAt: now,
        checks: ['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel'].map(id => ({
          id: id as 'text' | 'toolCall' | 'structuredOutput' | 'streaming' | 'usage' | 'cancel',
          status: 'passed' as const,
          latencyMs: 1,
        })),
        totalLatencyMs: 6,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 2,
        },
        cost: { status: 'unknown' },
      }],
      createdAt: now,
      updatedAt: now,
    },
    models: [{
      providerId: 'provider',
      modelId: 'model',
      displayName: '模型',
      adapter: 'openai',
      capabilities: {
        text: true,
        image: false,
        video: false,
        audio: false,
        streaming: true,
        toolCall: true,
        parallelTools: false,
        jsonOutput: true,
        structuredOutputMode: 'json',
        reasoning: true,
        sampling: true,
        contextWindow,
        maxOutputTokens: 384_000,
        usage: true,
      },
      enabled: true,
    }],
  }
}

describe('selectAgentRuntimeModels', () => {
  it('优先使用模型级上下文并限制单次输出', () => {
    const model = selectAgentRuntimeModels(request(1_000_000)).primary
    expect(model.limits).toEqual({ contextWindow: 1_000_000, contextWindowSource: 'model' })
    expect(model.settings.maxOutputTokens).toBe(384_000)
  })

  it('模型上下文未知时使用档案回退值', () => {
    expect(selectAgentRuntimeModels(request(null)).primary.limits).toEqual({
      contextWindow: 64_000,
      contextWindowSource: 'profile_fallback',
    })
  })

  it('辅助角色即使回退到主模型也使用短超时、零重试并关闭推理', () => {
    const input = request(1_000_000)
    input.profile.settings.timeoutMs = 60_000
    input.profile.settings.maxRetries = 2
    const models = selectAgentRuntimeModels(input)
    expect(models.primary.settings).toMatchObject({ timeoutMs: 60_000, maxRetries: 2 })
    expect(models.router.settings).toMatchObject({ timeoutMs: 12_000, maxRetries: 0, maxOutputTokens: 4_096 })
    expect(models.summarizer.settings).toMatchObject({ timeoutMs: 12_000, maxRetries: 0, maxOutputTokens: 4_096 })
    expect(models.router.reasoning).toMatchObject({ enabled: false, effort: 'low' })
  })

  it('观察模型可独立声明图片能力且不继承主模型验证要求', () => {
    const input = request(null)
    const observer = {
      ...input.models[0],
      modelId: 'observer',
      capabilities: { ...input.models[0].capabilities, image: true },
    }
    input.profile.observer = { providerId: observer.providerId, modelId: observer.modelId }
    input.models.push(observer)
    const models = selectAgentRuntimeModels(input)
    expect(models.observer?.modelId).toBe('observer')
    expect(selectAgentObservationRuntimeModel(models, 'image')).toMatchObject({ role: 'observer' })
    expect(() => selectAgentObservationRuntimeModel(models, 'video')).toThrow('[agent_input_modality_unavailable]')
  })
})

describe('canObserveApplicationSurface', () => {
  it('主模型或观察模型支持图片时开放视觉观察', () => {
    const primary = selectAgentRuntimeModels(request(1_000_000))
    expect(canObserveApplicationSurface(primary)).toBe(primary.primary.capabilities.image)
    expect(canObserveApplicationSurface({
      ...primary,
      primary: { ...primary.primary, capabilities: { ...primary.primary.capabilities, image: false } },
      observer: { ...primary.primary, capabilities: { ...primary.primary.capabilities, image: true } },
    })).toBe(true)
    expect(canObserveApplicationSurface({
      ...primary,
      primary: { ...primary.primary, capabilities: { ...primary.primary.capabilities, image: false } },
      observer: undefined,
    })).toBe(false)
  })
})
