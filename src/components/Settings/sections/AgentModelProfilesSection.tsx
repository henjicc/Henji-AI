import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'

import { llmVerifyModelCapabilities } from '@/commands/llmRuntime'
import { Dropdown, UiButton, UiInput, UiPanel } from '@/components/ui'
import { findAgentModelVerification } from '@/core/llm/agentProfiles'
import { createLogger } from '@/core/logging'
import type {
  AgentModelProfile,
  AgentModelReference,
  AgentModelRole,
  LlmConfigState,
  LlmModelConfig,
} from '@/core/llm/types'

const logger = createLogger('components.Settings.AgentModelProfilesSection')
const REUSE_PRIMARY = '__reuse_primary__'
const NO_FALLBACK = '__no_fallback__'

interface AgentModelProfilesSectionProps {
  config: LlmConfigState
  saveConfig: (config: LlmConfigState) => Promise<void>
}

interface ModelOption {
  value: string
  label: string
  reference?: AgentModelReference
}

const roleLabels: Record<AgentModelRole, string> = {
  primary: '主模型',
  router: '路由模型',
  summarizer: '摘要模型',
  fallback: '备用模型',
}

function modelKey(reference: AgentModelReference): string {
  return `${reference.providerId}\u0000${reference.modelId}`
}

function findModel(models: LlmModelConfig[], reference: AgentModelReference | undefined): LlmModelConfig | undefined {
  if (!reference) return undefined
  return models.find(model => model.providerId === reference.providerId && model.modelId === reference.modelId)
}

function getRoleReference(profile: AgentModelProfile, role: AgentModelRole): AgentModelReference | undefined {
  return profile[role]
}

function getRoleValue(profile: AgentModelProfile, role: AgentModelRole): string {
  const reference = getRoleReference(profile, role)
  if (reference) return modelKey(reference)
  return role === 'fallback' ? NO_FALLBACK : REUSE_PRIMARY
}

function createOptions(models: LlmModelConfig[], role: AgentModelRole): ModelOption[] {
  const choices = models.filter(model => model.enabled).map(model => ({
    value: modelKey(model),
    label: `${model.displayName} · ${model.providerId}`,
    reference: { providerId: model.providerId, modelId: model.modelId },
  }))
  if (role === 'router' || role === 'summarizer') {
    return [{ value: REUSE_PRIMARY, label: '复用主模型' }, ...choices]
  }
  if (role === 'fallback') {
    return [{ value: NO_FALLBACK, label: '不配置备用模型' }, ...choices]
  }
  return choices
}

function capabilitySummary(model: LlmModelConfig | undefined): string {
  if (!model) return '模型不存在或已删除'
  const capabilities = model.capabilities
  return [
    `工具 ${capabilities.toolCall ? '是' : '否'}`,
    `并行 ${capabilities.parallelTools ? '是' : '否'}`,
    `结构化 ${capabilities.structuredOutputMode}`,
    `上下文 ${capabilities.contextWindow ?? '未知'}`,
    `输出 ${capabilities.maxOutputTokens ?? '未知'}`,
  ].join(' · ')
}

const AgentModelProfilesSection = ({ config, saveConfig }: AgentModelProfilesSectionProps): JSX.Element | null => {
  const profile = config.agentProfiles.find(item => item.id === config.selectedAgentProfileId) ?? config.agentProfiles[0]
  const [verifyingKey, setVerifyingKey] = useState<string | null>(null)
  const enabledProviderIds = useMemo(
    () => new Set(config.providers.filter(provider => provider.enabled).map(provider => provider.providerId)),
    [config.providers]
  )
  const models = useMemo(
    () => config.models.filter(model => enabledProviderIds.has(model.providerId)),
    [config.models, enabledProviderIds]
  )
  if (!profile) return null

  const saveProfile = async (nextProfile: AgentModelProfile): Promise<void> => {
    await saveConfig({
      ...config,
      agentProfiles: config.agentProfiles.map(item => item.id === nextProfile.id ? nextProfile : item),
    })
  }

  const updateRole = async (role: AgentModelRole, value: string): Promise<void> => {
    const option = createOptions(models, role).find(item => item.value === value)
    if (!option) return
    const nextProfile = { ...profile, [role]: option.reference, updatedAt: new Date().toISOString() }
    await saveProfile(nextProfile)
    logger.info('智能助手模型角色已更新', {
      event: 'agent_model_profile.role.updated',
      modelId: option.reference?.modelId,
      providerId: option.reference?.providerId,
      context: { profileId: profile.id, role, inheritsPrimary: value === REUSE_PRIMARY },
    })
  }

  const verify = async (reference: AgentModelReference): Promise<void> => {
    const model = findModel(models, reference)
    const provider = config.providers.find(item => item.providerId === reference.providerId)
    if (!model || !provider) return
    const key = modelKey(reference)
    setVerifyingKey(key)
    const requestId = `capability-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
      const result = await llmVerifyModelCapabilities({
        requestId,
        providerId: model.providerId,
        modelId: model.modelId,
        adapter: model.adapter,
        baseUrl: model.baseUrl ?? provider.baseUrl,
        reasoning: provider.reasoning,
      })
      await saveProfile({
        ...profile,
        verifications: [...profile.verifications.filter(item => modelKey(item) !== key), result],
        updatedAt: new Date().toISOString(),
      })
    } catch (error) {
      logger.error('智能助手模型能力验证失败', error, {
        event: 'agent_model_profile.verify.failed',
        requestId,
        modelId: model.modelId,
        providerId: model.providerId,
        context: { profileId: profile.id },
      })
    } finally {
      setVerifyingKey(null)
    }
  }

  const updateSetting = async (field: keyof AgentModelProfile['settings'], value: number): Promise<void> => {
    if (!Number.isFinite(value) || value < 0) return
    await saveProfile({
      ...profile,
      settings: { ...profile.settings, [field]: value },
      updatedAt: new Date().toISOString(),
    })
  }

  return (
    <UiPanel className="space-y-4 p-4">
      <div>
        <div className="text-sm font-medium text-text-dark">智能助手模型</div>
        <div className="text-xs text-text-muted">复用下方供应商与密钥；动态验证会发起最小真实请求，价格无可靠来源时保持未知。</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(roleLabels) as AgentModelRole[]).map(role => {
          const options = createOptions(models, role)
          const configuredReference = getRoleReference(profile, role)
          const effectiveReference = configuredReference ?? (role === 'router' || role === 'summarizer' ? profile.primary : undefined)
          const model = findModel(models, effectiveReference)
          const verification = effectiveReference ? findAgentModelVerification(profile, effectiveReference) : undefined
          const value = getRoleValue(profile, role)
          const display = options.find(item => item.value === value)?.label ?? '请选择模型'
          const key = effectiveReference ? modelKey(effectiveReference) : ''
          return (
            <div key={role} className="space-y-2 rounded-lg border border-border-dark bg-layer p-3">
              <div className="text-sm font-medium text-text-dark">{roleLabels[role]}</div>
              <Dropdown<string>
                value={value}
                display={display}
                options={options}
                className="w-full"
                buttonClassName="w-full"
                onSelect={selected => void updateRole(role, selected)}
              />
              <div className="text-xs text-text-muted">{capabilitySummary(model)}</div>
              {verification ? (
                <div className="space-y-1 text-xs text-text-muted">
                  <div>验证于 {new Date(verification.verifiedAt).toLocaleString()} · {verification.totalLatencyMs} ms · 费用{verification.cost.status === 'known' ? `${verification.cost.amount} ${verification.cost.currency}` : '未知'}</div>
                  <div>{verification.checks.map(check => `${check.id}:${check.status === 'passed' ? '通过' : '失败'}`).join(' · ')}</div>
                  <div>Token：输入 {verification.usage.inputTokens ?? '未知'} / 输出 {verification.usage.outputTokens ?? '未知'} / 思考 {verification.usage.reasoningTokens ?? '未知'}</div>
                </div>
              ) : <div className="text-xs text-danger">尚未进行动态能力验证</div>}
              {effectiveReference ? (
                <UiButton type="button" size="sm" variant="muted" disabled={verifyingKey !== null} onClick={() => void verify(effectiveReference)}>
                  <RefreshCw size={14} className={`mr-1.5 ${verifyingKey === key ? 'animate-spin' : ''}`} />
                  {verifyingKey === key ? '验证中' : '验证此模型'}
                </UiButton>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <UiInput type="number" min={1000} value={profile.settings.timeoutMs} onChange={event => void updateSetting('timeoutMs', Number(event.target.value))} aria-label="超时毫秒" />
        <UiInput type="number" min={0} max={5} value={profile.settings.maxRetries} onChange={event => void updateSetting('maxRetries', Number(event.target.value))} aria-label="重试次数" />
        <UiInput type="number" min={1} value={profile.settings.maxOutputTokens} onChange={event => void updateSetting('maxOutputTokens', Number(event.target.value))} aria-label="最大输出 Token" />
        <UiInput type="number" min={1} value={profile.settings.contextWindowBudget} onChange={event => void updateSetting('contextWindowBudget', Number(event.target.value))} aria-label="上下文预算 Token" />
      </div>
      <div className="text-xs text-text-muted">依次为：超时毫秒、重试次数、最大输出 Token、上下文预算 Token。</div>
    </UiPanel>
  )
}

export default AgentModelProfilesSection
