import { useState, useSyncExternalStore } from 'react'
import { Dropdown, UiButton, UiError, UiFormRow, UiGroup, UiInput } from '@/components/ui'
import { TypographyPanel, type TypographyPanelProps } from '@/components/typography/TypographyPanel'
import { videoEditTextPresetLibrary } from '../application/videoEditTextPresets'
export type VideoEditTypographyPanelProps = TypographyPanelProps
export function VideoEditTypographyPanel(props: VideoEditTypographyPanelProps): React.ReactElement {
  const { style, onChange, onError, onEnd } = props
  useSyncExternalStore(videoEditTextPresetLibrary.subscribe, videoEditTextPresetLibrary.snapshot)
  const [presetId, setPresetId] = useState(''); const [name, setName] = useState('')
  const presets = videoEditTextPresetLibrary.list()
  const selectedPreset = presets.find(preset => preset.id === presetId)
  const row = (label: string, children: React.ReactNode): React.ReactElement => <UiFormRow key={label} label={label} density="compact">{children}</UiFormRow>
  const run = (action: () => void): void => { try { onEnd?.(true); action() } catch (error) { onError(error) } }
  return <div data-video-edit-typography><TypographyPanel {...props} footer={props.fields === 'code-element' ? undefined : (
    <UiGroup title="链接样式" titleTone="compact" divided>
      {row('样式预设', <Dropdown size="sm" ariaLabel="文字样式预设" value={presetId} options={[{ value: '', label: '选择预设' }, ...presets.map(preset => ({ value: preset.id, label: preset.name }))]} onSelect={id => { setPresetId(id); const preset = presets.find(entry => entry.id === id); if (preset) { setName(preset.name); run(() => onChange(preset.style)) } }} />)}
      {row('名称', <UiInput size="sm" aria-label="文字样式预设名称" value={name} maxLength={200} onChange={event => setName(event.target.value)} />)}
      <div className="flex flex-wrap gap-1"><UiButton size="sm" disabled={!name.trim()} onClick={() => run(() => setPresetId(videoEditTextPresetLibrary.save(name, style).id))}>保存当前样式</UiButton><UiButton size="sm" disabled={!selectedPreset || !name.trim()} onClick={() => run(() => { videoEditTextPresetLibrary.update(presetId, { name }); })}>重命名</UiButton><UiButton size="sm" variant="danger" disabled={!selectedPreset} onClick={() => run(() => { videoEditTextPresetLibrary.remove(presetId); setPresetId(''); setName('') })}>删除预设</UiButton></div>
      {videoEditTextPresetLibrary.loadError() && <UiError size="xs" message={videoEditTextPresetLibrary.loadError()} />}
    </UiGroup>
  )} /></div>
}
