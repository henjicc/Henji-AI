import {
  isAgentModelStaticallyCapable,
  isAgentModelVerified,
  resolveAgentRoleReference,
  selectAgentExecutionModel,
} from '../../../../../src/core/llm/agentProfiles'
import type { AgentStartRunRequest, AgentRuntimeModelConfig } from '../../../../../src/core/assistant/runtimeContracts'
import type { ModelStepCapabilities } from '../../../../../src/core/llm/modelStep'
import type { AgentInputModality } from '../../../../../src/core/llm/agentProfiles'
import type { LlmApiProtocol } from '../../../../../src/core/llm/providerProtocol'

const DEFAULT_AGENT_PROFILE_ID = 'default-agent'

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
      image: model.capabilities.image,
      video: model.capabilities.video,
      audio: model.capabilities.audio,
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
      maxRetries: request.profile.id === DEFAULT_AGENT_PROFILE_ID
        ? 3
        : request.profile.settings.maxRetries,
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
  observer?: AgentRuntimeModel
  fellBack: boolean
}

export function canObserveApplicationSurface(models: AgentRuntimeModelSet): boolean {
  return (['image', 'video', 'audio'] as const).some((modality) => (
    models.primary.capabilities[modality] || models.observer?.capabilities[modality] === true
  ))
}

function selectObserver(request: AgentStartRunRequest): AgentRuntimeModel | undefined {
  const reference = resolveAgentRoleReference(request.profile, 'observer')
  if (!reference) return undefined
  const model = findModel(request.models, reference)
  return model?.enabled ? toRuntimeModel(request, model) : undefined
}

export function selectAgentObservationRuntimeModel(
  models: AgentRuntimeModelSet,
  modality: AgentInputModality
): { model: AgentRuntimeModel; role: 'primary' | 'observer' } {
  if (models.primary.capabilities[modality]) return { model: models.primary, role: 'primary' }
  if (models.observer?.capabilities[modality]) return { model: models.observer, role: 'observer' }
  throw new Error(`[agent_input_modality_unavailable] 当前执行模型不支持 ${modality}，且没有配置支持该模态的观察模型`)
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
    observer: selectObserver(request),
    fellBack: selected.fellBack,
  }
}
