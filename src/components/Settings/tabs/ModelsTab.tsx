import React from 'react'
import SettingsSection from '../components/SettingsSection'
import { SETTINGS_CONTENT_CLASS } from '../settingsLayout'
import { useI18n } from '@/hooks/useI18n'
import ModelSettingsPanel from '../../ModelSettingsPanel'
import ModelAliasPanel from '../../ModelAliasPanel'

/**
 * 模型大类的模型列表需要横向铺开，所以不套 `SETTINGS_CONTENT_MAX_WIDTH_CLASS` 的限宽。
 */
const ModelsTab: React.FC = () => {
  const { t } = useI18n('settings')
  return (
    <div className={SETTINGS_CONTENT_CLASS}>
      <SettingsSection id="models-visibility">
        <ModelSettingsPanel />
      </SettingsSection>
      <SettingsSection id="models-alias" description={t('modelSettings.alias.sectionDescription')}>
        <ModelAliasPanel />
      </SettingsSection>
    </div>
  )
}

export default ModelsTab
