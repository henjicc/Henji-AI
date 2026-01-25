import React from 'react'
import ModelSettingsPanel from '../../ModelSettingsPanel'
import { useI18n } from '@/hooks/useI18n'

const ModelsTab: React.FC = () => {
  const { t } = useI18n('settings')
  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-white mb-2">{t('tabs.models.title')}</h3>
      <p className="text-sm text-zinc-400 mb-6">
        {t('tabs.models.description')}
      </p>

      <ModelSettingsPanel />
    </div>
  )
}

export default ModelsTab
