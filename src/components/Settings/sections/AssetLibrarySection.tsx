import React from 'react'
import Dropdown from '@/components/ui/Dropdown'
import { UiFormRow, UiRangeInput, UiSwitch } from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import { useSettingsStore } from '@/stores/settingsStore'
import { useI18n } from '@/hooks/useI18n'

/*
 * 这里以前有一个文件内私有的 `Row` 组件（横向、py-3、控件锁 w-48、零分隔线），
 * 而隔壁画布分区是另一套写法（Toggle + 手写 <p> + 每行一条 border-t）。
 * 两套私有实现落在同一页上，就是"有的地方有线有的地方没有"的直接来源。
 * 现在统一走 UiFormRow，行之间只有间距。
 */
const AssetLibrarySection: React.FC = () => {
  const { t } = useI18n('settings')
  const s = useSettingsStore()

  const tabActionOptions = [
    { value: 'floating' as const, label: t('sections.assetLibrary.floating') },
    { value: 'workspace' as const, label: t('sections.assetLibrary.workspace') },
  ]
  const panelPositionOptions = [
    { value: 'top' as const, label: t('sections.assetLibrary.top') },
    { value: 'left' as const, label: t('sections.assetLibrary.left') },
    { value: 'right' as const, label: t('sections.assetLibrary.right') },
  ]
  const triggerEdgeOptions = [
    { value: 'left' as const, label: t('sections.assetLibrary.left') },
    { value: 'right' as const, label: t('sections.assetLibrary.right') },
  ]
  const edgeDependentClass = s.assetEdgeTriggerEnabled ? '' : 'opacity-50'

  return (
    <>
      <UiFormRow label={t('sections.assetLibrary.tabAction')} inline>
        <Dropdown
          value={s.assetTabAction}
          options={tabActionOptions}
          display={tabActionOptions.find((option) => option.value === s.assetTabAction)?.label}
          onSelect={(value) => s.setAssetTabAction(value)}
          className={SETTINGS_INLINE_CONTROL_CLASS}
        />
      </UiFormRow>

      <UiFormRow label={t('sections.assetLibrary.panelPosition')} inline>
        <Dropdown
          value={s.assetPanelPosition}
          options={panelPositionOptions}
          display={panelPositionOptions.find((option) => option.value === s.assetPanelPosition)?.label}
          onSelect={(value) => s.setAssetPanelPosition(value)}
          className={SETTINGS_INLINE_CONTROL_CLASS}
        />
      </UiFormRow>

      <UiFormRow
        label={t('sections.assetLibrary.edgeTrigger')}
        info={t('sections.assetLibrary.edgeHint')}
        inline
      >
        <UiSwitch checked={s.assetEdgeTriggerEnabled} onCheckedChange={s.setAssetEdgeTriggerEnabled} />
      </UiFormRow>

      <UiFormRow label={t('sections.assetLibrary.triggerEdge')} inline className={edgeDependentClass}>
        <Dropdown
          value={s.assetTriggerEdge}
          options={triggerEdgeOptions}
          display={triggerEdgeOptions.find((option) => option.value === s.assetTriggerEdge)?.label}
          onSelect={(value) => s.setAssetTriggerEdge(value)}
          className={SETTINGS_INLINE_CONTROL_CLASS}
          disabled={!s.assetEdgeTriggerEnabled}
        />
      </UiFormRow>

      <UiFormRow
        label={t('sections.assetLibrary.delay', { value: s.assetEdgeDelayMs })}
        inline
        className={edgeDependentClass}
      >
        <UiRangeInput
          min={100}
          max={2000}
          step={50}
          value={s.assetEdgeDelayMs}
          onChange={(e) => s.setAssetEdgeDelayMs(Number(e.target.value))}
          disabled={!s.assetEdgeTriggerEnabled}
          className={SETTINGS_INLINE_CONTROL_CLASS}
        />
      </UiFormRow>
    </>
  )
}

export default AssetLibrarySection
