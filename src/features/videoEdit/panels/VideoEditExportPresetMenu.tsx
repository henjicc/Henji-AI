import { Check } from 'lucide-react'
import { PanelTrigger, UiFieldTrigger, UiOptionButton, UI_GLASS_ADAPTIVE_DIVIDER_CLASS, UI_ICON_SIZE_CLASS } from '@/components/ui'
import type { VideoEditExportPreset } from '@/core/videoEdit/exportPresets'

export interface VideoEditExportPresetAction { label: string; run: () => void }

/** 预设下拉：上面选预设，下面是对当前预设可做的操作；用不了的操作由调用方不传。 */
export function VideoEditExportPresetMenu({ presets, presetId, modified, actions, disabled, onSelect }: {
  presets: readonly VideoEditExportPreset[]; presetId: string; modified: boolean; actions: readonly VideoEditExportPresetAction[]; disabled: boolean; onSelect: (id: string) => void
}): React.ReactElement {
  const current = presets.find(value => value.id === presetId)
  const display = current ? `${current.name}${modified ? '（已修改）' : ''}` : '自定义'
  return <PanelTrigger size="sm" className="w-full min-w-0" panelPadding="menu" menuSelection="single" panelWidthLabels={[...presets.map(value => value.name), ...actions.map(value => value.label)]} closeOnPanelClick disabled={disabled} renderPanel={() => <>
    <div role="listbox" aria-label="导出预设" className="max-h-60 overflow-y-auto">
      {presets.map(value => <UiOptionButton key={value.id} role="option" aria-selected={value.id === presetId} active={value.id === presetId} variant="menu" size="sm" className="w-full justify-between gap-2" onClick={() => onSelect(value.id)}>
        <span className="block min-w-0 truncate whitespace-nowrap">{value.name}</span>
        {value.id === presetId ? <Check aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.sm} shrink-0 text-accent-text`} /> : null}
      </UiOptionButton>)}
    </div>
    {actions.length > 0 && <div role="separator" className={`my-1 border-t ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS}`} />}
    {actions.map(action => <UiOptionButton key={action.label} variant="menu" size="sm" className="w-full" onClick={action.run}>
      <span className="block min-w-0 truncate whitespace-nowrap">{action.label}</span>
    </UiOptionButton>)}
  </>}>
    {controls => <UiFieldTrigger size="sm" aria-label="导出预设" aria-haspopup="listbox" aria-expanded={controls.open} open={controls.open} disabled={disabled} className="w-full" onClick={controls.togglePanel}>{display}</UiFieldTrigger>}
  </PanelTrigger>
}
