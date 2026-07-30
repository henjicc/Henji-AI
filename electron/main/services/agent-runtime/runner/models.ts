import {
  isAgentModelStaticallyCapable,
  isAgentModelVerified,
  resolveAgentRoleReference,
  selectAgentExecutionModel,
} from '../../../../../src/core/llm/agentProfiles'
import type { AgentStartRunRequest, AgentRuntimeModelConfig } from '../../../../../src/core/assistant/runtimeContracts'
import type { ModelStepCapabilities } from '../../../../../src/core/llm/modelStep'
import type { LlmApiProtocol } from '../../../../../src/core/llm/providerProtocol'

export interface AgentRuntimeModel {
  providerId: string
  modelId: string
  adapter: string
  apiProtocol?: LlmApiProtocol
  baseUrl?: string
  capabilities: ModelStepCapabilities
  pricing?: AgentRuntimeModelConfig['pricing']
  reasoning?: {
    enabled: boolean
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  }
  limits: {
    contextWindow: number
    contextWindowSource: 'model' | 'profile_fallback'
  }
  settings: {
    timeoutMs: number
    maxRetries: number
    maxOutputTokens: number
    temperature?: number
  }
}

function findModel(
  models: AgentRuntimeModelConfig[],
  reference: { providerId: string; modelId: string }
): AgentRuntimeModelConfig | undefined {
  return models.find((model) => model.providerId === reference.providerId && model.modelId === reference.modelId)
}

function toRuntimeModel(request: AgentStartRunRequest, model: AgentRuntimeModelConfig): AgentRuntimeModel {
  const modelContextWindow = model.capabilities.contextWindow
  return {
    providerId: model.providerId,
    modelId: model.modelId,
    adapter: model.adapter,
    apiProtocol: model.apiProtocol ?? 'openai-compatible',
    baseUrl: model.baseUrl,
    capabilities: {
      streaming: model.capabilities.streaming,
      toolCall: model.capabilities.toolCall,
      parallelTools: model.capabilities.parallelTools,
      structuredOutputMode: model.capabilities.structuredOutputMode,
      reasoning: model.capabilities.reasoning,
      sampling: model.capabilities.sampling,
      usage: model.capabilities.usage,
    },
    pricing: model.pricing,
    reasoning: model.reasoning,
    limits: {
      contextWindow: modelContextWindow ?? request.profile.settings.contextWindowBudget,
      contextWindowSource: modelContextWindow === null ? 'profile_fallback' : 'model',
    },
    settings: {
      timeoutMs: request.profile.settings.timeoutMs,
      maxRetries: request.profile.settings.maxRetries,
      maxOutputTokens: Math.min(
        request.profile.settings.maxOutputTokens,
        model.capabilities.maxOutputTokens ?? request.profile.settings.maxOutputTokens
      ),
      temperature: request.profile.settings.temperature,
    },
  }
}

export interface AgentRuntimeModelSet {
  primary: AgentRuntimeModel
  router: AgentRuntimeModel
  summarizer: AgentRuntimeModel
  fellBack: boolean
}

function selectOptionalRole(
  request: AgentStartRunRequest,
  role: 'router' | 'summarizer',
  fallback: AgentRuntimeModel
): AgentRuntimeModel {
  const reference = resolveAgentRoleReference(request.profile, role)
  if (!reference) return fallback
  const model = findModel(request.models, reference)
  if (!model || !isAgentModelStaticallyCapable(model) || !isAgentModelVerified(request.profile, reference)) return fallback
  return toRuntimeModel(request, model)
}

export function selectAgentRuntimeModels(request: AgentStartRunRequest): AgentRuntimeModelSet {
  const selected = selectAgentExecutionModel(request.profile, request.models)
  const selectedModel = findModel(request.models, selected.reference)
  if (!selectedModel) throw new Error('[agent_model_unavailable] 已选择的智能助手模型不存在')
  const primary = toRuntimeModel(request, selectedModel)
  return {
    primary,
    router: selectOptionalRole(request, 'router', primary),
    summarizer: selectOptionalRole(request, 'summarizer', primary),
    fellBack: selected.fellBack,
  }
}
