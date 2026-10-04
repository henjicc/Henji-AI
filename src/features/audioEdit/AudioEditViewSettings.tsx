import { Dropdown, UiFormRow, UiModal, UiRangeInput, UiSwitch, UI_TEXT_META_CLASS } from '@/components/ui'
import type { AudioEditViewSettings as ViewSettings } from '@/core/audioEdit/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { UI_SCALE_MODES, type UiScaleMode } from '@/core/theme/uiScale'

function scaleLabel(mode: UiScaleMode): string {
  return mode === 'auto' ? '自动' : `${mode}%`
}

/** 滑杆行标签：名称 + 当前读数。 */
function RangeLabel({ name, value }: { name: string; value: number }): JSX.Element {
  return <span className="flex items-baseline justify-between gap-2"><span>{name}</span><span className="tabular-nums text-text3">{value}</span></span>
}

export function AudioEditViewSettings({ open, onClose, value, onChange }: { open: boolean; onClose: () => void; value: ViewSettings; onChange: (value: ViewSettings) => void }) {
  const scale = useSettingsStore((state) => state.uiScaleMode)
  return <UiModal isOpen={open} onClose={onClose} title="口播界面设置" size="compact">
    <div className="flex flex-col gap-4">
      <UiFormRow label={<RangeLabel name="文字大小" value={value.textSize} />}>
        <UiRangeInput aria-label="文字大小" min={14} max={36} step={1} value={value.textSize} onChange={(event) => onChange({ ...value, textSize: Number(event.target.value) })} />
      </UiFormRow>
      <UiFormRow label={<RangeLabel name="文字左右留白" value={value.sidePadding} />}>
        <UiRangeInput aria-label="文字左右留白" min={16} max={240} step={8} value={value.sidePadding} onChange={(event) => onChange({ ...value, sidePadding: Number(event.target.value) })} />
      </UiFormRow>
      <UiFormRow label="波形上方显示字幕" inline>
        <UiSwitch aria-label="波形上方显示字幕" checked={value.timelineCaptions} onCheckedChange={(timelineCaptions) => onChange({ ...value, timelineCaptions })} />
      </UiFormRow>
      <UiFormRow label="整个界面缩放">
        <Dropdown<UiScaleMode>
          ariaLabel="整个界面缩放"
          className="w-full"
          minWidthStrategy="none"
          value={scale}
          display={scaleLabel(scale)}
          options={UI_SCALE_MODES.map((mode) => ({ label: scaleLabel(mode), value: mode }))}
          onSelect={(mode) => useSettingsStore.getState().setUiScaleMode(mode)}
        />
      </UiFormRow>
      <p className={UI_TEXT_META_CLASS}>Ctrl + 滚轮缩放界面；在波形上滚轮平移，Ctrl 或 Alt + 滚轮缩放时间轴。</p>
    </div>
  </UiModal>
}
