import React from 'react'
import { UiFormRow, UiSwitch } from '@/components/ui'
import { useSettingsStore } from '@/stores/settingsStore'
import { useI18n } from '@/hooks/useI18n'

/** 剪辑页行为：与 PR 首选项 / 序列菜单里同名开关对应的设置。 */
const VideoEditSection: React.FC = () => {
  const { t } = useI18n('settings')
  const enabled = useSettingsStore(state => state.videoEditSelectionFollowsPlayhead)
  const setEnabled = useSettingsStore(state => state.setVideoEditSelectionFollowsPlayhead)
  return (
    <UiFormRow label={t('sections.videoEdit.selectionFollowsPlayheadLabel')} info={t('sections.videoEdit.selectionFollowsPlayheadInfo')} inline>
      <UiSwitch aria-label={t('sections.videoEdit.selectionFollowsPlayheadLabel')} checked={enabled} onCheckedChange={setEnabled} />
    </UiFormRow>
  )
}

export default VideoEditSection
