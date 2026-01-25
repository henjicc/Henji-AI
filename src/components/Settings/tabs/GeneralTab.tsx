import React from 'react'
import { useSettings } from '../hooks/useSettings'
import LanguageSection from '../sections/LanguageSection'
import HistorySection from '../sections/HistorySection'
import DataPathSection from '../sections/DataPathSection'
import ConcurrencySection from '../sections/ConcurrencySection'
import DisplaySection from '../sections/DisplaySection'
import DownloadSection from '../sections/DownloadSection'
import UpdateSection from '../sections/UpdateSection'
import { useI18n } from '@/hooks/useI18n'

const GeneralTab: React.FC = () => {
  const { t } = useI18n('settings')
  const { settings, updateSetting } = useSettings()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-2">{t('tabs.general.title')}</h3>
        <p className="text-sm text-zinc-400">{t('tabs.general.description')}</p>
      </div>
      <LanguageSection />
      <HistorySection
        maxHistoryCount={settings.maxHistoryCount}
        onChange={(value) => updateSetting('maxHistoryCount', value)}
      />
      <DataPathSection />
      <ConcurrencySection
        maxConcurrentTasks={settings.maxConcurrentTasks}
        onChange={(value) => updateSetting('maxConcurrentTasks', value)}
      />
      <DisplaySection
        showPriceEstimate={settings.showPriceEstimate}
        enableAutoFocusModelSearch={settings.enableAutoFocusModelSearch}
        onToggleShowPrice={(value) => updateSetting('showPriceEstimate', value)}
        onToggleAutoFocus={(value) => updateSetting('enableAutoFocusModelSearch', value)}
      />
      <DownloadSection
        enableQuickDownload={settings.enableQuickDownload}
        quickDownloadButtonOnly={settings.quickDownloadButtonOnly}
        quickDownloadPath={settings.quickDownloadPath}
        onToggleQuickDownload={(value) => updateSetting('enableQuickDownload', value)}
        onToggleButtonOnly={(value) => updateSetting('quickDownloadButtonOnly', value)}
        onChangePath={(value) => updateSetting('quickDownloadPath', value)}
      />
      <UpdateSection />
    </div>
  )
}

export default GeneralTab
