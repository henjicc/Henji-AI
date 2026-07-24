import type {
  LlmCapabilities,
  AgentModelProfile,
  LlmConfigState,
  LlmModelConfig,
  LlmProviderConfig,
  LlmReasoningConfig,
  LlmReasoningEffort,
  PromptOptimizationProfile,
} from './types'
import {
  normalizePromptOptimizationProfileDocuments,
} from './promptOptimization'

export const DEFAULT_DEEPSEEK_PROVIDER_ID = 'deepseek'
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_DEEPSEEK_MODEL_ID = 'deepseek-v4-flash'
export const DEFAULT_PPIO_PROVIDER_ID = 'ppio'
export const DEFAULT_PPIO_BASE_URL = 'https://api.ppio.com/openai'
export const DEFAULT_PPIO_MODEL_ID = 'deepseek/deepseek-v4-flash'
export const DEFAULT_LLM_REASONING_EFFORT: LlmReasoningEffort = 'high'
export const DEEPSEEK_V4_CONTEXT_WINDOW = 1_000_000
export const DEEPSEEK_V4_MAX_OUTPUT_TOKENS = 384_000

export const DEFAULT_LLM_CAPABILITIES: LlmCapabilities = {
  text: true,
  image: false,
  video: false,
  audio: false,
  streaming: true,
  toolCall: false,
  parallelTools: false,
  jsonOutput: false,
  structuredOutputMode: 'none',
  reasoning: false,
  sampling: true,
  contextWindow: null,
  maxOutputTokens: null,
  usage: true,
}

function createDeepSeekV4Capabilities(): LlmCapabilities {
  return {
    ...DEFAULT_LLM_CAPABILITIES,
    contextWindow: DEEPSEEK_V4_CONTEXT_WINDOW,
    maxOutputTokens: DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
  }
}

export const DEFAULT_PROMPT_PROFILE_ID = 'default-general-optimizer'
export const DEFAULT_AGENT_PROFILE_ID = 'default-agent'

export function createDefaultAgentModelProfile(now = new Date().toISOString()): AgentModelProfile {
  return {
    id: DEFAULT_AGENT_PROFILE_ID,
    name: '默认智能助手',
    primary: { providerId: DEFAULT_PPIO_PROVIDER_ID, modelId: DEFAULT_PPIO_MODEL_ID },
    settings: {
      timeoutMs: 60_000,
      maxRetries: 1,
      maxOutputTokens: 4_096,
      contextWindowBudget: 64_000,
    },
    verifications: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createDefaultProviderReasoning(adapter = ''): LlmReasoningConfig {
  return {
    enabled: adapter.trim().toLowerCase() === DEFAULT_DEEPSEEK_PROVIDER_ID,
    effort: DEFAULT_LLM_REASONING_EFFORT,
  }
}

export function createDefaultPromptProfile(now = new Date().toISOString()): PromptOptimizationProfile {
  return normalizePromptOptimizationProfileDocuments({
    id: DEFAULT_PROMPT_PROFILE_ID,
    name: '通用提示词优化',
    providerId: DEFAULT_PPIO_PROVIDER_ID,
    modelId: DEFAULT_PPIO_MODEL_ID,
    systemPrompt: [
      '你是面向图像、视频和音频生成工作流的提示词优化助手。',
      '保留用户原意，补足主体、场景、风格、镜头、光线、构图和质量描述。',
      '只输出优化后的提示词，不要解释，不要添加标题。'
    ].join('\n'),
    userTemplate: '请优化以下提示词，使其更适合生成模型使用：\n\n{{prompt}}',
    capabilities: {
      text: true,
      image: false,
      video: false,
    },
    isDefault: true,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  })
}

export function createBuiltInLlmProviders(): LlmProviderConfig[] {
  return [
    {
      providerId: DEFAULT_PPIO_PROVIDER_ID,
      displayName: '派欧云',
      adapter: 'openai',
      baseUrl: DEFAULT_PPIO_BASE_URL,
      reasoning: createDefaultProviderReasoning('openai'),
      reasoningConfigurable: false,
      enabled: true,
    },
    {
      providerId: DEFAULT_DEEPSEEK_PROVIDER_ID,
      displayName: 'DeepSeek',
      adapter: 'deepseek',
      baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
      reasoning: createDefaultProviderReasoning(DEFAULT_DEEPSEEK_PROVIDER_ID),
      reasoningConfigurable: true,
      enabled: true,
    },
  ]
}

export function createBuiltInLlmModels(): LlmModelConfig[] {
  return [
    {
      providerId: DEFAULT_PPIO_PROVIDER_ID,
      modelId: 'deepseek/deepseek-v4-pro',
      displayName: 'DeepSeek V4 Pro',
      adapter: 'openai',
      baseUrl: DEFAULT_PPIO_BASE_URL,
      capabilities: createDeepSeekV4Capabilities(),
      enabled: true,
    },
    {
      providerId: DEFAULT_PPIO_PROVIDER_ID,
      modelId: DEFAULT_PPIO_MODEL_ID,
      displayName: 'DeepSeek V4 Flash',
      adapter: 'openai',
      baseUrl: DEFAULT_PPIO_BASE_URL,
      capabilities: createDeepSeekV4Capabilities(),
      enabled: true,
    },
    {
      providerId: DEFAULT_PPIO_PROVIDER_ID,
      modelId: 'xiaomimimo/mimo-v2.5-pro',
      displayName: 'MiMo-V2.5-Pro',
      adapter: 'openai',
      baseUrl: DEFAULT_PPIO_BASE_URL,
      capabilities: DEFAULT_LLM_CAPABILITIES,
      enabled: true,
    },
    {
      providerId: DEFAULT_PPIO_PROVIDER_ID,
      modelId: 'moonshotai/kimi-k2.6',
      displayName: 'Kimi K2.6',
      adapter: 'openai',
      baseUrl: DEFAULT_PPIO_BASE_URL,
      capabilities: {
        ...DEFAULT_LLM_CAPABILITIES,
        image: true,
        video: true,
      },
      enabled: true,
    },
    {
      providerId: DEFAULT_DEEPSEEK_PROVIDER_ID,
      modelId: DEFAULT_DEEPSEEK_MODEL_ID,
      displayName: 'DeepSeek V4 Flash',
      adapter: 'deepseek',
      baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
      capabilities: createDeepSeekV4Capabilities(),
      enabled: true,
    },
    {
      providerId: DEFAULT_DEEPSEEK_PROVIDER_ID,
      modelId: 'deepseek-v4-pro',
      displayName: 'DeepSeek V4 Pro',
      adapter: 'deepseek',
      baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
      capabilities: createDeepSeekV4Capabilities(),
      enabled: true,
    },
  ]
}

export function createDefaultLlmConfig(): LlmConfigState {
  const profile = createDefaultPromptProfile()
  const agentProfile = createDefaultAgentModelProfile()
  return {
    providers: createBuiltInLlmProviders(),
    models: createBuiltInLlmModels(),
    promptProfiles: [profile],
    selectedPromptProfileId: profile.id,
    agentProfiles: [agentProfile],
    selectedAgentProfileId: agentProfile.id,
    tools: [],
    policy: {
      allowedTools: [],
      requireHumanConfirmation: false,
    },
    memory: {},
  }
}
