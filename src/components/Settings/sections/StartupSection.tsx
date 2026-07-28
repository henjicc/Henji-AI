import React from 'react'
import Dropdown from '@/components/ui/Dropdown'
import { UI_TEXT_META_CLASS } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { STARTUP_WORKSPACE_IDS, type StartupWorkspaceId } from '@/core/types/workspace'
import { useSettingsStore } from '@/stores/settingsStore'
import SectionCard from '../components/SectionCard'

const StartupSection: React.FC = () => {
  const { t } = useI18n('settings')
  const startupWorkspace = useSettingsStore((state) => state.startupWorkspace)
  const setStartupWorkspace = useSettingsStore((state) => state.setStartupWorkspace)

  const options = STARTUP_WORKSPACE_IDS.map((id) => ({
    value: id,
    label: t(`sections.interface.startupWorkspaceOptions.${id}`),
  }))

  return (
    <SectionCard title={t('sections.interface.startupTitle')}>
      <Dropdown
        label={t('sections.interface.startupWorkspaceLabel')}
        value={startupWorkspace}
        options={options}
        display={options.find((option) => option.value === startupWorkspace)?.label}
        onSelect={(value) => setStartupWorkspace(value as StartupWorkspaceId)}
        className="w-full"
      />
      <p className={`mt-2 ${UI_TEXT_META_CLASS}`}>{t('sections.interface.startupWorkspaceHint')}</p>
    </SectionCard>
  )
}

export default StartupSection
