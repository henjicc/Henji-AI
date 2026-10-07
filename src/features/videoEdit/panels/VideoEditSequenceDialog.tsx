import { useSettingsStore } from '@/stores/settingsStore'
import { videoEditSequenceDefaultsSchema } from '@/core/videoEdit/sequenceDefaults'
import { useState } from 'react'
import { UiButton, UiError, UiFormRow, UiInput, UiModal, UiSelect } from '@/components/ui'
import type { VideoEditBin } from '@/core/videoEdit/document'
import { VIDEO_EDIT_FRAME_RATES } from '@/core/videoEdit/time'
import type { VideoEditSequenceSettings } from '../application/videoEditProjectItems'

const PRESETS = [{ name: '1080P 横屏', width: 1920, height: 1080 }, { name: '1080P 竖屏', width: 1080, height: 1920 }, { name: '4K 横屏', width: 3840, height: 2160 }, { name: '4K 竖屏', width: 2160, height: 3840 }]
export function VideoEditSequenceDialog({ title, initial, bins, requireFrameRate = false, saveDefaults = true, onClose, onSubmit }: {
  title: string; initial: VideoEditSequenceSettings; bins: VideoEditBin[]; requireFrameRate?: boolean; saveDefaults?: boolean; onClose: () => void; onSubmit: (settings: VideoEditSequenceSettings) => void | Promise<unknown>
}): React.ReactElement {
  const defaults = useSettingsStore(state => state.videoEditSequenceDefaults)
  const [values, updateValues] = useState({ name: initial.name ?? '新序列', binId: initial.binId ?? '', width: initial.width ?? defaults.width, height: initial.height ?? defaults.height,
    frameRate: initial.frameRate ?? (requireFrameRate ? { numerator: 60, denominator: 1 } : defaults.frameRate), pixelAspectRatio: initial.pixelAspectRatio ?? defaults.pixelAspectRatio, sampleRate: initial.sampleRate ?? defaults.sampleRate, channels: initial.channels ?? defaults.channels })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [defaultsSaved, setDefaultsSaved] = useState(false)
  const setValues = (next: typeof values): void => { updateValues(next); setDefaultsSaved(false) }
  const saveAsDefaults = (): void => {
    try { const { name: _name, binId: _binId, ...specification } = values; useSettingsStore.getState().setVideoEditSequenceDefaults(videoEditSequenceDefaultsSchema.parse(specification)); setDefaultsSaved(true); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const submit = async (): Promise<void> => {
    if (!values.name.trim()) { setError('请输入序列名称。'); return }
    setBusy(true); setError('')
    try { await onSubmit({ ...values, name: values.name.trim(), binId: values.binId || null }); onClose() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }
  const field = (name: 'width' | 'height', label: string): React.ReactElement => <UiFormRow label={label}><UiInput aria-label={label} className="w-full" type="number" min={16} max={4096} value={values[name]} onChange={event => setValues({ ...values, [name]: Number(event.target.value) })} /></UiFormRow>
  return <UiModal isOpen title={title} contentClassName="overflow-y-auto px-4 py-4" onClose={() => { if (!busy) onClose() }} footer={<>{saveDefaults && <UiButton disabled={busy} onClick={saveAsDefaults}>{defaultsSaved ? '已保存为默认值' : '保存为默认值'}</UiButton>}<UiButton disabled={busy} onClick={onClose}>取消</UiButton><UiButton variant="primary" disabled={busy} onClick={() => { void submit() }}>{busy ? '正在保存…' : '确定'}</UiButton></>}>
    <div className="space-y-3">
      <UiFormRow label="名称"><UiInput aria-label="序列名称" className="w-full" value={values.name} maxLength={200} onChange={event => setValues({ ...values, name: event.target.value })} /></UiFormRow>
      <UiFormRow label="素材箱"><UiSelect aria-label="序列素材箱" className="w-full" value={values.binId ?? ''} onChange={event => setValues({ ...values, binId: event.target.value })}><option value="">素材根目录</option>{bins.map(bin => <option key={bin.id} value={bin.id}>{bin.name}</option>)}</UiSelect></UiFormRow>
      <UiFormRow label="画幅预设"><UiSelect aria-label="画幅预设" className="w-full" value={PRESETS.find(preset => preset.width === values.width && preset.height === values.height)?.name ?? ''} onChange={event => { const preset = PRESETS.find(item => item.name === event.target.value); if (preset) setValues({ ...values, width: preset.width, height: preset.height }) }}><option value="">自定义</option>{PRESETS.map(preset => <option key={preset.name} value={preset.name}>{preset.name}</option>)}</UiSelect></UiFormRow>
      <div className="grid grid-cols-2 gap-3">{field('width', '宽度')}{field('height', '高度')}</div>
      <UiFormRow label="帧率"><UiSelect aria-label="帧率" className="w-full" value={(() => { const rate = VIDEO_EDIT_FRAME_RATES.find(rate => rate.numerator * values.frameRate.denominator === values.frameRate.numerator * rate.denominator); return rate ? `${rate.numerator}/${rate.denominator}` : '' })()} onChange={event => { if (event.target.value) { const [numerator, denominator] = event.target.value.split('/').map(Number); setValues({ ...values, frameRate: { numerator, denominator } }) } }}><option value="">自定义分数</option>{VIDEO_EDIT_FRAME_RATES.map(rate => <option key={`${rate.numerator}/${rate.denominator}`} value={`${rate.numerator}/${rate.denominator}`}>{Number((rate.numerator / rate.denominator).toFixed(3))} fps</option>)}</UiSelect></UiFormRow>
      <div className="grid grid-cols-2 gap-3">{(['numerator', 'denominator'] as const).map((part, index) => <UiFormRow key={part} label={`帧率${index ? '分母' : '分子'}`}><UiInput aria-label={`帧率${index ? '分母' : '分子'}`} className="w-full" type="number" min={1} max={1000000} value={values.frameRate[part]} onChange={event => { setValues({ ...values, frameRate: { ...values.frameRate, [part]: Number(event.target.value) } }) }} /></UiFormRow>)}</div>
      <div className="grid grid-cols-2 gap-3">{(['numerator', 'denominator'] as const).map((part, index) => <UiFormRow key={part} label={`像素长宽比${index ? '分母' : '分子'}`}><UiInput aria-label={`像素长宽比${index ? '分母' : '分子'}`} className="w-full" type="number" min={1} max={1000000} value={values.pixelAspectRatio[part]} onChange={event => setValues({ ...values, pixelAspectRatio: { ...values.pixelAspectRatio, [part]: Number(event.target.value) } })} /></UiFormRow>)}</div>
      <div className="grid grid-cols-2 gap-3"><UiFormRow label="音频采样率"><UiSelect aria-label="音频采样率" className="w-full" value={values.sampleRate} onChange={event => setValues({ ...values, sampleRate: Number(event.target.value) as 44100 | 48000 })}><option value={48000}>48000 Hz</option><option value={44100}>44100 Hz</option></UiSelect></UiFormRow><UiFormRow label="声道"><UiSelect aria-label="声道" className="w-full" value={values.channels} onChange={event => setValues({ ...values, channels: Number(event.target.value) as 1 | 2 })}><option value={2}>立体声</option><option value={1}>单声道</option></UiSelect></UiFormRow></div>
      {error && <UiError size="xs" align="start" title={error} message="" />}
    </div>
  </UiModal>
}
