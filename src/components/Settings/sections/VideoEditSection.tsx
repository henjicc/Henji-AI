import React, { useSyncExternalStore } from 'react'
import { Dropdown, UiFormRow, UiSwitch } from '@/components/ui'
import { useSettingsStore } from '@/stores/settingsStore'
import { useI18n } from '@/hooks/useI18n'
import type { VideoRenderCacheFormat, VideoRenderCacheQuality } from '@/core/media/mediaCache'
import { getMediaCacheSettings, subscribeMediaCacheSettings, updateMediaCacheSettings } from '@/services/mediaCache/mediaCacheSettings'
import SettingsSegmented from '../components/SettingsSegmented'

/** 剪辑页行为：与 PR 首选项 / 序列菜单里同名开关对应的设置。 */
const VideoEditSection: React.FC = () => {
  const { t } = useI18n('settings')
  const binsFirst = useSettingsStore(state => state.videoEditBinsFirst)
  const folderBins = useSettingsStore(state => state.videoEditImportFolderBins)
  const duplicatePolicy = useSettingsStore(state => state.videoEditDuplicatePolicy)
  const setBinsFirst = useSettingsStore(state => state.setVideoEditBinsFirst)
  const setFolderBins = useSettingsStore(state => state.setVideoEditImportFolderBins)
  const setDuplicatePolicy = useSettingsStore(state => state.setVideoEditDuplicatePolicy)
  const thumbnails = useSettingsStore(state => state.videoEditClipThumbnails)
  const setThumbnails = useSettingsStore(state => state.setVideoEditClipThumbnails)
  const enabled = useSettingsStore(state => state.videoEditSelectionFollowsPlayhead)
  const setEnabled = useSettingsStore(state => state.setVideoEditSelectionFollowsPlayhead)
  const cache = useSyncExternalStore(subscribeMediaCacheSettings, getMediaCacheSettings)
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
    <UiFormRow label={t('sections.videoEdit.clipThumbnailsLabel')} info={t('sections.videoEdit.clipThumbnailsInfo')} inline>
      <SettingsSegmented<'head' | 'head_tail' | 'continuous'> ariaLabel={t('sections.videoEdit.clipThumbnailsLabel')} value={thumbnails} onChange={setThumbnails}
        options={[{ value: 'head', label: t('sections.videoEdit.clipThumbnailsHead') }, { value: 'head_tail', label: t('sections.videoEdit.clipThumbnailsHeadTail') }, { value: 'continuous', label: t('sections.videoEdit.clipThumbnailsContinuous') }]} />
    </UiFormRow>
    <UiFormRow label={t('sections.videoEdit.renderFormatLabel')} info={t('sections.videoEdit.renderFormatInfo')} inline>
      <SettingsSegmented<VideoRenderCacheFormat> ariaLabel={t('sections.videoEdit.renderFormatLabel')} value={cache.renderFormat} onChange={renderFormat => { void updateMediaCacheSettings({ renderFormat }).catch(() => undefined) }}
        options={[{ value: 'auto', label: t('sections.videoEdit.renderFormatAuto') }, { value: 'avc', label: 'H.264' }, { value: 'hevc', label: 'HEVC' }]} />
    </UiFormRow>
    <UiFormRow label={t('sections.videoEdit.renderQualityLabel')} info={t('sections.videoEdit.renderQualityInfo')} inline>
      <SettingsSegmented<VideoRenderCacheQuality> ariaLabel={t('sections.videoEdit.renderQualityLabel')} value={cache.renderQuality} onChange={renderQuality => { void updateMediaCacheSettings({ renderQuality }).catch(() => undefined) }}
        options={[{ value: 'standard', label: t('sections.videoEdit.renderQualityStandard') }, { value: 'high', label: t('sections.videoEdit.renderQualityHigh') }]} />
    </UiFormRow>
    </>
  )
}

export default VideoEditSection
