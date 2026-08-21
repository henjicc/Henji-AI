import Dropdown from '@/components/ui/Dropdown'
import { UI_TEXT_META_CLASS, UiButton, UiFormRow, UiGroup } from '@/components/ui'
import { API_KEY_PROVIDERS, type ApiKeyProvider } from '@/core/config/providers'
import { onboardingManager } from '@/features/onboarding/application/onboardingManager'
import { useOnboardingState } from '@/features/onboarding/application/useOnboardingState'
import { useI18n } from '@/hooks/useI18n'
import { openSettingsPanel } from '@/stores/uiStore'
import { getProviderDisplayName } from '@/utils/modelHelpers'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'

export default function OnboardingSection(): JSX.Element {
  const { t } = useI18n('onboarding')
  const state = useOnboardingState()
  const providerOptions = API_KEY_PROVIDERS.map((provider) => ({
    value: provider.id,
    label: getProviderDisplayName(provider.id),
  }))
  return (
    <UiGroup description={t('settings.description')}>
      <UiFormRow label={t('settings.statusLabel')} inline>
        <span className={UI_TEXT_META_CLASS}>{t(`settings.status.${state.status}`)}</span>
      </UiFormRow>
      <UiFormRow label={t('settings.primaryProvider')} inline>
        <Dropdown
          value={state.primaryProvider}
          display={getProviderDisplayName(state.primaryProvider)}
          options={providerOptions}
          onSelect={(value) => onboardingManager.setPrimaryProvider(value as ApiKeyProvider)}
          className={SETTINGS_INLINE_CONTROL_CLASS}
        />
      </UiFormRow>
      <div className="flex flex-wrap gap-2">
        <UiButton variant="primary" onClick={() => onboardingManager.restart()}>
          {t('actions.rerun')}
        </UiButton>
        <UiButton
          variant="muted"
          onClick={() => openSettingsPanel({ tab: 'api', sectionId: 'api-keys' })}
        >
          {t('actions.openApiSettings')}
        </UiButton>
      </div>
    </UiGroup>
  )
}
