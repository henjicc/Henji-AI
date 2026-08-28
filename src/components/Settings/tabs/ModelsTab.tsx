import React from 'react'
import { UiLoading } from '@/components/ui'
import SettingsSection from '../components/SettingsSection'
import { SETTINGS_CONTENT_CLASS } from '../settingsLayout'
import { useI18n } from '@/hooks/useI18n'
import { useLlmSettings } from '../hooks/useLlmSettings'
import ProviderCenterSection from '../sections/ProviderCenterSection'
import AgentModelProfilesSection from '../sections/AgentModelProfilesSection'
import UploadSection from '../sections/UploadSection'
import ModelAliasPanel from '../../ModelAliasPanel'

/**
 * 模型大类的模型列表需要横向铺开，所以不套 `SETTINGS_CONTENT_MAX_WIDTH_CLASS` 的限宽。
 */
const ModelsTab: React.FC = () => {
  const { t } = useI18n('settings')
  const llm = useLlmSettings()
  if (llm.loading) return <UiLoading message={t('providerCenter.loading')} />
  return (
    <div className={SETTINGS_CONTENT_CLASS}>
      <SettingsSection id="models-providers">
        <ProviderCenterSection llm={llm} />
      </SettingsSection>
      <SettingsSection id="models-assistant">
        <AgentModelProfilesSection config={llm.config} saveConfig={llm.saveConfig} />
      </SettingsSection>
      <SettingsSection id="models-upload">
        <UploadSection />
      </SettingsSection>
      <SettingsSection id="models-alias" description={t('modelSettings.alias.sectionDescription')}>
        <ModelAliasPanel />
      </SettingsSection>
    </div>
  )
}

export default ModelsTab
