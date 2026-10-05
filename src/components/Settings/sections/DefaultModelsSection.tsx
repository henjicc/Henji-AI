import { useMemo, useState, useSyncExternalStore } from 'react'

import Dropdown from '@/components/ui/Dropdown'
import { UI_TEXT_META_CLASS, UiFormRow, UiGroup } from '@/components/ui'
import { API_KEY_PROVIDERS, type ApiKeyProvider } from '@/core/config/providers'
import { getI18nText } from '@/core/types/I18nText'
import { onboardingManager } from '@/features/onboarding/application/onboardingManager'
import {
  modelDefaultsManager,
  type DefaultModelMediaType,
} from '@/features/settings/modelDefaultsManager'
import { useI18n } from '@/hooks/useI18n'
import { getProviderDisplayName } from '@/utils/modelHelpers'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'

const DEFAULT_MODEL_MEDIA_TYPES: DefaultModelMediaType[] = ['image', 'video', 'audio']

/** 默认供应商与按媒体类型的默认模型：新建生成任务、画布节点时使用（设置 › 工作区 › 生成）。 */
export default function DefaultModelsSection(): JSX.Element {
  const { t, currentLanguage } = useI18n('onboarding')
  const defaults = useSyncExternalStore(
    modelDefaultsManager.subscribe,
    modelDefaultsManager.getSnapshot,
    modelDefaultsManager.getSnapshot,
  )
  const [clearedMediaTypes, setClearedMediaTypes] = useState<DefaultModelMediaType[]>([])
  const providerOptions = API_KEY_PROVIDERS.map((provider) => ({
    value: provider.id,
    label: getProviderDisplayName(provider.id),
  }))

  const modelOptions = useMemo(() => Object.fromEntries(
    DEFAULT_MODEL_MEDIA_TYPES.map((mediaType) => {
      const options = modelDefaultsManager.listProviderModels(mediaType, defaults.providerId)
        .map((model) => ({
          value: model.meta.canonicalModelId,
          label: getI18nText(model.meta.name, currentLanguage) || model.meta.canonicalModelId,
        }))
        .sort((left, right) => left.label.localeCompare(right.label, currentLanguage))
      return [
        mediaType,
        [{ value: '', label: t('settings.notSet') }, ...options],
      ]
    }),
  ) as Record<DefaultModelMediaType, Array<{ value: string; label: string }>>, [
    currentLanguage,
    defaults.providerId,
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
        return (
          <UiFormRow
            key={mediaType}
            label={t(`settings.defaultModels.${mediaType}`)}
            info={t('settings.defaultModelHint')}
            inline
          >
            <Dropdown
              value={selectedCanonicalId}
              display={options.find((option) => option.value === selectedCanonicalId)?.label}
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
