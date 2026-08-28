import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'

import {
  Dropdown,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiFormRow,
  UiGroup,
  UiInput,
  UiModal,
  UiOptionButton,
  UiSwitch,
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
import type { LlmModelConfig, LlmProviderConfig } from '@henjicc/ai-sdk'
import type { LlmCredentialMutationDto } from '@/platform/contracts/llmRuntime'
import {
  createDefaultProvider,
  createProviderId,
  providerProtocolOptions,
  resolveApiPreview,
  resolveProviderReasoning,
} from './llmSettingsSectionHelpers'

const CUSTOM_PRESET = '__custom__'

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
  const presetOptions = [
    { value: CUSTOM_PRESET, label: t('llmProvider.presetCustom') },
    ...LLM_PROVIDER_PRESETS.map(preset => ({ value: preset.providerId, label: preset.displayName })),
  ]
  const protocolOptions = providerProtocolOptions.map(type => ({
    ...type,
    label: t(`llmProvider.protocolOptions.${type.value}`),
  }))

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

  const startNew = (): void => {
    setDraft(createDefaultProvider())
    setPresetId(CUSTOM_PRESET)
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
    const displayName = activePreset?.displayName ?? draft.displayName.trim()
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
      startNew()
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
      startNew()
    } catch (deleteError) {
      setError(describeError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <UiModal
      isOpen={isOpen}
      title={t('llmProvider.title')}
      onClose={handleClose}
      size="editor"
      footer={(
        <>
          <UiButton type="button" variant="muted" onClick={handleClose}>{t('llmProvider.actions.close')}</UiButton>
          <UiButton
            type="button"
            variant="primary"
            disabled={saving || (isCustom && !draft.displayName.trim())}
            onClick={() => void handleSave()}
          >
            {saving
              ? t('llmProvider.actions.saving')
              : isExisting ? t('llmProvider.actions.save') : t('llmProvider.actions.add')}
          </UiButton>
        </>
      )}
    >
      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] gap-4 overflow-hidden">
        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
          {providers.map(provider => (
            <UiOptionButton
              key={provider.providerId}
              type="button"
              active={draft.providerId === provider.providerId}
              variant="menu"
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5"
              onClick={() => selectExisting(provider)}
            >
              <span className="min-w-0 text-left">
                <span className="block truncate text-sm">{provider.displayName}</span>
              </span>
              <span className="text-xs text-text-soft">
                {provider.enabled ? t('llmProvider.status.on') : t('llmProvider.status.off')}
              </span>
            </UiOptionButton>
          ))}
          <UiButton type="button" variant="muted" className="w-full" onClick={startNew}>
            <Plus size={14} className="mr-1.5" />
            {t('llmProvider.actions.new')}
          </UiButton>
        </div>

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
          </UiFormRow>

          <UiFormRow label={t('llmProvider.fields.name')}>
            {isCustom ? (
              <UiInput
                value={draft.displayName}
                onChange={event => patch({ displayName: event.target.value })}
                placeholder={t('llmProvider.placeholders.name')}
              />
            ) : (
              <div className={UI_TEXT_BODY_CLASS}>{draft.displayName}</div>
            )}
          </UiFormRow>

          {isCustom ? (
            <UiFormRow label={t('llmProvider.fields.protocol')}>
              <Dropdown
                value={draft.apiProtocol ?? 'openai-compatible'}
                display={protocolOptions.find(type => type.value === draft.apiProtocol)?.label ?? protocolOptions[0].label}
                options={protocolOptions}
                ariaLabel={t('llmProvider.fields.protocol')}
                className="w-full"
                buttonClassName="w-full"
                onSelect={apiProtocol => patch({ apiProtocol })}
              />
              <div className={`mt-2 ${UI_TEXT_META_CLASS}`}>{t('llmProvider.hints.protocol')}</div>
            </UiFormRow>
          ) : null}

          <UiFormRow label={t('llmProvider.fields.baseUrl')}>
            {isCustom ? (
              <UiInput
                value={draft.baseUrl ?? ''}
                onChange={event => patch({ baseUrl: event.target.value })}
                placeholder={t('llmProvider.placeholders.baseUrl')}
              />
            ) : (
              <div className={`break-all ${UI_TEXT_BODY_CLASS}`}>{draft.baseUrl || '—'}</div>
            )}
            <div className={`mt-2 ${UI_TEXT_META_CLASS}`}>
              {activePreset?.baseUrlHint && !draft.baseUrl?.trim()
                ? activePreset.baseUrlHint
                : activePreset
                  ? t('llmProvider.hints.automaticProtocol')
                  : t('llmProvider.preview', { value: resolveApiPreview(draft) || t('llmProvider.previewEmpty') })}
            </div>
          </UiFormRow>

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

          <UiFormRow label={t('llmProvider.fields.enabled')} inline>
            <UiSwitch
              checked={draft.enabled !== false}
              onCheckedChange={checked => patch({ enabled: checked })}
            />
          </UiFormRow>

          {error ? <div role="alert" className="text-sm text-red-400">{error}</div> : null}

          {isExisting ? (
            <UiGroup divided>
              {isBuiltIn ? (
                <UiButton
                  type="button"
                  variant="plain"
                  disabled={saving}
                  onClick={() => void handleReset()}
                >
                  <RefreshCw size={14} className="mr-1.5" />
                  {t('llmProvider.actions.reset')}
                </UiButton>
              ) : (
                <UiButton
                  type="button"
                  variant="plain"
                  disabled={saving}
                  className="text-text-muted hover:text-red-400"
                  onClick={() => void handleDelete()}
                >
                  <Trash2 size={14} className="mr-1.5" />
                  {t('llmProvider.actions.delete')}
                </UiButton>
              )}
            </UiGroup>
          ) : null}
        </div>
      </div>
    </UiModal>
  )
}

export default LlmProviderDialog
