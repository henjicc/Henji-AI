export interface AgentModelReferenceLike {
  providerId: string
  modelId: string
}

export interface AgentModelVerificationLike extends AgentModelReferenceLike {
  checks: Array<{ id: string; status: string }>
}

export interface AgentModelProfileLike {
  primary: AgentModelReferenceLike
  router?: AgentModelReferenceLike
  summarizer?: AgentModelReferenceLike
  fallback?: AgentModelReferenceLike
  observer?: AgentModelReferenceLike
  verifications: AgentModelVerificationLike[]
}

export interface AgentModelConfigLike extends AgentModelReferenceLike {
  enabled: boolean
  capabilities: {
    text: boolean
    streaming: boolean
    toolCall: boolean
    structuredOutputMode: 'none' | 'json' | 'schema'
    usage: boolean
    image: boolean
    video: boolean
    audio: boolean
  }
}

export type AgentModelRoleLike = 'primary' | 'router' | 'summarizer' | 'fallback' | 'observer'
export type AgentInputModality = 'image' | 'video' | 'audio'

const REQUIRED_PRIMARY_CHECKS = ['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel'] as const

function isSameModel(left: AgentModelReferenceLike, right: AgentModelReferenceLike): boolean {
  return left.providerId === right.providerId && left.modelId === right.modelId
}

export function resolveAgentRoleReference(profile: AgentModelProfileLike, role: AgentModelRoleLike): AgentModelReferenceLike | undefined {
  if (role === 'primary') return profile.primary
  if (role === 'router') return profile.router ?? profile.primary
  if (role === 'summarizer') return profile.summarizer ?? profile.primary
  if (role === 'fallback') return profile.fallback
  return profile.observer
}

export interface AgentObservationModelSelectionResult {
  reference: AgentModelReferenceLike
  role: 'primary' | 'observer'
  modality: AgentInputModality
}

export function selectAgentObservationModel(
  profile: AgentModelProfileLike,
  models: AgentModelConfigLike[],
  modality: AgentInputModality
): AgentObservationModelSelectionResult {
  const execution = selectAgentExecutionModel(profile, models)
  const primary = findModel(models, execution.reference)
  if (primary?.capabilities[modality]) {
    return { reference: execution.reference, role: 'primary', modality }
  }
  const observer = profile.observer ? findModel(models, profile.observer) : undefined
  if (observer?.enabled && observer.capabilities[modality]) {
    return { reference: profile.observer!, role: 'observer', modality }
  }
  throw new Error(`[agent_input_modality_unavailable] 当前执行模型不支持 ${modality}，且没有配置支持该模态的观察模型`)
}

export function findAgentModelVerification<TProfile extends AgentModelProfileLike>(
  profile: TProfile,
  reference: AgentModelReferenceLike
): TProfile['verifications'][number] | undefined {
  return profile.verifications.find(verification => isSameModel(verification, reference))
}

export function isAgentModelVerified(
  profile: AgentModelProfileLike,
  reference: AgentModelReferenceLike
): boolean {
  const verification = findAgentModelVerification(profile, reference)
  if (!verification) return false
  return REQUIRED_PRIMARY_CHECKS.every(id => (
    verification.checks.some(check => check.id === id && check.status === 'passed')
  ))
}

export function isAgentModelStaticallyCapable(model: AgentModelConfigLike | undefined): boolean {
  return model?.enabled === true
    && model.capabilities.text
    && model.capabilities.streaming
    && model.capabilities.toolCall
    && model.capabilities.structuredOutputMode !== 'none'
    && model.capabilities.usage
}

export interface AgentModelSelectionResult {
  reference: AgentModelReferenceLike
  role: 'primary' | 'fallback'
  fellBack: boolean
  reason?: string
}

function findModel(models: AgentModelConfigLike[], reference: AgentModelReferenceLike): AgentModelConfigLike | undefined {
  return models.find(model => isSameModel(model, reference))
}

function canRun(profile: AgentModelProfileLike, models: AgentModelConfigLike[], reference: AgentModelReferenceLike): boolean {
  return isAgentModelStaticallyCapable(findModel(models, reference)) && isAgentModelVerified(profile, reference)
}

export function selectAgentExecutionModel(
  profile: AgentModelProfileLike,
  models: AgentModelConfigLike[]
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
