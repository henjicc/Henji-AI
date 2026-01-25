import React from 'react'
import SettingItem from '../components/SettingItem'
import { useI18n } from '@/hooks/useI18n'

const InterfaceTab: React.FC = () => {
  const { t } = useI18n('settings')
  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-white mb-2">{t('tabs.interface.title')}</h3>
      <p className="text-sm text-zinc-400 mb-6">
        {t('tabs.interface.description')}
      </p>

      <div className="space-y-4">
        <SettingItem label={t('tabs.interface.theme.label')}>
          <p className="text-sm text-zinc-500">{t('tabs.interface.theme.placeholder')}</p>
        </SettingItem>
      </div>
    </div>
  )
}

export default InterfaceTab
