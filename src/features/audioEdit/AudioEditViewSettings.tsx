import { UiModal, UiRangeInput, UiSelect, UiSwitch } from '@/components/ui'
import type { AudioEditViewSettings as ViewSettings } from '@/core/audioEdit/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { UI_SCALE_MODES, type UiScaleMode } from '@/core/theme/uiScale'

export function AudioEditViewSettings({ open, onClose, value, onChange }: { open: boolean; onClose: () => void; value: ViewSettings; onChange: (value: ViewSettings) => void }) {
  const scale = useSettingsStore((state) => state.uiScaleMode)
  return <UiModal isOpen={open} onClose={onClose} title="口播界面设置" size="compact">
    <div className="space-y-5 text-sm text-text-muted">
      <label className="block space-y-2"><span>文字大小 · {value.textSize}</span><UiRangeInput aria-label="文字大小" min={14} max={36} step={1} value={value.textSize} onChange={(event) => onChange({ ...value, textSize: Number(event.target.value) })} /></label>
      <label className="block space-y-2"><span>文字左右留白 · {value.sidePadding}</span><UiRangeInput aria-label="文字左右留白" min={16} max={240} step={8} value={value.sidePadding} onChange={(event) => onChange({ ...value, sidePadding: Number(event.target.value) })} /></label>
      <label className="flex items-center justify-between gap-3">波形上方显示字幕<UiSwitch aria-label="波形上方显示字幕" checked={value.timelineCaptions} onCheckedChange={(timelineCaptions) => onChange({ ...value, timelineCaptions })} /></label>
      <label className="block space-y-2"><span>整个界面缩放</span><UiSelect aria-label="整个界面缩放" value={scale} onChange={(event) => useSettingsStore.getState().setUiScaleMode(event.target.value as UiScaleMode)}>{UI_SCALE_MODES.map((mode) => <option key={mode} value={mode}>{mode === 'auto' ? '自动' : `${mode}%`}</option>)}</UiSelect></label>
      <p>Ctrl + 滚轮缩放界面；在波形上滚轮平移，Ctrl 或 Alt + 滚轮缩放时间轴。</p>
    </div>
  </UiModal>
}
