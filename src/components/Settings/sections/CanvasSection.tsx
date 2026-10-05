import React from 'react'
import Dropdown from '@/components/ui/Dropdown'
import { UiFormRow, UiGroup, UiSwitch } from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import { useI18n } from '@/hooks/useI18n'
import { useSettingsStore, type CanvasLodLevel } from '@/stores/settingsStore'

const LOD_LEVEL_OPTIONS: CanvasLodLevel[] = ['off', 'detail', 'balanced', 'performance']

/** 画布设置：缩小时简化绘制、节点行为、分镜生成与 @图 标记（图片查看器信息移到「通用 › 查看与快捷键」） */
const CanvasSection: React.FC = () => {
  const { t } = useI18n('settings')

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
  const autoInsertTextDisplayNode = useSettingsStore((state) => state.autoInsertTextDisplayNode)
  const setAutoInsertTextDisplayNode = useSettingsStore((state) => state.setAutoInsertTextDisplayNode)

  const lodOptions = LOD_LEVEL_OPTIONS.map((value) => ({
    value,
    label: t(`sections.canvas.lodOptions.${value}`),
  }))

  return (
    <>
      <UiGroup title={t('sections.canvas.displayGroup')} titleTone="overline">
        {/* 各档具体怎么降级属于工作原理，收进标签本身的悬停说明（info）；档位名本身已经说明了取舍方向 */}
        <UiFormRow label={t('sections.canvas.lodLabel')} info={t('sections.canvas.lodHint')} inline>
          <Dropdown
            value={canvasLodLevel}
            display={lodOptions.find((option) => option.value === canvasLodLevel)?.label}
            options={lodOptions}
            onSelect={(value) => setCanvasLodLevel(value as CanvasLodLevel)}
            className={SETTINGS_INLINE_CONTROL_CLASS}
          />
        </UiFormRow>

        <UiFormRow
          label={t('sections.canvas.autoInsertTextDisplayLabel')}
          info={t('sections.canvas.autoInsertTextDisplayHint')}
          inline
        >
          <UiSwitch
            checked={autoInsertTextDisplayNode}
            onCheckedChange={setAutoInsertTextDisplayNode}
          />
        </UiFormRow>

        <UiFormRow label={t('sections.canvas.uploadFilenameTitleLabel')} inline>
          <UiSwitch checked={useUploadFilenameAsNodeTitle} onCheckedChange={setUseUploadFilenameAsNodeTitle} />
        </UiFormRow>
      </UiGroup>

      <UiGroup title={t('sections.canvas.storyboardGroup')} titleTone="overline">
        <UiFormRow label={t('sections.canvas.storyboardKeepStyleLabel')} inline>
          <UiSwitch checked={keepStyleConsistent} onCheckedChange={setKeepStyleConsistent} />
        </UiFormRow>

        <UiFormRow label={t('sections.canvas.storyboardNoTextLabel')} inline>
          <UiSwitch checked={disableTextInImage} onCheckedChange={setDisableTextInImage} />
        </UiFormRow>

        <UiFormRow
          label={t('sections.canvas.storyboardAutoInferEmptyFrameLabel')}
          info={t('sections.canvas.storyboardAutoInferEmptyFrameHint')}
          inline
        >
          <UiSwitch checked={autoInferEmptyFrame} onCheckedChange={setAutoInferEmptyFrame} />
        </UiFormRow>

        <UiFormRow label={t('sections.canvas.ignoreAtTagLabel')} inline>
          <UiSwitch checked={ignoreAtTag} onCheckedChange={setIgnoreAtTag} />
        </UiFormRow>
      </UiGroup>
    </>
  )
}

export default CanvasSection
