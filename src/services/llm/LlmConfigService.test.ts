import { describe, expect, it } from 'vitest'

import {
  DEEPSEEK_V4_CONTEXT_WINDOW,
  DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
  DEFAULT_AGENT_PROFILE_ID,
} from '@/core/llm/defaults'
import type { LlmConfigState } from '@/core/llm/types'
import { normalizeLlmConfig } from './LlmConfigService'

describe('normalizeLlmConfig', () => {
  it('迁移旧配置并补齐 Agent Profile 与扩展能力', () => {
    const legacy = {
      providers: [{ providerId: 'custom', displayName: 'Custom', adapter: 'openai', enabled: true }],
      models: [{
        providerId: 'custom',
        modelId: 'legacy-model',
        displayName: 'Legacy',
        adapter: 'openai',
        capabilities: { text: true, image: false, video: false, audio: false, streaming: true, toolCall: true, jsonOutput: true },
        enabled: true,
      }],
    } as unknown as Partial<LlmConfigState>

    const config = normalizeLlmConfig(legacy)
    const model = config.models.find(item => item.providerId === 'custom' && item.modelId === 'legacy-model')
    expect(config.selectedAgentProfileId).toBe(DEFAULT_AGENT_PROFILE_ID)
    expect(config.agentProfiles).toHaveLength(1)
    expect(model?.capabilities).toMatchObject({
      toolCall: true,
      parallelTools: false,
      structuredOutputMode: 'json',
      sampling: true,
      usage: true,
    })
    expect(config.providers.find((item) => item.providerId === 'custom')?.apiProtocol)
      .toBe('openai-compatible')
    expect(model?.apiProtocol).toBe('openai-compatible')
    expect(config.textProcessingPromptTemplates.length).toBeGreaterThan(0)
  })

  it('无效的模型档案选择会回退到首个档案', () => {
    const defaults = normalizeLlmConfig(null)
    const config = normalizeLlmConfig({ ...defaults, selectedAgentProfileId: 'missing' })
    expect(config.selectedAgentProfileId).toBe(config.agentProfiles[0].id)
  })

  it('保留独立观察模型并兼容没有 observer 的旧档案', () => {
    const defaults = normalizeLlmConfig(null)
    const base = defaults.agentProfiles[0]
    const observer = { providerId: defaults.models[0].providerId, modelId: defaults.models[0].modelId }
    const configured = normalizeLlmConfig({
      ...defaults,
      agentProfiles: [{ ...base, observer }],
    })
    expect(configured.agentProfiles[0].observer).toEqual(observer)
    const legacy = normalizeLlmConfig({ ...defaults, agentProfiles: [{ ...base, observer: undefined }] })
    expect(legacy.agentProfiles[0].observer).toBeUndefined()
  })

  it('为存量 DeepSeek V4 配置迁移模型固有上下文能力', () => {
    const defaults = normalizeLlmConfig(null)
    const config = normalizeLlmConfig({
      ...defaults,
      models: defaults.models.map(model => (
        model.modelId.includes('deepseek-v4')
          ? {
              ...model,
              capabilities: { ...model.capabilities, contextWindow: null, maxOutputTokens: null },
            }
          : model
      )),
    })
    const deepSeekModels = config.models.filter(model => model.modelId.includes('deepseek-v4'))
    expect(deepSeekModels).toHaveLength(4)
    expect(deepSeekModels.every(model => (
      model.capabilities.contextWindow === DEEPSEEK_V4_CONTEXT_WINDOW
      && model.capabilities.maxOutputTokens === DEEPSEEK_V4_MAX_OUTPUT_TOKENS
    ))).toBe(true)
  })

  it('保留用户明确清空的文本处理模板，并过滤无名称模板', () => {
    const defaults = normalizeLlmConfig(null)
    expect(normalizeLlmConfig({
      ...defaults,
      textProcessingPromptTemplates: [],
    }).textProcessingPromptTemplates).toEqual([])

    const config = normalizeLlmConfig({
      ...defaults,
      textProcessingPromptTemplates: [
        { ...defaults.textProcessingPromptTemplates[0], name: '  我的模板  ' },
        { ...defaults.textProcessingPromptTemplates[1], name: '   ' },
      ],
    })
    expect(config.textProcessingPromptTemplates).toHaveLength(1)
    expect(config.textProcessingPromptTemplates[0].name).toBe('我的模板')
  })
})
