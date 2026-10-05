import React from 'react'
import { UiLoading, UiRegion } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import SettingsSection from '../components/SettingsSection'
import { SETTINGS_CONTENT_CLASS, SETTINGS_CONTENT_MAX_WIDTH_CLASS } from '../settingsLayout'
import { useLlmSettings } from '../hooks/useLlmSettings'
import AgentModelProfilesSection from '../sections/AgentModelProfilesSection'
import AgentUserInstructionsSection from '../sections/AgentUserInstructionsSection'
import McpSection from '../sections/McpSection'

/**
 * 智能助手：用哪些模型、长期指令、外部智能体连接。
 * 以前这三样分在「模型」「助手」「通用」三个大类里；技能列表会不断变长，单独成页（助手技能）。
 */
const AssistantTab: React.FC = () => {
  const { t } = useI18n('settings')
  const llm = useLlmSettings()

  return (
    <UiRegion maxWidthClassName={SETTINGS_CONTENT_MAX_WIDTH_CLASS} className={SETTINGS_CONTENT_CLASS}>
      <SettingsSection id="assistant-models">
        {llm.loading
          ? <UiLoading size="sm" message={t('providerCenter.loading')} />
          : <AgentModelProfilesSection config={llm.config} saveConfig={llm.saveConfig} />}
      </SettingsSection>
      <SettingsSection id="assistant-preferences">
        <AgentUserInstructionsSection />
      </SettingsSection>
      <SettingsSection id="assistant-mcp">
        <McpSection />
      </SettingsSection>
    </UiRegion>
  )
}

export default AssistantTab
