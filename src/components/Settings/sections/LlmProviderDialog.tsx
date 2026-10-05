import { useEffect, useState } from 'react'
import { Info, RefreshCw, Trash2 } from 'lucide-react'

import {
  Dropdown,
  UI_TEXT_META_CLASS,
  UiButton,
  UiFormRow,
  UiGroup,
  UiInput,
  UiModal,
} from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useExternalLink } from '../hooks/useExternalLink'
import ApiKeyInput from '../components/ApiKeyInput'
import {
  LLM_PROVIDER_PRESETS,
  createModelsFromPreset,
  createProviderFromPreset,
  findProviderMetadata,
  findLlmProviderPreset,
} from '@henjicc/ai-sdk'
import type { LlmApiProtocol, LlmModelConfig, LlmProviderConfig } from '@henjicc/ai-sdk'
import type { LlmCredentialMutationDto } from '@/platform/contracts/llmRuntime'
import {
  createDefaultProvider,
  createProviderId,
  providerProtocolOptions,
  resolveApiPreview,
  resolveProviderReasoning,
} from './llmSettingsSectionHelpers'

const CUSTOM_PRESET = '__custom__'
const AUTOMATIC_PROTOCOL = '__automatic__'
type ProtocolSelection = LlmApiProtocol | typeof AUTOMATIC_PROTOCOL

interface LlmProviderDialogProps {
  isOpen: boolean
  providers: LlmProviderConfig[]
  initialProviderId?: string
  startInCreateMode?: boolean
  onClose: () => void
  /** `seedModels` 是预设推荐模型；调用方负责跳过已存在的模型。 */
  onSave: (
    provider: LlmProviderConfig,
    seedModels: LlmModelConfig[],
    credential: LlmCredentialMutationDto,
  ) => Promise<void>
  onDelete: (providerId: string) => Promise<void>
}

function setupPresetId(provider: LlmProviderConfig): string {
  return provider.setup?.kind === 'preset' ? provider.setup.presetId : CUSTOM_PRESET
}

const LlmProviderDialog = ({
  isOpen,
  providers,
  initialProviderId,
  startInCreateMode = false,
  onClose,
  onSave,
  onDelete,
}: LlmProviderDialogProps): JSX.Element => {
  const { t } = useI18n('settings')
  const { openExternal } = useExternalLink()
  const [draft, setDraft] = useState<LlmProviderConfig>(() => providers[0] ?? createDefaultProvider())
  const [presetId, setPresetId] = useState<string>(CUSTOM_PRESET)
  const [apiKey, setApiKey] = useState('')
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const availablePresets = startInCreateMode
    ? LLM_PROVIDER_PRESETS.filter(preset => !providers.some(provider => (
        provider.providerId === preset.providerId
        || (provider.setup?.kind === 'preset' && provider.setup.presetId === preset.providerId)
      )))
    : LLM_PROVIDER_PRESETS
  const presetOptions = [
    { value: CUSTOM_PRESET, label: t('llmProvider.presetCustom') },
    ...availablePresets.map(preset => ({ value: preset.providerId, label: preset.displayName })),
  ]
  const protocolOptions = providerProtocolOptions.map(type => ({
    ...type,
    label: t(`llmProvider.protocolOptions.${type.value}`),
  }))
  const presetProtocolOptions: Array<{ value: ProtocolSelection; label: string }> = [
    { value: AUTOMATIC_PROTOCOL, label: t('llmProvider.protocolOptions.automatic') },
    ...protocolOptions,
  ]

  useEffect(() => {
    if (!isOpen) return
    const selected = startInCreateMode
      ? undefined
      : providers.find(provider => provider.providerId === initialProviderId) ?? providers[0]
    const initial = selected ? { ...selected } : createDefaultProvider()
    setDraft(initial)
    setPresetId(setupPresetId(initial))
    setApiKey('')
    setApiKeyVisible(false)
    setError(null)
    // 只在打开时重置一次，之后的编辑不受外部 providers 变化影响。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const patch = (next: Partial<LlmProviderConfig>): void => {
    setDraft(prev => ({ ...prev, ...next }))
    setError(null)
  }

  const resetSensitiveDraft = (): void => {
    setApiKey('')
    setApiKeyVisible(false)
  }

  const selectExisting = (provider: LlmProviderConfig): void => {
    setDraft({ ...provider })
    setPresetId(setupPresetId(provider))
    resetSensitiveDraft()
    setError(null)
  }

  const handleClose = (): void => {
    resetSensitiveDraft()
    setError(null)
    onClose()
  }

  const selectPreset = (value: string): void => {
    setPresetId(value)
    resetSensitiveDraft()
    setError(null)
    const preset = value === CUSTOM_PRESET ? null : findLlmProviderPreset(value)
    if (!preset) {
      setDraft(createDefaultProvider())
      return
    }
    const existing = providers.find(provider => (
      provider.setup?.kind === 'preset' && provider.setup.presetId === preset.providerId
      && provider.providerId === preset.providerId
    ))
    setDraft(createProviderFromPreset(preset, {
      providerId: existing?.providerId,
      endpointProfile: existing?.endpointProfile,
      lifecycle: existing?.setup?.kind === 'preset' ? existing.setup.lifecycle : 'user',
    }))
  }

  const activePreset = presetId === CUSTOM_PRESET ? null : findLlmProviderPreset(presetId)
  const isCustom = !activePreset
  const isExisting = providers.some(provider => provider.providerId === draft.providerId)
  const isBuiltIn = draft.setup?.kind === 'preset' && draft.setup.lifecycle === 'builtin'
  const providerMetadata = activePreset
    ? findProviderMetadata(activePreset.providerId, { endpointProfile: draft.endpointProfile })
    : null
  const presetConnectionOverrides = draft.setup?.kind === 'preset'
    ? draft.setup.connectionOverrides
    : undefined
  const protocolSelection: ProtocolSelection = activePreset
    ? presetConnectionOverrides?.apiProtocol ?? AUTOMATIC_PROTOCOL
    : draft.apiProtocol ?? 'openai-compatible'

  const patchPresetConnection = (
    next: { baseUrl?: string; apiProtocol?: LlmApiProtocol },
  ): void => {
    if (draft.setup?.kind !== 'preset') return
    const { connectionOverrides: _previousOverrides, ...presetSetup } = draft.setup
    const connectionOverrides = {
      ..._previousOverrides,
      ...next,
    }
    if (!connectionOverrides.baseUrl) delete connectionOverrides.baseUrl
    if (!connectionOverrides.apiProtocol) delete connectionOverrides.apiProtocol
    patch({
      setup: {
        ...presetSetup,
        ...(Object.keys(connectionOverrides).length > 0 ? { connectionOverrides } : {}),
      },
    })
  }

  const handleProtocolSelect = (value: ProtocolSelection): void => {
    if (!activePreset) {
      patch({ apiProtocol: value === AUTOMATIC_PROTOCOL ? 'openai-compatible' : value })
      return
    }
    patchPresetConnection({
      apiProtocol: value === AUTOMATIC_PROTOCOL ? undefined : value,
    })
    patch({ apiProtocol: value === AUTOMATIC_PROTOCOL ? activePreset.apiProtocol : value })
  }

  const handleBaseUrlChange = (value: string): void => {
    patch({ baseUrl: value })
    if (!activePreset) return
    const matchesPreset = value.trim().replace(/\/+$/, '') === activePreset.baseUrl.replace(/\/+$/, '')
    patchPresetConnection({ baseUrl: matchesPreset ? undefined : value })
  }

  const describeError = (value: unknown): string => {
    const message = value instanceof Error ? value.message : String(value)
    if (message.includes('[llm_api_key_url_invalid]')) return t('llmProvider.errors.invalidKeyUrl')
    if (message.includes('[llm_provider_builtin_identity_forbidden]')) return t('llmProvider.errors.builtinIdentity')
    if (message.includes('[llm_provider_in_use]')) return t('llmProvider.errors.inUse')
    if (message.includes('[llm_provider_settings_delete_failed]')) return t('llmProvider.errors.deleteFailed')
    if (message.includes('[llm_provider_settings_commit_failed]')) return t('llmProvider.errors.saveFailed')
    return t('llmProvider.errors.unknown')
  }

  const handleSave = async (): Promise<void> => {
    const displayName = draft.displayName.trim() || activePreset?.displayName || ''
    if (!displayName || saving) return
    const providerId = draft.providerId.trim()
      || activePreset?.providerId
      || createProviderId(displayName, providers)
    const provider: LlmProviderConfig = {
      ...draft,
      providerId,
      credentialId: draft.credentialId?.trim() || providerId,
      setup: activePreset
        ? (draft.setup?.kind === 'preset'
            ? draft.setup
            : { kind: 'preset', presetId: activePreset.providerId, lifecycle: 'user' })
        : {
            kind: 'custom',
            ...(draft.setup?.kind === 'custom' && draft.setup.apiKeyManagementUrl?.trim()
              ? { apiKeyManagementUrl: draft.setup.apiKeyManagementUrl.trim() }
              : {}),
          },
      displayName,
      adapter: draft.adapter.trim() || 'openai',
      baseUrl: draft.baseUrl?.trim() || undefined,
      reasoning: resolveProviderReasoning(draft),
    }
    const seedModels = activePreset && !isExisting ? createModelsFromPreset(activePreset, provider) : []
    const credential: LlmCredentialMutationDto = apiKey.trim()
      ? { kind: 'set', apiKey: apiKey.trim() }
      : { kind: 'unchanged' }
    setSaving(true)
    setError(null)
    try {
      await onSave(provider, seedModels, credential)
      handleClose()
    } catch (saveError) {
      setError(describeError(saveError))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async (): Promise<void> => {
    if (!activePreset || !isBuiltIn || saving) return
    const provider = createProviderFromPreset(activePreset, {
      providerId: draft.providerId,
      endpointProfile: draft.endpointProfile,
      lifecycle: 'builtin',
    })
    setSaving(true)
    setError(null)
    try {
      await onSave(provider, createModelsFromPreset(activePreset, provider), { kind: 'unchanged' })
      selectExisting(provider)
    } catch (resetError) {
      setError(describeError(resetError))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!isExisting || isBuiltIn || saving) return
    setSaving(true)
    setError(null)
    try {
      await onDelete(draft.providerId)
      handleClose()
    } catch (deleteError) {
      setError(describeError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  const providerForm = (
    <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
      <UiFormRow label={t('llmProvider.fields.preset')}>
        <Dropdown<string>
          value={presetId}
          display={presetOptions.find(option => option.value === presetId)?.label ?? presetOptions[0].label}
          options={presetOptions}
          ariaLabel={t('llmProvider.fields.preset')}
          className="w-full"
          buttonClassName="w-full"
          onSelect={selectPreset}
        />
        {startInCreateMode ? (
          <div className={`mt-2 ${UI_TEXT_META_CLASS}`}>{t('llmProvider.hints.preset')}</div>
        ) : null}
      </UiFormRow>

      <UiFormRow label={t('llmProvider.fields.name')}>
        <UiInput
          value={draft.displayName}
          onChange={event => patch({ displayName: event.target.value })}
          placeholder={t('llmProvider.placeholders.name')}
        />
      </UiFormRow>

      <UiFormRow label={t('llmProvider.fields.protocol')}>
        <Dropdown<ProtocolSelection>
          value={protocolSelection}
          display={(activePreset ? presetProtocolOptions : protocolOptions)
            .find(type => type.value === protocolSelection)?.label ?? protocolOptions[0].label}
          options={activePreset ? presetProtocolOptions : protocolOptions}
          ariaLabel={t('llmProvider.fields.protocol')}
          className="w-full"
          buttonClassName="w-full"
          onSelect={handleProtocolSelect}
        />
        <div className={`mt-2 ${UI_TEXT_META_CLASS}`}>
          {t(activePreset ? 'llmProvider.hints.presetProtocol' : 'llmProvider.hints.protocol')}
        </div>
      </UiFormRow>

      <UiFormRow label={t('llmProvider.fields.baseUrl')}>
        <UiInput
          value={draft.baseUrl ?? ''}
          onChange={event => handleBaseUrlChange(event.target.value)}
          placeholder={t('llmProvider.placeholders.baseUrl')}
        />
        <div className={`mt-2 ${UI_TEXT_META_CLASS}`}>
          {activePreset?.baseUrlHint && !draft.baseUrl?.trim()
            ? activePreset.baseUrlHint
            : activePreset
              ? t('llmProvider.hints.presetBaseUrl')
              : t('llmProvider.preview', { value: resolveApiPreview(draft) || t('llmProvider.previewEmpty') })}
        </div>
      </UiFormRow>

      {isExisting ? null : (
        <ApiKeyInput
          label={t('llmProvider.fields.apiKey')}
          value={apiKey}
          visible={apiKeyVisible}
          onChange={(value) => { setApiKey(value); setError(null) }}
          onToggleVisibility={() => setApiKeyVisible(value => !value)}
          placeholder={t('llmProvider.placeholders.apiKey')}
          showLabel={t('apiKeys.visibility.show')}
          hideLabel={t('apiKeys.visibility.hide')}
          disabled={saving}
          websiteUrl={providerMetadata?.websiteUrl}
          websiteLabel={t('llmProvider.actions.website')}
          managementUrl={providerMetadata?.apiKeyUrl}
          managementLabel={t('llmProvider.actions.manageApiKey')}
          onOpenUrl={(url) => { void openExternal(url) }}
        />
      )}

      {isCustom ? (
        <UiFormRow label={t('llmProvider.fields.keyUrl')}>
          <UiInput
            value={draft.setup?.kind === 'custom' ? draft.setup.apiKeyManagementUrl ?? '' : ''}
            onChange={event => patch({
              setup: { kind: 'custom', ...(event.target.value ? { apiKeyManagementUrl: event.target.value } : {}) },
            })}
            placeholder={t('llmProvider.placeholders.keyUrl')}
          />
          <div className={`mt-2 ${UI_TEXT_META_CLASS}`}>{t('llmProvider.hints.keyUrl')}</div>
        </UiFormRow>
      ) : null}

      {error ? <div role="alert" className="text-sm text-danger-text">{error}</div> : null}

      {isExisting ? (
        <UiGroup divided>
          {isBuiltIn ? (
            <UiButton
              type="button"
              disabled={saving}
              onClick={() => void handleReset()}
            >
              <RefreshCw className="h-4 w-4" />
              {t('llmProvider.actions.reset')}
            </UiButton>
          ) : (
            <UiButton
              type="button"
              variant="danger"
              disabled={saving}
              onClick={() => void handleDelete()}
            >
              <Trash2 className="h-4 w-4" />
              {t('llmProvider.actions.delete')}
            </UiButton>
          )}
        </UiGroup>
      ) : null}
    </div>
  )

  return (
    <UiModal
      isOpen={isOpen}
      title={t(startInCreateMode ? 'llmProvider.addTitle' : 'llmProvider.title')}
      onClose={handleClose}
      // 单列表单：内容只有一列字段，用表单宽度，不铺满编辑器尺寸
      size="form"
      footer={(
        <>
          <UiButton type="button" variant="secondary" onClick={handleClose}>
            {t(startInCreateMode ? 'llmProvider.actions.cancel' : 'llmProvider.actions.close')}
          </UiButton>
          <UiButton
            type="button"
            variant="primary"
            disabled={saving || !draft.displayName.trim()}
            onClick={() => void handleSave()}
          >
            {saving
              ? t('llmProvider.actions.saving')
              : startInCreateMode
                ? t('llmProvider.actions.add')
                : isExisting ? t('llmProvider.actions.save') : t('llmProvider.actions.add')}
          </UiButton>
        </>
      )}
    >
      {/*
        编辑现有供应商只显示它自己的表单：以前左侧还有一份供应商列表，与供应商中心的列表重复；
        现在只有用户自定义的供应商才有“连接设置”入口，内置与预设供应商只需在中心填密钥、开关启用。
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {startInCreateMode ? (
          <div className={`flex items-start gap-2 ${UI_TEXT_META_CLASS}`}>
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t('llmProvider.addHint')}</span>
          </div>
        ) : null}
        {providerForm}
      </div>
    </UiModal>
  )
}

export default LlmProviderDialog
