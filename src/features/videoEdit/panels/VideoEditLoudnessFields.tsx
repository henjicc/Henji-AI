import NumberInput from '@/components/ui/NumberInput'
import { UiFormRow, UiSelect } from '@/components/ui'
import { VIDEO_EDIT_LOUDNESS_PRESETS } from '@/core/videoEdit/loudness'

export function VideoEditLoudnessFields({ target, onTarget }: { target: number; onTarget: (value: number) => void }): React.ReactElement {
  const preset = VIDEO_EDIT_LOUDNESS_PRESETS.find(preset => preset.value === target)
  return <>
    <UiFormRow label="响度预设" inline><UiSelect aria-label="响度预设" value={preset ? String(preset.value) : 'custom'} onChange={event => onTarget(event.target.value === 'custom' ? -18 : Number(event.target.value))}>
      {VIDEO_EDIT_LOUDNESS_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}<option value="custom">自定义</option>
    </UiSelect></UiFormRow>
    <UiFormRow label="目标响度" info="LUFS 表示整段声音的听感响度，数值越接近零越响。" inline><div className="flex items-center gap-2"><NumberInput ariaLabel="目标响度 LUFS" value={target} min={-70} max={-5} step={.5} precision={1} widthClassName="w-24" onChange={onTarget} /><span>LUFS</span></div></UiFormRow>
  </>
}
