import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'

import { llmVerifyModelCapabilities } from '@/commands/llmRuntime'
import {
  Dropdown,
  UI_FIELD_CONTROL_HEIGHT_SM_CLASS,
  UI_FORM_ROW_GAP_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiDisclosurePanel,
  UiFormRow,
  UiGroup,
  UiInput,
  UiPanel,
} from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import { findAgentModelVerification } from '@/core/llm/agentProfiles'
import { applyCapabilitySmokeToCapabilities } from '@/core/llm/capabilitySmokeCapabilities'
import { createLogger } from '@/core/logging'
import type {
  AgentModelProfile,
  AgentModelReference,
  AgentModelRole,
  LlmConfigState,
  LlmModelConfig,
} from '@henjicc/ai-sdk'

const logger = createLogger('components.Settings.AgentModelProfilesSection')
const REUSE_PRIMARY = '__reuse_primary__'
const NO_FALLBACK = '__no_fallback__'
const NO_OBSERVER = '__no_observer__'

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
  observer: '观察模型',
}

interface RuntimeSettingField {
  key: keyof AgentModelProfile['settings']
  label: string
  info: string
  min: number
  max?: number
}

const RUNTIME_SETTING_FIELDS: RuntimeSettingField[] = [
  { key: 'timeoutMs', label: '超时', info: '单次请求的最长等待时间，单位毫秒。', min: 1000 },
  { key: 'maxRetries', label: '重试次数', info: '请求失败后自动重试的次数。', min: 0, max: 5 },
  { key: 'maxOutputTokens', label: '期望输出 Token', info: '单次期望输出的 Token 数。已配置模型优先使用各自的能力上限。', min: 1 },
  {
    key: 'contextWindowBudget',
    label: '上下文回退 Token',
    info: '模型没有登记上下文窗口时使用的回退值。已配置模型优先使用各自的能力上限。',
    min: 1,
  },
]

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
  if (role === 'fallback') return NO_FALLBACK
  if (role === 'observer') return NO_OBSERVER
  return REUSE_PRIMARY
}

/**
 * 下拉里直接写清这个模型为什么不适合当前角色。
 *
 * 模型能力现在由内置目录自动标注（`src/core/llm/modelCatalog.ts`），所以这些标注是可信的：
 * 执行类角色要能调工具和出结构化结果，观察模型则只看它能接收哪些媒体输入。
 */
function describeRoleSuitability(model: LlmModelConfig, role: AgentModelRole): string {
  if (role === 'observer') {
    const modalities = [
      ...(model.capabilities.image ? ['图片'] : []),
      ...(model.capabilities.video ? ['视频'] : []),
      ...(model.capabilities.audio ? ['音频'] : []),
    ]
    return modalities.length ? ` · 可看${modalities.join('/')}` : ' · 不支持媒体输入'
  }
  const missing = [
    ...(model.capabilities.toolCall ? [] : ['工具调用']),
    ...(model.capabilities.structuredOutputMode === 'none' ? ['结构化输出'] : []),
    ...(model.capabilities.streaming ? [] : ['流式输出']),
  ]
  return missing.length ? ` · 不支持${missing.join('、')}` : ''
}

function isRoleUsable(model: LlmModelConfig, role: AgentModelRole): boolean {
  return describeRoleSuitability(model, role) === ''
    || (role === 'observer' && (model.capabilities.image || model.capabilities.video || model.capabilities.audio))
}

function createOptions(models: LlmModelConfig[], role: AgentModelRole): ModelOption[] {
  // 能胜任该角色的排前面，省得用户在一长串里挨个点开详情才知道哪个能用。
  const choices = models
    .filter(model => model.enabled)
    .slice()
    .sort((left, right) => Number(isRoleUsable(right, role)) - Number(isRoleUsable(left, role)))
    .map(model => ({
      value: modelKey(model),
      label: `${model.displayName} · ${model.providerId}${describeRoleSuitability(model, role)}`,
      reference: { providerId: model.providerId, modelId: model.modelId },
    }))
  if (role === 'router' || role === 'summarizer') {
    return [{ value: REUSE_PRIMARY, label: '复用主模型' }, ...choices]
  }
  if (role === 'fallback') {
    return [{ value: NO_FALLBACK, label: '不配置备用模型' }, ...choices]
  }
  if (role === 'observer') {
    return [{ value: NO_OBSERVER, label: '不配置观察模型' }, ...choices]
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
    `输入 图${capabilities.image ? '✓' : '—'} / 视频${capabilities.video ? '✓' : '—'} / 音频${capabilities.audio ? '✓' : '—'}`,
    `上下文 ${capabilities.contextWindow ?? '未知'}`,
    `输出 ${capabilities.maxOutputTokens ?? '未知'}`,
  ].join(' · ')
}

const AgentModelProfilesSection = ({ config, saveConfig }: AgentModelProfilesSectionProps): JSX.Element | null => {
  const profile = config.agentProfiles.find(item => item.id === config.selectedAgentProfileId) ?? config.agentProfiles[0]
  const [verifyingKey, setVerifyingKey] = useState<string | null>(null)
  const [expandedRoles, setExpandedRoles] = useState<Set<AgentModelRole>>(new Set())
  const [advancedOpen, setAdvancedOpen] = useState(false)
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
    const structuredOutputMode = model.capabilities.structuredOutputMode === 'schema' ? 'schema' : 'json'
    try {
      const result = await llmVerifyModelCapabilities({
        requestId,
        providerId: model.providerId,
        modelId: model.modelId,
        adapter: model.adapter,
        apiProtocol: model.apiProtocol ?? provider.apiProtocol,
        baseUrl: model.baseUrl ?? provider.baseUrl,
        structuredOutputMode,
        reasoning: provider.reasoning,
        declaredInputModalities: {
          image: model.capabilities.image,
          video: model.capabilities.video,
          audio: model.capabilities.audio,
        },
      })
      const nextProfile = {
        ...profile,
        verifications: [...profile.verifications.filter(item => modelKey(item) !== key), result],
        updatedAt: new Date().toISOString(),
      }
      await saveConfig({
        ...config,
        models: config.models.map(item => modelKey(item) === key
          ? {
              ...item,
              capabilities: applyCapabilitySmokeToCapabilities(item.capabilities, result, structuredOutputMode),
            }
          : item),
        agentProfiles: config.agentProfiles.map(item => item.id === nextProfile.id ? nextProfile : item),
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

  const toggleRoleDetails = (role: AgentModelRole): void => {
    setExpandedRoles(prev => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })
  }

  return (
    /*
     * 这里原来是 `<UiPanel>`（卡片）里再套四张 `border + bg-layer` 的卡片，
     * 而且内层的 layer 比外层更亮——正好踩中"内层背景只能比外层更暗"那条。
     * 现在外层降成零装饰分组，四个角色块用 inset（更暗、无边框、无阴影）。
     */
    <UiGroup
      title="智能助手模型"
      info="复用下方供应商与密钥；动态验证会发起最小真实请求，价格无可靠来源时保持未知。"
      gap="stack"
    >
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
          const detailsOpen = expandedRoles.has(role)
          return (
            <UiPanel key={role} variant="inset" className="space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className={UI_TEXT_LABEL_CLASS}>{roleLabels[role]}</div>
                {/* 能力/验证详情过于专业，普通用户选好模型就够了，折叠掉默认不显示 */}
                <UiButton
                  type="button"
                  size="sm"
                  variant="plain"
                  onClick={() => toggleRoleDetails(role)}
                  className="shrink-0 gap-0.5 px-1.5"
                >
                  详情
                  {detailsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </UiButton>
              </div>
              <Dropdown<string>
                value={value}
                display={display}
                options={options}
                className="w-full"
                buttonClassName="w-full"
                onSelect={selected => void updateRole(role, selected)}
              />
              <UiDisclosurePanel open={detailsOpen}>
                <div className="space-y-2 pt-2">
                  <div className={UI_TEXT_META_CLASS}>{capabilitySummary(model)}</div>
                  {verification ? (
                    <div className={`space-y-1 ${UI_TEXT_META_CLASS}`}>
                      <div>验证于 {new Date(verification.verifiedAt).toLocaleString()} · {verification.totalLatencyMs} ms · 费用{verification.cost.status === 'known' ? `${verification.cost.amount} ${verification.cost.currency}` : '未知'}</div>
                      <div>{verification.checks.map(check => `${check.id}:${check.status === 'passed' ? '通过' : check.status === 'skipped' ? (check.errorCode === 'manual_declaration_only' ? '仅声明' : '未声明') : '失败'}`).join(' · ')}</div>
                      <div>图片、视频与音频由配置声明；“仅声明”表示协议可表达但尚未用真实媒体验证。</div>
                      {/*
                        视频最容易出现"模型支持但这里判失败"：智能助手走 AI SDK 模型步骤，
                        该协议目前只能表达图片和音频，而画布文本处理走的是另一条原生流式路径，能发视频。
                      */}
                      <div>某个模态显示“失败”表示智能助手当前的请求协议带不了它，模型本身仍可能支持——画布文本处理等功能不受影响。</div>
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
              </UiDisclosurePanel>
            </UiPanel>
          )
        })}
      </div>

      {/* 超时/重试/Token 上限对普通用户没有决策价值，收进高级设置，默认折叠 */}
      <div>
        <UiButton
          type="button"
          size="sm"
          variant="plain"
          onClick={() => setAdvancedOpen(prev => !prev)}
          className="gap-1 px-1.5"
        >
          高级设置
          {advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </UiButton>
        <UiDisclosurePanel open={advancedOpen}>
          <div className={`pt-4 ${UI_FORM_ROW_GAP_CLASS}`}>
            {RUNTIME_SETTING_FIELDS.map(field => (
              <UiFormRow key={field.key} label={field.label} info={field.info} inline>
                <UiInput
                  type="number"
                  min={field.min}
                  max={field.max}
                  value={profile.settings[field.key]}
                  onChange={event => void updateSetting(field.key, Number(event.target.value))}
                  className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} ${SETTINGS_INLINE_CONTROL_CLASS}`}
                />
              </UiFormRow>
            ))}
          </div>
        </UiDisclosurePanel>
      </div>
    </UiGroup>
  )
}

export default AgentModelProfilesSection
