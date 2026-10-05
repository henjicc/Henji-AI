import React from 'react'
import { UiFormRow } from '@/components/ui'
import SettingsSegmented from '../components/SettingsSegmented'
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
      <SettingsSegmented<StartupWorkspaceId>
        value={startupWorkspace}
        options={options}
        onChange={setStartupWorkspace}
        ariaLabel={t('sections.interface.startupWorkspaceLabel')}
      />
    </UiFormRow>
  )
}

export default StartupSection
