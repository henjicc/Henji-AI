import React from 'react'
import Toggle from '@/components/ui/Toggle'
import Dropdown from '@/components/ui/Dropdown'
import SectionCard from '../components/SectionCard'
import { useI18n } from '@/hooks/useI18n'
import { useSettingsStore, type CanvasLodLevel } from '@/stores/settingsStore'

const LOD_LEVEL_OPTIONS: CanvasLodLevel[] = ['off', 'detail', 'balanced', 'performance']

/** 画布行为设置：缩放简化等级、查看器信息面板、节点标题、分镜生成选项 */
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
  const autoInferEmptyFrame = useSettingsStore((state) => state.storyboardGenAutoInferEmptyFrame)
  const setAutoInferEmptyFrame = useSettingsStore((state) => state.setStoryboardGenAutoInferEmptyFrame)
  const ignoreAtTag = useSettingsStore((state) => state.ignoreAtTagWhenCopyingAndGenerating)
  const setIgnoreAtTag = useSettingsStore((state) => state.setIgnoreAtTagWhenCopyingAndGenerating)
  const canvasLodLevel = useSettingsStore((state) => state.canvasLodLevel)
  const setCanvasLodLevel = useSettingsStore((state) => state.setCanvasLodLevel)

  const lodOptions = LOD_LEVEL_OPTIONS.map((value) => ({
    value,
    label: t(`sections.canvas.lodOptions.${value}`),
  }))

  return (
    <SectionCard title={t('sections.canvas.title')}>
      <div className="flex items-center justify-between gap-4">
        <label className="text-sm font-medium text-zinc-300">
          {t('sections.canvas.lodLabel')}
        </label>
        <Dropdown
          value={canvasLodLevel}
          display={lodOptions.find((option) => option.value === canvasLodLevel)?.label}
          options={lodOptions}
          onSelect={(value) => setCanvasLodLevel(value as CanvasLodLevel)}
          className="w-44"
          buttonClassName="h-[34px] w-full bg-surface-dark border-border-dark"
        />
      </div>
      <p className="mt-2 text-xs text-text-muted">{t('sections.canvas.lodHint')}</p>

      <div className="mt-4 border-t border-border-dark pt-4">
        <Toggle
          label={t('sections.canvas.imageViewerInfoLabel')}
          checked={enableImageViewerInfoPanel}
          onChange={setEnableImageViewerInfoPanel}
          className="w-full"
          onText={onText}
          offText={offText}
        />
        <p className="mt-2 text-xs text-text-muted">{t('sections.canvas.imageViewerInfoHint')}</p>
      </div>

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
            label={t('sections.canvas.storyboardAutoInferEmptyFrameLabel')}
            checked={autoInferEmptyFrame}
            onChange={setAutoInferEmptyFrame}
            className="w-full"
            onText={onText}
            offText={offText}
          />
          <p className="mt-2 text-xs text-text-muted">
            {t('sections.canvas.storyboardAutoInferEmptyFrameHint')}
          </p>
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
