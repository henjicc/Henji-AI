import React from 'react'
import { UiRegion } from '@/components/ui'
import SettingsSection from '../components/SettingsSection'
import { SETTINGS_CONTENT_CLASS, SETTINGS_CONTENT_MAX_WIDTH_CLASS } from '../settingsLayout'
import AgentSkillsSection from '../sections/AgentSkillsSection'
import AgentUserInstructionsSection from '../sections/AgentUserInstructionsSection'

const AssistantTab: React.FC = () => (
  <UiRegion maxWidthClassName={SETTINGS_CONTENT_MAX_WIDTH_CLASS} className={SETTINGS_CONTENT_CLASS}>
    <SettingsSection id="assistant-preferences">
      <AgentUserInstructionsSection />
    </SettingsSection>
    <SettingsSection id="assistant-skills">
      <AgentSkillsSection />
    </SettingsSection>
  </UiRegion>
)

export default AssistantTab
