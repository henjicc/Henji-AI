import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { TFunction } from 'i18next'

import { llmVerifyModelCapabilities } from '@/commands/llmRuntime'
import {
  Dropdown,
  UI_FORM_ROW_GAP_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiDisclosurePanel,
  UiFormRow,
  UiGroup,
  UiPanel,
} from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import { findAgentModelVerification } from '@/core/llm/agentProfiles'
import { applyCapabilitySmokeToCapabilities } from '@/core/llm/capabilitySmokeCapabilities'
import { createLogger } from '@/core/logging'
import { useI18n } from '@/hooks/useI18n'
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

const AGENT_MODEL_ROLES: AgentModelRole[] = ['primary', 'router', 'summarizer', 'fallback', 'observer']

interface RuntimeSettingField {
  key: keyof AgentModelProfile['settings']
  min: number
  max?: number
}

// 文案在 settings.agentModels.settings.<key>.label / info
const RUNTIME_SETTING_FIELDS: RuntimeSettingField[] = [
  { key: 'timeoutMs', min: 1000 },
  { key: 'maxRetries', min: 0, max: 5 },
  { key: 'maxOutputTokens', min: 1 },
  { key: 'contextWindowBudget', min: 1 },
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
function describeRoleSuitability(model: LlmModelConfig, role: AgentModelRole, t: TFunction): string {
  if (role === 'observer') {
    const modalities = [
      ...(model.capabilities.image ? [t('agentModels.modality.image')] : []),
      ...(model.capabilities.video ? [t('agentModels.modality.video')] : []),
      ...(model.capabilities.audio ? [t('agentModels.modality.audio')] : []),
    ]
    return modalities.length ? t('agentModels.canSee', { modalities: modalities.join('/') }) : t('agentModels.noMediaInput')
  }
  const missing = [
    ...(model.capabilities.toolCall ? [] : [t('agentModels.capability.toolCall')]),
    ...(model.capabilities.structuredOutputMode === 'none' ? [t('agentModels.capability.structuredOutput')] : []),
    ...(model.capabilities.streaming ? [] : [t('agentModels.capability.streaming')]),
  ]
  return missing.length ? t('agentModels.unsupported', { items: missing.join(t('agentModels.listSeparator')) }) : ''
}

function isRoleUsable(model: LlmModelConfig, role: AgentModelRole, t: TFunction): boolean {
  return describeRoleSuitability(model, role, t) === ''
    || (role === 'observer' && (model.capabilities.image || model.capabilities.video || model.capabilities.audio))
}

function createOptions(models: LlmModelConfig[], role: AgentModelRole, t: TFunction): ModelOption[] {
  // 能胜任该角色的排前面，省得用户在一长串里挨个点开详情才知道哪个能用。
  const choices = models
    .filter(model => model.enabled)
    .slice()
    .sort((left, right) => Number(isRoleUsable(right, role, t)) - Number(isRoleUsable(left, role, t)))
    .map(model => ({
      value: modelKey(model),
      label: `${model.displayName} · ${model.providerId}${describeRoleSuitability(model, role, t)}`,
      reference: { providerId: model.providerId, modelId: model.modelId },
    }))
  if (role === 'router' || role === 'summarizer') {
    return [{ value: REUSE_PRIMARY, label: t('agentModels.reusePrimary') }, ...choices]
  }
  if (role === 'fallback') {
    return [{ value: NO_FALLBACK, label: t('agentModels.noFallback') }, ...choices]
  }
  if (role === 'observer') {
    return [{ value: NO_OBSERVER, label: t('agentModels.noObserver') }, ...choices]
  }
  return choices
}

function capabilitySummary(model: LlmModelConfig | undefined, t: TFunction): string {
  if (!model) return t('agentModels.missingModel')
  const capabilities = model.capabilities
  const yesNo = (value: boolean): string => t(value ? 'agentModels.yes' : 'agentModels.no')
  const unknown = t('agentModels.unknown')
  const inputs = [
    capabilities.image && t('agentModels.modality.image'),
    capabilities.video && t('agentModels.modality.video'),
    capabilities.audio && t('agentModels.modality.audio'),
  ].filter(Boolean).join(t('agentModels.listSeparator'))
  return [
    t('agentModels.summary.tools', { value: yesNo(capabilities.toolCall) }),
    t('agentModels.summary.parallel', { value: yesNo(capabilities.parallelTools) }),
    t('agentModels.summary.structured', { value: capabilities.structuredOutputMode }),
    t('agentModels.summary.input', { value: inputs || t('agentModels.textOnly') }),
    t('agentModels.summary.context', { value: capabilities.contextWindow ?? unknown }),
    t('agentModels.summary.output', { value: capabilities.maxOutputTokens ?? unknown }),
  ].join(' · ')
}

const AgentModelProfilesSection = ({ config, saveConfig }: AgentModelProfilesSectionProps): JSX.Element | null => {
  const { t } = useI18n('settings')
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
    const option = createOptions(models, role, t).find(item => item.value === value)
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
    // 分节标题“助手模型”已由 SettingsSection 渲染，这里不再叠一个“智能助手模型”分组标题；
    // 原 info 里的费用提示移到“验证此模型”按钮旁（费用信息放在会产生费用的动作处）。
    <UiGroup gap="stack">
      <div className="grid gap-3 sm:grid-cols-2">
        {AGENT_MODEL_ROLES.map(role => {
          const options = createOptions(models, role, t)
          const roleLabel = t(`agentModels.roles.${role}`)
          const configuredReference = getRoleReference(profile, role)
          const effectiveReference = configuredReference ?? (role === 'router' || role === 'summarizer' ? profile.primary : undefined)
          const model = findModel(models, effectiveReference)
          const verification = effectiveReference ? findAgentModelVerification(profile, effectiveReference) : undefined
          const value = getRoleValue(profile, role)
          const display = options.find(item => item.value === value)?.label ?? t('agentModels.choose')
          const key = effectiveReference ? modelKey(effectiveReference) : ''
          const detailsOpen = expandedRoles.has(role)
          return (
            <UiPanel key={role} variant="inset" className="space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className={UI_TEXT_LABEL_CLASS}>{roleLabel}</div>
                {/* 能力/验证详情过于专业，普通用户选好模型就够了，折叠掉默认不显示 */}
                <UiButton
                  type="button"
                  size="sm"
                  aria-expanded={detailsOpen}
                  onClick={() => toggleRoleDetails(role)}
                  className="shrink-0"
                >
                  {t('agentModels.details')}
                  {detailsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </UiButton>
              </div>
              <Dropdown<string>
                value={value}
                display={display}
                ariaLabel={roleLabel}
                options={options}
                className="w-full"
                buttonClassName="w-full"
                onSelect={selected => void updateRole(role, selected)}
              />
              <UiDisclosurePanel open={detailsOpen}>
                <div className="space-y-2 pt-2">
                  <div className={UI_TEXT_META_CLASS}>{capabilitySummary(model, t)}</div>
                  {verification ? (
                    <div className={`space-y-1 ${UI_TEXT_META_CLASS}`}>
                      <div>{t('agentModels.verifiedAt', { time: new Date(verification.verifiedAt).toLocaleString(), latency: verification.totalLatencyMs, cost: verification.cost.status === 'known' ? `${verification.cost.amount} ${verification.cost.currency}` : t('agentModels.unknown') })}</div>
                      <div>{verification.checks.map(check => `${check.id}:${t(check.status === 'passed' ? 'agentModels.check.passed' : check.status === 'skipped' ? (check.errorCode === 'manual_declaration_only' ? 'agentModels.check.declaredOnly' : 'agentModels.check.undeclared') : 'agentModels.check.failed')}`).join(' · ')}</div>
                      <div>{t('agentModels.declaredNote')}</div>
                      {/*
                        视频最容易出现"模型支持但这里判失败"：智能助手走 AI SDK 模型步骤，
                        该协议目前只能表达图片和音频，而画布文本处理走的是另一条原生流式路径，能发视频。
                      */}
                      <div>{t('agentModels.failedNote')}</div>
                      <div>{t('agentModels.usage', { input: verification.usage.inputTokens ?? t('agentModels.unknown'), output: verification.usage.outputTokens ?? t('agentModels.unknown'), reasoning: verification.usage.reasoningTokens ?? t('agentModels.unknown') })}</div>
                    </div>
                  ) : <div className={UI_TEXT_META_CLASS}>{t('agentModels.notVerified')}</div>}
                  {effectiveReference ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <UiButton type="button" variant="secondary" disabled={verifyingKey !== null} onClick={() => void verify(effectiveReference)}>
                        <RefreshCw className={`h-4 w-4 ${verifyingKey === key ? 'motion-safe:animate-spin' : ''}`} />
                        {verifyingKey === key ? t('agentModels.verifying') : t('agentModels.verify')}
                      </UiButton>
                      <span className={UI_TEXT_META_CLASS}>{t('agentModels.verifyCost')}</span>
                    </div>
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
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen(prev => !prev)}
          className="-ml-2"
        >
          {t('agentModels.advanced')}
          {advancedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </UiButton>
        <UiDisclosurePanel open={advancedOpen}>
          <div className={`pt-4 ${UI_FORM_ROW_GAP_CLASS}`}>
            {RUNTIME_SETTING_FIELDS.map(field => (
              <UiFormRow key={field.key} label={t(`agentModels.settings.${field.key}.label`)} info={t(`agentModels.settings.${field.key}.info`)} inline>
                {/* 与设置里其他数值项同一个控件（NumberInput：拖动改值、步进、范围夹取） */}
                <NumberInput
                  value={profile.settings[field.key]}
                  min={field.min}
                  max={field.max}
                  step={1}
                  ariaLabel={t(`agentModels.settings.${field.key}.label`)}
                  onChange={value => void updateSetting(field.key, value)}
                  widthClassName={SETTINGS_INLINE_CONTROL_CLASS}
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
