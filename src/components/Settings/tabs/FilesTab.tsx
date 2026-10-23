import React from 'react'
import { UiRegion } from '@/components/ui'
import { SETTINGS_CONTENT_CLASS, SETTINGS_CONTENT_MAX_WIDTH_CLASS } from '../settingsLayout'
import { SettingsTabSections } from '../components/SettingsTabSections'

const FilesTab: React.FC = () => (
  <UiRegion maxWidthClassName={SETTINGS_CONTENT_MAX_WIDTH_CLASS} className={SETTINGS_CONTENT_CLASS}>
    <SettingsTabSections tab="files" />
  </UiRegion>
)

export default FilesTab
