import type { DockviewApi } from 'dockview-react'
import { Check, LayoutPanelLeft } from 'lucide-react'
import { useState } from 'react'
import { PanelTrigger, UiButton, UiOptionButton } from '@/components/ui'
import { AUDIO_EDIT_LAYOUT_PRESETS, applyAudioEditLayoutPreset, type AudioEditLayoutPresetId } from './audioEditDockLayout'

/** 命令带右上角的“工作区”切换（参照 Adobe）：在内置布局之间一键切换。 */
export function AudioEditLayoutMenu({ api }: { api: DockviewApi | null }) {
  const [active, setActive] = useState<AudioEditLayoutPresetId | null>(null)
  const current = AUDIO_EDIT_LAYOUT_PRESETS.find(preset => preset.id === active)
  return <PanelTrigger panelSize="menu" panelPadding="menu" closeOnPanelClick renderPanel={() => (
    <div role="menu" aria-label="工作区布局" className="flex flex-col gap-0.5">
      {AUDIO_EDIT_LAYOUT_PRESETS.map(preset => <UiOptionButton key={preset.id} role="menuitemradio" aria-checked={preset.id === active} variant="menu" size="sm" active={preset.id === active}
        onClick={() => { if (api) { applyAudioEditLayoutPreset(api, preset.id); setActive(preset.id) } }}>
        <span className="flex w-full items-center justify-between gap-6">{preset.name}{preset.id === active ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}</span>
      </UiOptionButton>)}
    </div>
  )}>
    {({ open, togglePanel }) => <UiButton size="md" aria-haspopup="menu" aria-expanded={open} disabled={!api} disabledReason="面板还在加载" onClick={togglePanel} data-panel-trigger-button>
      <LayoutPanelLeft className="mr-1" />{current ? current.name : '工作区'}
    </UiButton>}
  </PanelTrigger>
}
