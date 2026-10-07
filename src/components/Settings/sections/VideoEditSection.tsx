import React from 'react'
import { Dropdown, UiFormRow, UiSwitch } from '@/components/ui'
import { useSettingsStore } from '@/stores/settingsStore'
import { useI18n } from '@/hooks/useI18n'

/** 剪辑页行为：与 PR 首选项 / 序列菜单里同名开关对应的设置。 */
const VideoEditSection: React.FC = () => {
  const { t } = useI18n('settings')
  const binsFirst = useSettingsStore(state => state.videoEditBinsFirst)
  const folderBins = useSettingsStore(state => state.videoEditImportFolderBins)
  const duplicatePolicy = useSettingsStore(state => state.videoEditDuplicatePolicy)
  const setBinsFirst = useSettingsStore(state => state.setVideoEditBinsFirst)
  const setFolderBins = useSettingsStore(state => state.setVideoEditImportFolderBins)
  const setDuplicatePolicy = useSettingsStore(state => state.setVideoEditDuplicatePolicy)
  const enabled = useSettingsStore(state => state.videoEditSelectionFollowsPlayhead)
  const setEnabled = useSettingsStore(state => state.setVideoEditSelectionFollowsPlayhead)
  return (
    <>
    <UiFormRow label={t('sections.videoEdit.selectionFollowsPlayheadLabel')} info={t('sections.videoEdit.selectionFollowsPlayheadInfo')} inline>
      <UiSwitch aria-label={t('sections.videoEdit.selectionFollowsPlayheadLabel')} checked={enabled} onCheckedChange={setEnabled} />
    </UiFormRow>
    <UiFormRow label={t('sections.videoEdit.binsFirstLabel')} inline>
      <UiSwitch aria-label={t('sections.videoEdit.binsFirstLabel')} checked={binsFirst} onCheckedChange={setBinsFirst} />
    </UiFormRow>
    <UiFormRow label={t('sections.videoEdit.folderBinsLabel')} inline>
      <UiSwitch aria-label={t('sections.videoEdit.folderBinsLabel')} checked={folderBins} onCheckedChange={setFolderBins} />
    </UiFormRow>
    <UiFormRow label={t('sections.videoEdit.duplicatePolicyLabel')} inline>
      <Dropdown value={duplicatePolicy} onSelect={setDuplicatePolicy} options={[{ value: 'skip', label: t('sections.videoEdit.duplicateSkip') }, { value: 'import', label: t('sections.videoEdit.duplicateImport') }]} />
    </UiFormRow>
    </>
  )
}

export default VideoEditSection
