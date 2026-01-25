import React from 'react'
import { useI18n } from '@/hooks/useI18n'
import { useSettings } from '../hooks/useSettings'
import BottomPanelSection from '../sections/BottomPanelSection'
import SectionCard from '../components/SectionCard'

const InterfaceTab: React.FC = () => {
  const { t } = useI18n('settings')
  const { settings, updateSetting } = useSettings()
  return (
    <div className="p-6 space-y-6">
      <SectionCard title={t('tabs.interface.title')} description={t('tabs.interface.description')}>
        <p className="text-sm text-zinc-500">{t('tabs.interface.theme.placeholder')}</p>
      </SectionCard>

      <BottomPanelSection
        enableAutoCollapse={settings.enableAutoCollapse}
        collapseDelay={settings.collapseDelay}
        collapseOnScrollOnly={settings.collapseOnScrollOnly}
        onToggleAutoCollapse={(value) => updateSetting('enableAutoCollapse', value)}
        onChangeDelay={(value) => updateSetting('collapseDelay', value)}
        onToggleScrollOnly={(value) => updateSetting('collapseOnScrollOnly', value)}
      />
    </div>
  )
}

export default InterfaceTab
