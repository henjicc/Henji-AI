import React from 'react'
import { UiRegion } from '@/components/ui'
import SettingsSection from '../components/SettingsSection'
import { SETTINGS_CONTENT_CLASS, SETTINGS_CONTENT_MAX_WIDTH_CLASS } from '../settingsLayout'
import { useSettings } from '../hooks/useSettings'
import LanguageSection from '../sections/LanguageSection'
import HistorySection from '../sections/HistorySection'
import DataPathSection from '../sections/DataPathSection'
import LargeUploadSection from '../sections/LargeUploadSection'
import ConcurrencySection from '../sections/ConcurrencySection'
import DisplaySection from '../sections/DisplaySection'
import DownloadSection from '../sections/DownloadSection'
import PromptOptimizationSection from '../sections/PromptOptimizationSection'
import UpdateSection from '../sections/UpdateSection'
import OnboardingSection from '../sections/OnboardingSection'

const GeneralTab: React.FC = () => {
  const { settings, updateSetting } = useSettings()

  return (
    <UiRegion maxWidthClassName={SETTINGS_CONTENT_MAX_WIDTH_CLASS} className={SETTINGS_CONTENT_CLASS}>
      <SettingsSection id="general-basic">
        <LanguageSection />
        <HistorySection
          maxHistoryCount={settings.maxHistoryCount}
          onChange={(value) => updateSetting('maxHistoryCount', value)}
        />
      </SettingsSection>

      <SettingsSection id="general-onboarding">
        <OnboardingSection />
      </SettingsSection>

      <SettingsSection id="general-storage">
        <DataPathSection />
        <LargeUploadSection />
        <DownloadSection
          enableQuickDownload={settings.enableQuickDownload}
          quickDownloadButtonOnly={settings.quickDownloadButtonOnly}
          quickDownloadPath={settings.quickDownloadPath}
          onToggleQuickDownload={(value) => updateSetting('enableQuickDownload', value)}
          onToggleButtonOnly={(value) => updateSetting('quickDownloadButtonOnly', value)}
          onChangePath={(value) => updateSetting('quickDownloadPath', value)}
        />
      </SettingsSection>

      <SettingsSection id="general-behavior">
        <ConcurrencySection
          maxConcurrentTasks={settings.maxConcurrentTasks}
          onChange={(value) => updateSetting('maxConcurrentTasks', value)}
        />
        <DisplaySection
          showPriceEstimate={settings.showPriceEstimate}
          priceEstimateCurrencyMode={settings.priceEstimateCurrencyMode}
          usdToCnyRate={settings.usdToCnyRate}
          enableAutoFocusModelSearch={settings.enableAutoFocusModelSearch}
          onToggleShowPrice={(value) => updateSetting('showPriceEstimate', value)}
          onChangePriceEstimateCurrencyMode={(value) =>
            updateSetting('priceEstimateCurrencyMode', value)
          }
          onChangeUsdToCnyRate={(value) => updateSetting('usdToCnyRate', value)}
          onToggleAutoFocus={(value) => updateSetting('enableAutoFocusModelSearch', value)}
        />
        <PromptOptimizationSection
          behavior={settings.promptOptimizationButtonBehavior}
          onChangeBehavior={(value) => updateSetting('promptOptimizationButtonBehavior', value)}
        />
      </SettingsSection>

      <SettingsSection id="general-maintenance">
        <UpdateSection />
      </SettingsSection>
    </UiRegion>
  )
}

export default GeneralTab
