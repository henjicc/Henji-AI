import React from 'react'
import { UiRegion } from '@/components/ui'
import SettingsSection from '../components/SettingsSection'
import { SETTINGS_CONTENT_CLASS, SETTINGS_CONTENT_MAX_WIDTH_CLASS } from '../settingsLayout'
import AgentSkillsSection from '../sections/AgentSkillsSection'

/** 助手技能：内置与自装技能的列表会不断变长，单独成页，不与其他设置连续滚动。 */
const SkillsTab: React.FC = () => (
  <UiRegion maxWidthClassName={SETTINGS_CONTENT_MAX_WIDTH_CLASS} className={SETTINGS_CONTENT_CLASS}>
    <SettingsSection id="assistant-skills">
      <AgentSkillsSection />
    </SettingsSection>
  </UiRegion>
)

export default SkillsTab
