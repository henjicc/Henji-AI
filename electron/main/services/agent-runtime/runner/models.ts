import {
  AGENT_MIN_OUTPUT_TOKENS,
  isAgentModelStaticallyCapable,
  isAgentModelVerified,
  resolveAgentRoleReference,
  selectAgentExecutionModel,
} from '../../../../../src/core/llm/agentProfiles'
import type { AgentStartRunRequest, AgentRuntimeModelConfig } from '../../../../../src/core/assistant/runtimeContracts'
import type { ModelStepCapabilities } from '../../../../../src/core/llm/modelStep'
import type { AgentInputModality } from '../../../../../src/core/llm/agentProfiles'
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
      // 档案里的重试次数是用户选择，默认档案也不能静默改成 3 次。
      // 真实运行中一次 60 秒超时因此被放大到 254 秒，且最后仍回退到确定性结果。
      maxRetries: request.profile.settings.maxRetries,
      /*
       * 输出预算取"档案设定与工作下限的较大值"，再被模型真实上限夹住。
       *
       * 4096 是推理模型普及前的老默认值，会随档案一直存下去。而思考模式下思维链本身就计入
       * 输出：实测同一次运行里两轮直接 finishReason=length 被截断，各白烧 30 秒以上，工具参数
       * 写到一半作废。模型明明支持 384k，卡在 4096 纯属历史包袱，不是用户的选择。
       */
      maxOutputTokens: Math.min(
        model.capabilities.maxOutputTokens ?? Number.MAX_SAFE_INTEGER,
        Math.max(request.profile.settings.maxOutputTokens, AGENT_MIN_OUTPUT_TOKENS)
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
  const asUtilityModel = (runtime: AgentRuntimeModel): AgentRuntimeModel => ({
    ...runtime,
    reasoning: runtime.capabilities.reasoning
      ? { enabled: false, effort: 'low' }
      : runtime.reasoning,
    settings: {
      ...runtime.settings,
      timeoutMs: Math.min(runtime.settings.timeoutMs, 12_000),
      maxRetries: 0,
      maxOutputTokens: Math.min(runtime.settings.maxOutputTokens, 4_096),
    },
  })
  const reference = resolveAgentRoleReference(request.profile, role)
  if (!reference) return asUtilityModel(fallback)
  const model = findModel(request.models, reference)
  if (!model || !isAgentModelStaticallyCapable(model) || !isAgentModelVerified(request.profile, reference)) {
    return asUtilityModel(fallback)
  }
  const runtime = toRuntimeModel(request, model)
  // router / summarizer 都是可回退的短任务，不能继承主执行模型的长思考与多次网络重试。
  // 主执行仍完整尊重用户档案；辅助模型失败时由本地确定性路由或摘要回退接管。
  return asUtilityModel(runtime)
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
