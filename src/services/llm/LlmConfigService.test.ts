import { describe, expect, it } from 'vitest'

import {
  DEEPSEEK_V4_CONTEXT_WINDOW,
  DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
  DEFAULT_AGENT_PROFILE_ID,
  createDefaultPromptProfile,
  createDefaultTextProcessingPromptTemplates,
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

  it('保存时不改写提示词优化方案选择的供应商与模型', () => {
    const defaults = normalizeLlmConfig(null)
    const config = normalizeLlmConfig({
      ...defaults,
      promptProfiles: defaults.promptProfiles.map(profile => ({
        ...profile,
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
      })),
    })
    expect(config.promptProfiles[0].providerId).toBe('deepseek')
    expect(config.promptProfiles[0].modelId).toBe('deepseek-v4-flash')
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

  it('升级内置提示词模板并保留用户已修改的内容', () => {
    const defaults = normalizeLlmConfig(null)
    const legacyTemplates = createDefaultTextProcessingPromptTemplates()
      .filter((template) => template.id !== 'text-processing-wallpaper-optimizer')
      .map((template) => ({
        ...template,
        systemPrompt: template.id === 'text-processing-general-optimizer'
          ? '你是提示词优化助手。请在不改变用户原意的前提下，补充必要细节并改善结构与表达。\n只输出优化后的提示词，不要解释，不要添加标题或前后缀。'
          : template.id === 'text-processing-image-optimizer'
            ? '你是图像生成提示词优化助手。保留用户原意，补足主体、场景、风格、构图、镜头、光线与画面质量描述。\n只输出优化后的提示词，不要解释，不要添加标题或前后缀。'
            : '你是视频生成提示词优化助手。保留用户原意，补足主体动作、场景变化、镜头运动、节奏、光线与时间连续性。\n只输出优化后的提示词，不要解释，不要添加标题或前后缀。',
      }))
    const legacyProfile = {
      ...defaults.promptProfiles[0],
      systemPrompt: '你是面向图像、视频和音频生成工作流的提示词优化助手。\n保留用户原意，补足主体、场景、风格、镜头、光线、构图和质量描述。\n只输出优化后的提示词，不要解释，不要添加标题。',
      systemPromptDocument: undefined,
      userTemplate: '请优化以下提示词，使其更适合生成模型使用：\n\n{{prompt}}',
      userTemplateDocument: undefined,
    }

    const upgraded = normalizeLlmConfig({
      ...defaults,
      textProcessingPromptTemplates: legacyTemplates,
      promptProfiles: [legacyProfile],
    })

    expect(upgraded.textProcessingPromptTemplates).toHaveLength(4)
    expect(upgraded.textProcessingPromptTemplates.map((template) => template.id)).toEqual([
      'text-processing-general-optimizer',
      'text-processing-image-optimizer',
      'text-processing-video-optimizer',
      'text-processing-wallpaper-optimizer',
    ])
    expect(upgraded.textProcessingPromptTemplates[1].systemPrompt)
      .toBe(defaults.textProcessingPromptTemplates[1].systemPrompt)
    expect(upgraded.promptProfiles[0].systemPrompt).toBe(defaults.promptProfiles[0].systemPrompt)
    expect(upgraded.promptProfiles[0].userTemplate).toBe(defaults.promptProfiles[0].userTemplate)

    const customized = normalizeLlmConfig({
      ...defaults,
      textProcessingPromptTemplates: legacyTemplates.map((template) => (
        template.id === 'text-processing-image-optimizer'
          ? { ...template, systemPrompt: '我的自定义图像规则' }
          : template
      )),
      promptProfiles: [{
        ...legacyProfile,
        systemPrompt: '我的自定义优化规则',
      }],
    })
    expect(customized.textProcessingPromptTemplates.find((template) => template.id === 'text-processing-image-optimizer')?.systemPrompt)
      .toBe('我的自定义图像规则')
    expect(customized.promptProfiles[0].systemPrompt).toBe('我的自定义优化规则')

    const wallpaperRemoved = normalizeLlmConfig({
      ...defaults,
      textProcessingPromptTemplates: defaults.textProcessingPromptTemplates
        .filter((template) => template.id !== 'text-processing-wallpaper-optimizer'),
    })
    expect(wallpaperRemoved.textProcessingPromptTemplates).toHaveLength(3)
  })

  it('默认生成页优化配置会补充目标模型上下文', () => {
    const profile = createDefaultPromptProfile()
    expect(profile.userTemplate).toContain('{{target.model.type}}')
    expect(profile.userTemplate).toContain('{{media.summary}}')
    expect(profile.systemPrompt).toContain('图像任务')
    expect(profile.systemPrompt).toContain('视频任务')
  })

  it('内置节点模板包含从模糊输入到完整结果的执行链', () => {
    const templates = new Map(
      createDefaultTextProcessingPromptTemplates().map((template) => [template.id, template.systemPrompt]),
    )
    const general = templates.get('text-processing-general-optimizer') ?? ''
    const image = templates.get('text-processing-image-optimizer') ?? ''
    const video = templates.get('text-processing-video-optimizer') ?? ''
    const wallpaper = templates.get('text-processing-wallpaper-optimizer') ?? ''

    expect(general.length).toBeGreaterThan(600)
    expect(general).toContain('自由度')
    expect(general).toContain('最低完整度')

    expect(image.length).toBeGreaterThan(2_000)
    expect(image).toContain('冲突消解')
    expect(image).toContain('前景、中景、远景')
    expect(image).toContain('抽象词转译')
    expect(image).toContain('输出前自检')
    expect(image).toContain('<bbox>')

    expect(video.length).toBeGreaterThan(1_500)
    expect(video).toContain('简单输入的处理')
    expect(video).toContain('一个镜头最多一种主要运镜')
    expect(video).toContain('编辑与延长')
    expect(video).toContain('输出前自检')

    expect(wallpaper.length).toBeGreaterThan(3_000)
    expect(wallpaper).toContain('创作自由度')
    expect(wallpaper).toContain('只选一个美学体系')
    expect(wallpaper).toContain('壁纸版式')
    expect(wallpaper).toContain('抽象词必须视觉化')
    expect(wallpaper).toContain('250 至 450 个汉字')
    expect(wallpaper).toContain('输出前自检')
  })
})
