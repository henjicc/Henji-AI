import React from 'react'
import Toggle from '@/components/ui/Toggle'
import SectionCard from '../components/SectionCard'
import { useI18n } from '@/hooks/useI18n'
import { useSettingsStore } from '@/stores/settingsStore'

/** 画布行为设置：查看器信息面板、节点标题、分镜生成选项 */
const CanvasSection: React.FC = () => {
  const { t } = useI18n('settings')
  const onText = t('actions.toggleOn')
  const offText = t('actions.toggleOff')

  const enableImageViewerInfoPanel = useSettingsStore((state) => state.enableImageViewerInfoPanel)
  const setEnableImageViewerInfoPanel = useSettingsStore((state) => state.setEnableImageViewerInfoPanel)
  const useUploadFilenameAsNodeTitle = useSettingsStore((state) => state.useUploadFilenameAsNodeTitle)
  const setUseUploadFilenameAsNodeTitle = useSettingsStore((state) => state.setUseUploadFilenameAsNodeTitle)
  const keepStyleConsistent = useSettingsStore((state) => state.storyboardGenKeepStyleConsistent)
  const setKeepStyleConsistent = useSettingsStore((state) => state.setStoryboardGenKeepStyleConsistent)
  const disableTextInImage = useSettingsStore((state) => state.storyboardGenDisableTextInImage)
  const setDisableTextInImage = useSettingsStore((state) => state.setStoryboardGenDisableTextInImage)
  const ignoreAtTag = useSettingsStore((state) => state.ignoreAtTagWhenCopyingAndGenerating)
  const setIgnoreAtTag = useSettingsStore((state) => state.setIgnoreAtTagWhenCopyingAndGenerating)

  return (
    <SectionCard title={t('sections.canvas.title')}>
      <Toggle
        label={t('sections.canvas.imageViewerInfoLabel')}
        checked={enableImageViewerInfoPanel}
        onChange={setEnableImageViewerInfoPanel}
        className="w-full"
        onText={onText}
        offText={offText}
      />
      <p className="mt-2 text-xs text-text-muted">{t('sections.canvas.imageViewerInfoHint')}</p>

      <div className="mt-4 border-t border-border-dark pt-4">
        <Toggle
          label={t('sections.canvas.uploadFilenameTitleLabel')}
          checked={useUploadFilenameAsNodeTitle}
          onChange={setUseUploadFilenameAsNodeTitle}
          className="w-full"
          onText={onText}
          offText={offText}
        />
      </div>

      <div className="mt-4 border-t border-border-dark pt-4">
        <Toggle
          label={t('sections.canvas.storyboardKeepStyleLabel')}
          checked={keepStyleConsistent}
          onChange={setKeepStyleConsistent}
          className="w-full"
          onText={onText}
          offText={offText}
        />
        <div className="mt-3">
          <Toggle
            label={t('sections.canvas.storyboardNoTextLabel')}
            checked={disableTextInImage}
            onChange={setDisableTextInImage}
            className="w-full"
            onText={onText}
            offText={offText}
          />
        </div>
        <div className="mt-3">
          <Toggle
            label={t('sections.canvas.ignoreAtTagLabel')}
            checked={ignoreAtTag}
            onChange={setIgnoreAtTag}
            className="w-full"
            onText={onText}
            offText={offText}
          />
        </div>
      </div>
    </SectionCard>
  )
}

export default CanvasSection
