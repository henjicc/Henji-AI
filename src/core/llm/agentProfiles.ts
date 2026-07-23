import type {
  AgentModelCapabilityVerification,
  AgentModelProfile,
  AgentModelReference,
  AgentModelRole,
  LlmModelConfig,
} from './types'

const REQUIRED_PRIMARY_CHECKS = ['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel'] as const

function isSameModel(left: AgentModelReference, right: AgentModelReference): boolean {
  return left.providerId === right.providerId && left.modelId === right.modelId
}

export function resolveAgentRoleReference(profile: AgentModelProfile, role: AgentModelRole): AgentModelReference | undefined {
  if (role === 'primary') return profile.primary
  if (role === 'router') return profile.router ?? profile.primary
  if (role === 'summarizer') return profile.summarizer ?? profile.primary
  return profile.fallback
}

export function findAgentModelVerification(
  profile: AgentModelProfile,
  reference: AgentModelReference
): AgentModelCapabilityVerification | undefined {
  return profile.verifications.find(verification => isSameModel(verification, reference))
}

export function isAgentModelVerified(
  profile: AgentModelProfile,
  reference: AgentModelReference
): boolean {
  const verification = findAgentModelVerification(profile, reference)
  if (!verification) return false
  return REQUIRED_PRIMARY_CHECKS.every(id => (
    verification.checks.some(check => check.id === id && check.status === 'passed')
  ))
}

export function isAgentModelStaticallyCapable(model: LlmModelConfig | undefined): boolean {
  return model?.enabled === true
    && model.capabilities.text
    && model.capabilities.streaming
    && model.capabilities.toolCall
    && model.capabilities.structuredOutputMode !== 'none'
    && model.capabilities.usage
}

export interface AgentModelSelectionResult {
  reference: AgentModelReference
  role: 'primary' | 'fallback'
  fellBack: boolean
  reason?: string
}

function findModel(models: LlmModelConfig[], reference: AgentModelReference): LlmModelConfig | undefined {
  return models.find(model => isSameModel(model, reference))
}

function canRun(profile: AgentModelProfile, models: LlmModelConfig[], reference: AgentModelReference): boolean {
  return isAgentModelStaticallyCapable(findModel(models, reference)) && isAgentModelVerified(profile, reference)
}

export function selectAgentExecutionModel(
  profile: AgentModelProfile,
  models: LlmModelConfig[]
): AgentModelSelectionResult {
  if (canRun(profile, models, profile.primary)) {
    return { reference: profile.primary, role: 'primary', fellBack: false }
  }
  if (profile.fallback && canRun(profile, models, profile.fallback)) {
    return {
      reference: profile.fallback,
      role: 'fallback',
      fellBack: true,
      reason: '主模型未通过智能助手能力验证，已切换到已验证的备用模型。',
    }
  }
  throw new Error('[agent_model_unavailable] 主模型不支持工具调用或尚未通过能力验证，且没有可用的已验证备用模型；请前往设置 > API 与模型 > 智能助手模型完成配置。')
}
