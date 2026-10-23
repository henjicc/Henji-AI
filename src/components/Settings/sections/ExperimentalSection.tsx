import React from 'react'
import { UiFormRow, UiSwitch } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useSettingsStore } from '@/stores/settingsStore'

/** 实验性功能：默认关闭，打开后立即生效，不需要重启。 */
const ExperimentalSection: React.FC = () => {
  const { t } = useI18n('settings')
  const enabled = useSettingsStore((state) => state.experimentalWebAppRecording)
  const setEnabled = useSettingsStore((state) => state.setExperimentalWebAppRecording)
  return (
    <UiFormRow label={t('sections.experimental.webAppRecordingLabel')} info={t('sections.experimental.webAppRecordingHint')} inline>
      <UiSwitch checked={enabled} onCheckedChange={setEnabled} />
    </UiFormRow>
  )
}

export default ExperimentalSection
