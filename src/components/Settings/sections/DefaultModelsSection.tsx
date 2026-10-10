import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import Dropdown from '@/components/ui/Dropdown'
import { UI_TEXT_META_CLASS, UiFormRow, UiGroup } from '@/components/ui'
import { API_KEY_PROVIDERS, type ApiKeyProvider } from '@/core/config/providers'
import { getI18nText } from '@/core/types/I18nText'
import { onboardingManager } from '@/features/onboarding/application/onboardingManager'
import {
  modelDefaultsManager,
  type DefaultModelPurpose,
} from '@/features/settings/modelDefaultsManager'
import { useI18n } from '@/hooks/useI18n'
import { useSettingsStore } from '@/stores/settingsStore'
import { getProviderDisplayName } from '@/utils/modelHelpers'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'

const DEFAULT_MODEL_MEDIA_TYPES: DefaultModelPurpose[] = ['image', 'video', 'audio', 'transcription']

/** 默认供应商与按媒体类型的默认模型：新建生成任务、画布节点时使用（设置 › 工作区 › 生成）。 */
export default function DefaultModelsSection(): JSX.Element {
  const { t, currentLanguage } = useI18n('onboarding')
  const defaults = useSyncExternalStore(
    modelDefaultsManager.subscribe,
    modelDefaultsManager.getSnapshot,
    modelDefaultsManager.getSnapshot,
  )
  const [clearedMediaTypes, setClearedMediaTypes] = useState<DefaultModelPurpose[]>([])
  const previousDefaults = useRef(defaults)
  useEffect(() => {
    const previous = previousDefaults.current
    if (previous.providerId !== defaults.providerId) {
      setClearedMediaTypes(DEFAULT_MODEL_MEDIA_TYPES.filter((purpose) => previous.models[purpose] && !defaults.models[purpose]))
    }
    previousDefaults.current = defaults
  }, [defaults])
  const providerKeyStatus = useSettingsStore((state) => state.providerKeyStatus)
  const providerOptions = API_KEY_PROVIDERS.map((provider) => ({
    value: provider.id,
    label: getProviderDisplayName(provider.id),
  }))

  const modelOptions = useMemo(() => Object.fromEntries(
    DEFAULT_MODEL_MEDIA_TYPES.map((mediaType) => {
      const options = (mediaType === 'transcription'
        ? modelDefaultsManager.listTranscriptionModels((providerId) => providerKeyStatus[providerId] === true).map((entry) => ({
          value: entry.descriptor.id,
          label: `${entry.descriptor.modelId} · ${getProviderDisplayName(entry.descriptor.providerIds?.[0] ?? '')}`,
        }))
        : modelDefaultsManager.listProviderModels(mediaType, defaults.providerId)
        .map((model) => ({
          value: model.meta.canonicalModelId,
          label: getI18nText(model.meta.name, currentLanguage) || model.meta.canonicalModelId,
        })))
        .sort((left, right) => left.label.localeCompare(right.label, currentLanguage))
      return [
        mediaType,
        [{ value: '', label: t(mediaType === 'transcription' ? 'settings.transcriptionAuto' : 'settings.notSet') }, ...options],
      ]
    }),
  ) as Record<DefaultModelPurpose, Array<{ value: string; label: string }>>, [
    currentLanguage,
    defaults.providerId,
    providerKeyStatus,
    t,
  ])

  const handleProviderSelect = (value: string): void => {
    const cleared = onboardingManager.setPrimaryProvider(value as ApiKeyProvider)
    setClearedMediaTypes(cleared)
  }

  return (
    <UiGroup
      title={t('settings.defaultsTitle')}
      description={t('settings.defaultsDescription')}
      titleTone="overline"
    >
      <UiFormRow label={t('settings.primaryProvider')} info={t('settings.primaryProviderHint')} inline>
        <Dropdown
          value={defaults.providerId}
          display={getProviderDisplayName(defaults.providerId)}
          options={providerOptions}
          onSelect={handleProviderSelect}
          className={SETTINGS_INLINE_CONTROL_CLASS}
        />
      </UiFormRow>
      {DEFAULT_MODEL_MEDIA_TYPES.map((mediaType) => {
        const options = modelOptions[mediaType]
        const selectedCanonicalId = defaults.models[mediaType]
        let resolvedDisplay: string | undefined
        if (mediaType === 'transcription' && !selectedCanonicalId) {
          try {
            const selected = modelDefaultsManager.resolveTranscriptionModelId()
            resolvedDisplay = options.find((option) => option.value === selected)?.label
          } catch { /* 未配置时保留自动选择，下面提供配置提示。 */ }
        }
        return (
          <UiFormRow
            key={mediaType}
            label={t(`settings.defaultModels.${mediaType}`)}
            info={t(mediaType === 'transcription' ? 'settings.transcriptionHint' : 'settings.defaultModelHint')}
            inline
          >
            <Dropdown
              value={selectedCanonicalId}
              display={resolvedDisplay ?? options.find((option) => option.value === selectedCanonicalId)?.label ?? t('settings.modelUnavailable')}
              options={options}
              onSelect={(value) => {
                modelDefaultsManager.setDefaultModel(mediaType, value)
                setClearedMediaTypes([])
              }}
              className={SETTINGS_INLINE_CONTROL_CLASS}
            />
          </UiFormRow>
        )
      })}
      {modelOptions.transcription.length === 1 ? (
        <p className={UI_TEXT_META_CLASS}>{t('settings.transcriptionUnavailable')}</p>
      ) : null}
      {clearedMediaTypes.length > 0 ? (
        <p className={UI_TEXT_META_CLASS}>
          {t('settings.defaultsCleared', {
            types: clearedMediaTypes
              .map((mediaType) => t(`settings.mediaTypes.${mediaType}`))
              .join('、'),
          })}
        </p>
      ) : null}
    </UiGroup>
  )
}
