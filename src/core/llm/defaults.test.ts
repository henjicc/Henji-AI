import { describe, expect, it } from 'vitest'
import { createDefaultLlmConfig } from './defaults'

describe('默认 DeepSeek 选型', () => {
  it('内置官方渠道只推荐新版，助手默认引用可用的视觉模型', () => {
    const config = createDefaultLlmConfig()
    const models = config.models.filter(model => model.providerId === 'deepseek')
    expect(models.map(model => model.modelId)).toEqual(['deepseek-flash'])
    expect(models[0]).toMatchObject({
      apiProtocol: 'openai-responses',
      capabilities: { image: true, toolCall: true, contextWindow: 1_000_000 },
    })
    expect(config.agentProfiles[0].primary).toEqual({ providerId: 'deepseek', modelId: 'deepseek-flash' })
    expect(config.models.find(model => model.modelId === 'deepseek/deepseek-v4-flash')?.capabilities.image).toBe(false)
  })
})
