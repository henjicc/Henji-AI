import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { CheckCircle2, CircleHelp, ChevronDown, ChevronUp, RefreshCw, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { TFunction } from 'i18next'

import { llmVerifyModelCapabilities } from '@/commands/llmRuntime'
import {
  Dropdown,
  UI_FORM_ROW_GAP_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiDisclosurePanel,
  UiError,
  UiFormRow,
  UiGroup,
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
  /** 界面单位下的范围 */
  min: number
  max?: number
  /** 存储值 = 界面值 × scale（超时界面用秒、存毫秒：设置里不让用户填毫秒） */
  scale?: number
}

// 文案在 settings.agentModels.settings.<key>.label / info
const RUNTIME_SETTING_FIELDS: RuntimeSettingField[] = [
  { key: 'timeoutMs', min: 1, scale: 1000 },
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

const AgentModelProfilesSection = ({ config, saveConfig }: AgentModelProfilesSectionProps): JSX.Element | null => {
  const { t } = useI18n('settings')
  const profile = config.agentProfiles.find(item => item.id === config.selectedAgentProfileId) ?? config.agentProfiles[0]
  const [verifyingKey, setVerifyingKey] = useState<string | null>(null)
  const [verificationErrors, setVerificationErrors] = useState<Record<string, string>>({})
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
    setVerificationErrors(previous => ({ ...previous, [key]: '' }))
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
      const message = error instanceof Error && /timeout|timed out|超时/i.test(error.message)
        ? t('agentModels.verifyTimeout')
        : error instanceof Error && /network|fetch|connect|网络|连接/i.test(error.message)
          ? t('agentModels.verifyConnectionFailed')
          : t('agentModels.verifyFailedMessage')
      setVerificationErrors(previous => ({ ...previous, [key]: message }))
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
    <UiGroup gap="stack" labelWidth={120}>
      <div className="space-y-3">
        {AGENT_MODEL_ROLES.map(role => {
          const options = createOptions(models, role, t)
          const roleLabel = t(`agentModels.roles.${role}`)
          const configuredReference = getRoleReference(profile, role)
          const effectiveReference = configuredReference ?? (role === 'router' || role === 'summarizer' ? profile.primary : undefined)
          const verification = effectiveReference ? findAgentModelVerification(profile, effectiveReference) : undefined
          const usageItems = verification ? [
            verification.usage.inputTokens == null ? '' : t('agentModels.usageItems.input', { value: verification.usage.inputTokens }),
            verification.usage.outputTokens == null ? '' : t('agentModels.usageItems.output', { value: verification.usage.outputTokens }),
            verification.usage.reasoningTokens == null ? '' : t('agentModels.usageItems.reasoning', { value: verification.usage.reasoningTokens }),
          ].filter(Boolean) : []
          const value = getRoleValue(profile, role)
          const display = options.find(item => item.value === value)?.label ?? t('agentModels.choose')
          const key = effectiveReference ? modelKey(effectiveReference) : ''
          const detailsOpen = expandedRoles.has(role)
          return (
            <UiGroup key={role} gap="none">
              <UiFormRow label={roleLabel}>
              <div className="flex items-center gap-2">
              <Dropdown<string> size="sm"
                value={value}
                display={display}
                ariaLabel={roleLabel}
                options={options}
                className="w-full"
                buttonClassName="w-full"
                onSelect={selected => void updateRole(role, selected)}
 />
                {/* 能力/验证详情过于专业，普通用户选好模型就够了，折叠掉默认不显示 */}
                <UiButton
                  type="button"
                  size="sm"
                  aria-expanded={detailsOpen}
                  onClick={() => toggleRoleDetails(role)}
                  className="shrink-0"
 >
                  {t('agentModels.details')}
                  {detailsOpen ? <ChevronUp /> : <ChevronDown />}
                </UiButton>
              </div>
              <UiDisclosurePanel open={detailsOpen}>
                <div className="space-y-2 pt-2">
                  {verification ? (
                    <div className={`space-y-1 ${UI_TEXT_META_CLASS}`}>
                      {verificationErrors[key] && <p className="text-xs text-text3">{t('agentModels.previousVerification')}</p>}
                      <div>{t('agentModels.verifiedAt', { time: new Date(verification.verifiedAt).toLocaleString(), latency: verification.totalLatencyMs, cost: verification.cost.status === 'known' ? `${verification.cost.amount} ${verification.cost.currency}` : t('agentModels.unknown') })}</div>
                      {verification.checks.map(check => {
                        const Icon = check.status === 'passed' ? CheckCircle2 : check.status === 'failed' ? XCircle : CircleHelp
                        const tone = check.status === 'passed' ? 'text-success-text' : check.status === 'failed' ? 'text-danger-text' : 'text-text3'
                        return <div key={check.id} className="py-1">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span>{t(`agentModels.checkNames.${check.id}`)}</span>
                            <span className={`inline-flex shrink-0 items-center gap-1 ${tone}`}><Icon aria-hidden className={`${UI_ICON_SIZE_CLASS.sm}`} />{t(`agentModels.check.${check.status}`)}</span>
                          </div>
                          {check.status === 'failed' && <p className="mt-1 text-xs text-text2">{t(`agentModels.checkImpact.${check.id}`)}</p>}
                        </div>
                      })}
                      {usageItems.length > 0 && <div>{t('agentModels.usage', { items: usageItems.join(t('agentModels.listSeparator')) })}</div>}
                    </div>
                  ) : <div className={UI_TEXT_META_CLASS}>{t('agentModels.notVerified')}</div>}
                  {effectiveReference ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <UiButton loading={verifyingKey === key} type="button" variant="secondary" disabled={verifyingKey !== null} onClick={() => void verify(effectiveReference)}>
                        <RefreshCw />
                        {t('agentModels.verify')}
                      </UiButton>
                      <span className="text-xs text-text3">{t('agentModels.verifyCost')}</span>
                    </div>
                  ) : null}
                  {verificationErrors[key] && effectiveReference && <UiError size="xs" align="start" title={t('agentModels.verifyFailedTitle')} message={verificationErrors[key]}
                    onRetry={verifyingKey === null ? () => void verify(effectiveReference) : undefined} retryLabel={t('agentModels.retry')} />}
                </div>
              </UiDisclosurePanel>
              </UiFormRow>
            </UiGroup>
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
          {advancedOpen ? <ChevronUp /> : <ChevronDown />}
        </UiButton>
        <UiDisclosurePanel open={advancedOpen}>
          <div className={`pt-4 ${UI_FORM_ROW_GAP_CLASS}`}>
            {RUNTIME_SETTING_FIELDS.map(field => {
              const stored = profile.settings[field.key]
              // labelColumn="auto"：与设置里其他数值项一样标签在左、窄数值框在右，不按上面模型行的标签列把数值框拉满整行
              return <UiFormRow key={field.key} label={t(`agentModels.settings.${field.key}.label`)} info={t(`agentModels.settings.${field.key}.info`)} inline labelColumn="auto">
                {/* 与设置里其他数值项同一个控件（NumberInput：拖动改值、步进、范围夹取） */}
                <NumberInput
                  value={stored === undefined ? undefined : stored / (field.scale ?? 1)}
                  min={field.min}
                  max={field.max}
                  step={1}
                  ariaLabel={t(`agentModels.settings.${field.key}.label`)}
                  onChange={value => void updateSetting(field.key, Math.round(value * (field.scale ?? 1)))}
                  widthClassName={SETTINGS_INLINE_CONTROL_CLASS}
 />
              </UiFormRow>
            })}
          </div>
        </UiDisclosurePanel>
      </div>
    </UiGroup>
  )
}

export default AgentModelProfilesSection
