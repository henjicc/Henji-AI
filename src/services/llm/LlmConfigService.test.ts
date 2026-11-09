import { describe, expect, it } from 'vitest'

import {
  DEEPSEEK_V4_CONTEXT_WINDOW,
  DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
  DEFAULT_AGENT_PROFILE_ID,
  createDefaultPromptProfile,
  createDefaultTextProcessingPromptTemplates,
} from '@/core/llm/defaults'
import type { LlmConfigState } from '@henjicc/ai-sdk'
import { normalizeLlmConfig } from './LlmConfigService'

describe('normalizeLlmConfig', () => {
  it('智能优化总在最前、规则固定，只保留用户改过的模型与思考设置', () => {
    const now = new Date().toISOString()
    const tampered = normalizeLlmConfig({
      promptProfiles: [
        { ...createDefaultPromptProfile(now), isDefault: false },
        { id: 'smart-prompt-optimizer', name: '被改名', providerId: 'deepseek', modelId: 'deepseek-v4-flash', systemPrompt: '自己写的规则', userTemplate: '{{prompt}}', capabilities: { text: true, image: false, video: false }, reasoning: { enabled: false, effort: 'low' }, isDefault: true, enabled: false, createdAt: now, updatedAt: now },
      ],
    } as Partial<LlmConfigState>)
    expect(tampered.promptProfiles[0]).toMatchObject({ id: 'smart-prompt-optimizer', name: '智能优化', systemPrompt: createDefaultPromptProfile(now).systemPrompt, enabled: true, providerId: 'deepseek', modelId: 'deepseek-v4-flash', reasoning: { enabled: false } })
    expect(normalizeLlmConfig({ promptProfiles: [createDefaultPromptProfile(now)] } as Partial<LlmConfigState>).promptProfiles.map(profile => profile.id))
      .toEqual(['smart-prompt-optimizer', 'default-general-optimizer'])
  })

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
    expect(config.providers[0]).toMatchObject({
      providerFamilyId: 'custom',
      credentialId: 'custom',
      setup: { kind: 'custom' },
    })
  })

  it('明确清空供应商后不会在保存时复活内置项', () => {
    const defaults = normalizeLlmConfig(null)
    const cleared = normalizeLlmConfig({ ...defaults, providers: [], models: [] })
    expect(cleared.providers).toEqual([])
    expect(cleared.models).toEqual([])
  })

  it('派欧云下线的内置模型换成接替者并保留启用状态，已有接替者时只删旧条目', () => {
    const defaults = normalizeLlmConfig(null)
    const kimi = defaults.models.find(model => model.modelId === 'moonshotai/kimi-k3')!
    const mimo = defaults.models.find(model => model.modelId === 'xiaomimimo/mimo-v2.6-pro')!
    const others = defaults.models.filter(model => model !== kimi && model !== mimo)
    const stored = [
      ...others,
      { ...kimi, modelId: 'moonshotai/kimi-k2.6', displayName: 'Kimi K2.6', enabled: false },
      { ...mimo, modelId: 'xiaomimimo/mimo-v2.5-pro', displayName: 'MiMo-V2.5-Pro' },
      mimo,
    ]
    const models = normalizeLlmConfig({ ...defaults, models: stored }).models
    expect(models.filter(model => model.providerId === 'ppio').map(model => model.modelId).sort())
      .toEqual(defaults.models.filter(model => model.providerId === 'ppio').map(model => model.modelId).sort())
    expect(models.find(model => model.modelId === 'moonshotai/kimi-k3')?.enabled).toBe(false)
  })

  it('只把官方地址上的存量 PPIO 识别成不可删除的内置 preset', () => {
    const official = normalizeLlmConfig({
      providers: [{
        providerId: 'ppio', displayName: 'PPIO', adapter: 'openai',
        baseUrl: 'https://api.ppio.com/openai', enabled: true,
      }],
      models: [],
    } as unknown as Partial<LlmConfigState>)
    expect(official.providers[0]).toMatchObject({
      credentialId: 'ppio',
      setup: { kind: 'preset', presetId: 'ppio', lifecycle: 'builtin' },
    })

    const custom = normalizeLlmConfig({
      providers: [{
        providerId: 'ppio', displayName: 'Private PPIO Proxy', adapter: 'openai',
        baseUrl: 'https://proxy.example.com/v1', enabled: true,
      }],
      models: [],
    } as unknown as Partial<LlmConfigState>)
    expect(custom.providers[0].setup).toEqual({ kind: 'custom' })
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

  it('为官方 Flash 和聚合渠道 V4 配置补齐模型固有上下文能力', () => {
    const defaults = normalizeLlmConfig(null)
    const config = normalizeLlmConfig({
      ...defaults,
      models: defaults.models.map(model => (
        model.providerId === 'deepseek' || model.modelId.includes('deepseek-v4')
          ? {
              ...model,
              capabilities: { ...model.capabilities, contextWindow: null, maxOutputTokens: null },
            }
          : model
      )),
    })
    const deepSeekModels = config.models.filter(model => model.providerId === 'deepseek' || model.modelId.includes('deepseek-v4'))
    expect(deepSeekModels.map(model => [model.providerId, model.modelId])).toEqual([
      ['ppio', 'deepseek/deepseek-v4-pro'],
      ['ppio', 'deepseek/deepseek-v4.1-flash'],
      ['deepseek', 'deepseek-flash'],
    ])
    expect(deepSeekModels.every(model => (
      model.capabilities.contextWindow === DEEPSEEK_V4_CONTEXT_WINDOW
      && model.capabilities.maxOutputTokens === DEEPSEEK_V4_MAX_OUTPUT_TOKENS
    ))).toBe(true)
  })

  it('给存量模型按内置目录补一次能力标注，并盖戳避免重复覆盖', () => {
    const stored = {
      providers: [{ providerId: 'kimi', displayName: 'Kimi', adapter: 'openai', baseUrl: 'https://api.moonshot.cn/v1', enabled: true }],
      models: [{
        providerId: 'kimi',
        modelId: 'kimi-k3',
        displayName: 'Kimi K3',
        adapter: 'openai',
        // 老配置里添加模型时能力项全是关的
        capabilities: { text: true, image: false, video: false, audio: false, streaming: true, toolCall: false, jsonOutput: false },
        enabled: true,
      }],
    } as unknown as Partial<LlmConfigState>

    const migrated = normalizeLlmConfig(stored)
    const model = migrated.models.find(item => item.providerId === 'kimi' && item.modelId === 'kimi-k3')
    expect(model?.catalogId).toBe('kimi-k3')
    expect(model?.capabilities).toMatchObject({ image: true, video: true, toolCall: true, sampling: false })

    // 盖过戳之后，用户手动关掉的能力不能在下一次保存时被目录改回去
    const edited = normalizeLlmConfig({
      ...migrated,
      models: migrated.models.map(item => (
        item.modelId === 'kimi-k3'
          ? { ...item, capabilities: { ...item.capabilities, video: false } }
          : item
      )),
    })
    expect(edited.models.find(item => item.modelId === 'kimi-k3')?.capabilities.video).toBe(false)
  })

  it('把从来没接通过的 anthropic 适配器收敛成 openai', () => {
    const config = normalizeLlmConfig({
      providers: [{ providerId: 'legacy', displayName: 'Legacy', adapter: 'anthropic', baseUrl: 'https://example.com', enabled: true }],
      models: [],
    } as unknown as Partial<LlmConfigState>)
    expect(config.providers.find(item => item.providerId === 'legacy')?.adapter).toBe('openai')
  })

  it('预制模型自动迁移到确认过的首选协议，且不继承存量手工协议', () => {
    const defaults = normalizeLlmConfig(null)
    expect(defaults.models.find(model => (
      model.providerId === 'deepseek' && model.modelId === 'deepseek-flash'
    ))?.apiProtocol).toBe('openai-responses')
    expect(defaults.models.find(model => (
      model.providerId === 'ppio' && model.modelId === 'deepseek/deepseek-v4-pro'
    ))?.apiProtocol).toBe('openai-compatible')

    const legacy = normalizeLlmConfig({
      ...defaults,
      models: defaults.models.map(model => ({ ...model, apiProtocol: 'openai-compatible' })),
    })
    expect(legacy.models.find(model => (
      model.providerId === 'deepseek' && model.modelId === 'deepseek-flash'
    ))?.apiProtocol).toBe('openai-responses')
  })

  it('用户显式覆盖预设连接后，地址与协议应用到该供应商全部模型', () => {
    const defaults = normalizeLlmConfig(null)
    const overridden = normalizeLlmConfig({
      ...defaults,
      providers: defaults.providers.map(provider => provider.providerId === 'deepseek'
        ? {
            ...provider,
            setup: {
              kind: 'preset' as const,
              presetId: 'deepseek',
              lifecycle: 'builtin' as const,
              connectionOverrides: {
                baseUrl: 'https://proxy.example.com/v1',
                apiProtocol: 'openai-compatible' as const,
              },
            },
          }
        : provider),
    })
    expect(overridden.providers.find(provider => provider.providerId === 'deepseek')).toMatchObject({
      baseUrl: 'https://proxy.example.com/v1',
      apiProtocol: 'openai-compatible',
    })
    const models = overridden.models.filter(model => model.providerId === 'deepseek')
    expect(models.every(model => (
      model.baseUrl === 'https://proxy.example.com/v1'
      && model.apiProtocol === 'openai-compatible'
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
      ...defaults.promptProfiles.find((profile) => profile.id === 'default-general-optimizer')!,
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
    const general = (config: typeof defaults) => config.promptProfiles.find((profile) => profile.id === 'default-general-optimizer')!
    expect(general(upgraded).systemPrompt).toBe(general(defaults).systemPrompt)
    expect(general(upgraded).userTemplate).toBe(general(defaults).userTemplate)

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
    expect(general(customized).systemPrompt).toBe('我的自定义优化规则')

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
