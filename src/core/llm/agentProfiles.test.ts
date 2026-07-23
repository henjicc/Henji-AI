import { describe, expect, it } from 'vitest'

import { createDefaultAgentModelProfile, DEFAULT_LLM_CAPABILITIES } from './defaults'
import { resolveAgentRoleReference, selectAgentExecutionModel } from './agentProfiles'
import type { AgentModelCapabilityVerification, LlmModelConfig } from './types'

function createVerification(providerId: string, modelId: string): AgentModelCapabilityVerification {
  return {
    providerId,
    modelId,
    adapterVersion: 'test',
    verifiedAt: '2026-07-23T00:00:00.000Z',
    checks: ['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel'].map(id => ({
      id: id as AgentModelCapabilityVerification['checks'][number]['id'],
      status: 'passed' as const,
      latencyMs: 1,
    })),
    totalLatencyMs: 6,
    usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2 },
    cost: { status: 'unknown' },
  }
}

function createModel(providerId: string, modelId: string, toolCall = true): LlmModelConfig {
  return {
    providerId,
    modelId,
    displayName: modelId,
    adapter: 'openai',
    capabilities: {
      ...DEFAULT_LLM_CAPABILITIES,
      toolCall,
      jsonOutput: true,
      structuredOutputMode: 'schema',
      usage: true,
    },
    enabled: true,
  }
}

describe('Agent model profile', () => {
  it('router 和 summarizer 未配置时复用 primary', () => {
    const profile = createDefaultAgentModelProfile()
    expect(resolveAgentRoleReference(profile, 'router')).toEqual(profile.primary)
    expect(resolveAgentRoleReference(profile, 'summarizer')).toEqual(profile.primary)
  })

  it('主模型不可用时明确选择已验证 fallback', () => {
    const profile = {
      ...createDefaultAgentModelProfile(),
      primary: { providerId: 'provider', modelId: 'primary' },
      fallback: { providerId: 'provider', modelId: 'fallback' },
      verifications: [createVerification('provider', 'fallback')],
    }
    const result = selectAgentExecutionModel(profile, [
      createModel('provider', 'primary', false),
      createModel('provider', 'fallback'),
    ])
    expect(result).toMatchObject({ role: 'fallback', fellBack: true, reference: profile.fallback })
  })

  it('没有合格模型时给出设置入口而不静默降级', () => {
    const profile = createDefaultAgentModelProfile()
    expect(() => selectAgentExecutionModel(profile, [createModel(profile.primary.providerId, profile.primary.modelId, false)]))
      .toThrow('[agent_model_unavailable]')
  })
})
