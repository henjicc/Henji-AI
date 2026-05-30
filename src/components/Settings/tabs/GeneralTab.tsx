import React from 'react'
import { useSettings } from '../hooks/useSettings'
import LanguageSection from '../sections/LanguageSection'
import HistorySection from '../sections/HistorySection'
import DataPathSection from '../sections/DataPathSection'
import ConcurrencySection from '../sections/ConcurrencySection'
import DisplaySection from '../sections/DisplaySection'
import DownloadSection from '../sections/DownloadSection'
import PromptOptimizationSection from '../sections/PromptOptimizationSection'
import UpdateSection from '../sections/UpdateSection'

interface GeneralTabProps {
  sectionId?: string
}

const GeneralTab: React.FC<GeneralTabProps> = ({ sectionId }) => {
  const { settings, updateSetting } = useSettings()
  const currentSectionId = sectionId ?? 'general-basic'

  return (
    <div className="p-4 space-y-5">
      {currentSectionId === 'general-basic' && (
        <section className="space-y-5">
          <LanguageSection />
          <HistorySection
            maxHistoryCount={settings.maxHistoryCount}
            onChange={(value) => updateSetting('maxHistoryCount', value)}
          />
        </section>
      )}

      {currentSectionId === 'general-storage' && (
        <section className="space-y-5">
          <DataPathSection />
          <DownloadSection
            enableQuickDownload={settings.enableQuickDownload}
            quickDownloadButtonOnly={settings.quickDownloadButtonOnly}
            quickDownloadPath={settings.quickDownloadPath}
            onToggleQuickDownload={(value) => updateSetting('enableQuickDownload', value)}
            onToggleButtonOnly={(value) => updateSetting('quickDownloadButtonOnly', value)}
            onChangePath={(value) => updateSetting('quickDownloadPath', value)}
          />
        </section>
      )}

      {currentSectionId === 'general-behavior' && (
        <section className="space-y-5">
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
        </section>
      )}

      {currentSectionId === 'general-maintenance' && (
        <section className="space-y-5">
          <UpdateSection />
        </section>
      )}
    </div>
  )
}

export default GeneralTab
