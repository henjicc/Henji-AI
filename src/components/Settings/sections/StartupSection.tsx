import React from 'react'
import Dropdown from '@/components/ui/Dropdown'
import { UiFormRow } from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import { useI18n } from '@/hooks/useI18n'
import { STARTUP_WORKSPACE_IDS, type StartupWorkspaceId } from '@/core/types/workspace'
import { useSettingsStore } from '@/stores/settingsStore'

const StartupSection: React.FC = () => {
  const { t } = useI18n('settings')
  const startupWorkspace = useSettingsStore((state) => state.startupWorkspace)
  const setStartupWorkspace = useSettingsStore((state) => state.setStartupWorkspace)

  const options = STARTUP_WORKSPACE_IDS.map((id) => ({
    value: id,
    label: t(`sections.interface.startupWorkspaceOptions.${id}`),
  }))

  return (
    <UiFormRow
      label={t('sections.interface.startupWorkspaceLabel')}
      info={t('sections.interface.startupWorkspaceHint')}
      inline
    >
      <Dropdown
        value={startupWorkspace}
        options={options}
        display={options.find((option) => option.value === startupWorkspace)?.label}
        onSelect={(value) => setStartupWorkspace(value as StartupWorkspaceId)}
        className={SETTINGS_INLINE_CONTROL_CLASS}
      />
    </UiFormRow>
  )
}

export default StartupSection
