import { describe, expect, it } from 'vitest'

import { DEFAULT_LLM_CAPABILITIES } from './defaults'
import {
  applyPromptOptimizationModelSelection,
  listPromptOptimizationModelCandidates,
  selectPromptOptimizationModel,
} from './promptOptimizationModelSelection'
import type { LlmModelConfig, LlmProviderConfig, PromptOptimizationProfile } from '@henjicc/ai-sdk'

function createProvider(providerId: string, enabled = true): LlmProviderConfig {
  return { providerId, displayName: providerId, adapter: 'openai', enabled }
}

function createModel(
  providerId: string,
  modelId: string,
  options: { vision?: boolean; enabled?: boolean } = {},
): LlmModelConfig {
  return {
    providerId,
    modelId,
    displayName: modelId,
    adapter: 'openai',
    capabilities: {
      ...DEFAULT_LLM_CAPABILITIES,
      image: options.vision === true,
      video: options.vision === true,
    },
    enabled: options.enabled !== false,
  }
}

function createProfile(providerId: string, modelId: string): PromptOptimizationProfile {
  return {
    id: 'profile',
    name: '优化配置',
    providerId,
    modelId,
    systemPrompt: '',
    userTemplate: '{{prompt}}',
    capabilities: { text: true, image: false, video: false },
    isDefault: true,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const providers = [createProvider('ppio'), createProvider('deepseek'), createProvider('disabled', false)]
const models = [
  createModel('ppio', 'text-only'),
  createModel('ppio', 'vision', { vision: true }),
  createModel('ppio', 'off', { vision: true, enabled: false }),
  createModel('deepseek', 'deepseek-text'),
  createModel('disabled', 'hidden', { vision: true }),
]

describe('提示词优化的模型选择策略', () => {
  it('只把已启用且供应商已配置密钥的模型算作候选', () => {
    const candidates = listPromptOptimizationModelCandidates({
      providers,
      models,
      configuredProviderIds: ['deepseek'],
    })
    expect(candidates.map(model => model.modelId)).toEqual(['deepseek-text'])
  })

  it('密钥状态未知时不按密钥过滤，但仍排除未启用的供应商与模型', () => {
    const candidates = listPromptOptimizationModelCandidates({ providers, models })
    expect(candidates.map(model => model.modelId)).toEqual(['text-only', 'vision', 'deepseek-text'])
  })

  it('第一个可用模型不支持视觉输入时改选第一个支持视觉输入的模型', () => {
    const model = selectPromptOptimizationModel({ providers, models, configuredProviderIds: ['ppio'] })
    expect(model?.modelId).toBe('vision')
  })

  it('没有支持视觉输入的模型时退回第一个可用模型', () => {
    const model = selectPromptOptimizationModel({ providers, models, configuredProviderIds: ['deepseek'] })
    expect(model?.modelId).toBe('deepseek-text')
  })

  it('一个可用模型都没有时返回 null', () => {
    expect(selectPromptOptimizationModel({ providers, models, configuredProviderIds: [] })).toBeNull()
  })

  it('方案指向的模型仍可用时保持不动，即使它不支持视觉输入', () => {
    const profile = createProfile('ppio', 'text-only')
    const source = { providers, models, configuredProviderIds: ['ppio'] }
    expect(applyPromptOptimizationModelSelection(profile, source)).toBe(profile)
  })

  it('方案指向的模型不可用时按策略补选并同步能力开关', () => {
    const profile = createProfile('ppio', 'removed-model')
    const next = applyPromptOptimizationModelSelection(profile, {
      providers,
      models,
      configuredProviderIds: ['ppio'],
    })
    expect(next.modelId).toBe('vision')
    expect(next.capabilities).toEqual({ text: true, image: true, video: true })
  })

  it('没有可用模型时保持原样，由调用方引导用户去配置', () => {
    const profile = createProfile('', '')
    const source = { providers, models, configuredProviderIds: [] }
    expect(applyPromptOptimizationModelSelection(profile, source)).toBe(profile)
  })
})
