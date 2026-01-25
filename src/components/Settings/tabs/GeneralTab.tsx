import React from 'react'
import { useSettings } from '../hooks/useSettings'
import SettingItem from '../components/SettingItem'
import { useI18n } from '@/hooks/useI18n'

const GeneralTab: React.FC = () => {
  const { t } = useI18n('settings')
  const { settings, updateSetting } = useSettings()

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-white mb-2">{t('tabs.general.title')}</h3>
      <p className="text-sm text-zinc-400 mb-6">
        {t('tabs.general.description')}
      </p>

      <div className="space-y-4">
        <SettingItem label={t('tabs.general.maxHistoryCount.label')} description={t('tabs.general.maxHistoryCount.description')}>
          <input
            type="number"
            value={settings.maxHistoryCount}
            onChange={(e) => updateSetting('maxHistoryCount', parseInt(e.target.value, 10))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            min="1"
            max="1000"
          />
        </SettingItem>

        <SettingItem label={t('tabs.general.showPriceEstimate.label')}>
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showPriceEstimate}
              onChange={(e) => updateSetting('showPriceEstimate', e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm text-zinc-300">{t('tabs.general.showPriceEstimate.description')}</span>
          </label>
        </SettingItem>

        <SettingItem label={t('tabs.general.maxConcurrentTasks.label')} description={t('tabs.general.maxConcurrentTasks.description')}>
          <input
            type="number"
            value={settings.maxConcurrentTasks}
            onChange={(e) => updateSetting('maxConcurrentTasks', parseInt(e.target.value, 10))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            min="1"
            max="10"
          />
        </SettingItem>
      </div>
    </div>
  )
}

export default GeneralTab
