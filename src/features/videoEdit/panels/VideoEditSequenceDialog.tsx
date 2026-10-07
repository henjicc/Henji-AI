import { useId, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Link, Unlink } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { videoEditSequenceDefaultsSchema } from '@/core/videoEdit/sequenceDefaults'
import { VIDEO_EDIT_SEQUENCE_LIMITS, isVideoEditSequenceSize, type VideoEditSequenceSize } from '@/core/videoEdit/sequenceSize'
import {
  VIDEO_EDIT_SEQUENCE_RATIOS, VIDEO_EDIT_SEQUENCE_TIERS, inferVideoEditSequencePreset,
  videoEditSequenceRatioLabel, videoEditSequenceRatioValue, videoEditSequenceSizeForPixels,
  videoEditSequenceTierSize, type VideoEditSequencePreset,
} from '@/core/videoEdit/sequencePresets'
import { Dropdown, UiButton, UiError, UiFormRow, UiGroup, UiIconButton, UiInput, UiModal, UiPanel, UiSelect } from '@/components/ui'
import type { VideoEditBin } from '@/core/videoEdit/document'
import { VIDEO_EDIT_FRAME_RATES, videoEditFps } from '@/core/videoEdit/time'
import type { VideoEditSequenceSettings } from '../application/videoEditProjectItems'

const PREVIEW_HINT = '预览可能较吃力，可在节目监视器降低回放分辨率'
const PIXEL_ASPECT_RATIOS = [
  { label: '方形像素', numerator: 1, denominator: 1 },
  { label: 'HD 变形宽银幕 1.33', numerator: 4, denominator: 3 },
  { label: '变形宽银幕 2.0', numerator: 2, denominator: 1 },
]
function FrameShape({ size, custom }: { size: VideoEditSequenceSize; custom: boolean }): React.ReactElement {
  const width = Math.max(1, Number.isFinite(size.width) ? size.width : 1); const height = Math.max(1, Number.isFinite(size.height) ? size.height : 1)
  const edge = Math.max(width, height)
  return <div aria-hidden className="flex items-center justify-center bg-control text-text2" style={{ width: `${width / edge * 100}%`, height: `${height / edge * 100}%` }}>
    {custom && <span className="text-xs tabular-nums">{videoEditSequenceRatioLabel(size)}</span>}
  </div>
}
export function VideoEditSequenceDialog({ title, initial, bins, requireFrameRate = false, mode = 'create', onClose, onSubmit }: {
  title: string; initial: VideoEditSequenceSettings; bins: VideoEditBin[]; requireFrameRate?: boolean; mode?: 'create' | 'edit'; onClose: () => void; onSubmit: (settings: VideoEditSequenceSettings) => void | Promise<unknown>
}): React.ReactElement {
  const defaults = useSettingsStore(state => state.videoEditSequenceDefaults)
  const [values, updateValues] = useState(() => ({ name: initial.name ?? '新序列', binId: initial.binId ?? '', width: String(initial.width ?? defaults.width), height: String(initial.height ?? defaults.height),
    frameRate: requireFrameRate ? { numerator: 60, denominator: 1 } : initial.frameRate ?? defaults.frameRate, pixelAspectRatio: initial.pixelAspectRatio ?? defaults.pixelAspectRatio, sampleRate: initial.sampleRate ?? defaults.sampleRate, channels: initial.channels ?? defaults.channels }))
  const size = { width: Number(values.width), height: Number(values.height) }
  const [preset, setPreset] = useState(() => inferVideoEditSequencePreset(size))
  const [locked, setLocked] = useState(true)
  const lockedAspect = useRef(size.width > 0 && size.height > 0 ? size.width / size.height : 16 / 9)
  const widthRef = useRef<HTMLInputElement>(null)
  const sizeErrorId = useId()
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [defaultsSaved, setDefaultsSaved] = useState(false)
  const sizeError = size.width < VIDEO_EDIT_SEQUENCE_LIMITS.minDimension || size.height < VIDEO_EDIT_SEQUENCE_LIMITS.minDimension
    ? '宽高至少 16'
    : size.width > VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension || size.height > VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension || size.width * size.height > VIDEO_EDIT_SEQUENCE_LIMITS.maxPixels ? '超过 8K 上限' : ''
  const setValues = (next: typeof values): void => {
    setError('')
    if (JSON.stringify(next) === JSON.stringify(values)) return
    updateValues(next); setDefaultsSaved(false)
  }
  const specification = (): ReturnType<typeof videoEditSequenceDefaultsSchema.parse> => {
    if (sizeError) throw new Error(sizeError)
    const { name: _name, binId: _binId, ...settings } = values
    return videoEditSequenceDefaultsSchema.parse({ ...settings, ...size })
  }
  const saveAsDefaults = (): void => {
    try { useSettingsStore.getState().setVideoEditSequenceDefaults(specification()); setDefaultsSaved(true); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const submit = async (): Promise<void> => {
    if (!values.name.trim()) { setError('请输入序列名称。'); return }
    setBusy(true); setError('')
    try { const settings = specification(); await onSubmit({ ...settings, name: values.name.trim(), binId: values.binId || null }); onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const applySize = (next: VideoEditSequenceSize, nextPreset = inferVideoEditSequencePreset(next)): void => {
    setPreset(nextPreset)
    setValues({ ...values, width: String(next.width), height: String(next.height) })
  }
  const currentAspect = Number.isFinite(size.width / size.height) && size.width > 0 && size.height > 0 ? size.width / size.height : lockedAspect.current
  const chooseRatio = (ratio: VideoEditSequencePreset['ratio']): void => {
    if (ratio === '自定义') { setPreset({ ...preset, ratio }); widthRef.current?.focus(); return }
    const aspect = videoEditSequenceRatioValue(ratio)
    const pixels = size.width > 0 && size.height > 0 && Number.isFinite(size.width * size.height) ? size.width * size.height : VIDEO_EDIT_SEQUENCE_LIMITS.minDimension ** 2
    const next = preset.tier === '自定义'
      ? videoEditSequenceSizeForPixels(pixels, aspect)
      : videoEditSequenceTierSize(aspect, preset.tier)
    lockedAspect.current = next.width / next.height
    applySize(next, { ...preset, ratio })
  }
  const chooseTier = (tier: VideoEditSequencePreset['tier']): void => {
    if (tier === '自定义') { setPreset({ ...preset, tier }); widthRef.current?.focus(); return }
    const aspect = preset.ratio === '自定义' ? currentAspect : videoEditSequenceRatioValue(preset.ratio)
    const next = videoEditSequenceTierSize(aspect, tier)
    if (!isVideoEditSequenceSize(next)) return
    lockedAspect.current = next.width / next.height
    applySize(next, { ...preset, tier })
  }
  const editSize = (key: 'width' | 'height', text: string, commit = false): void => {
    const number = Number(text)
    // 保留空值和正在输入的非法值用于即时校验，失焦才取偶数。
    const dimension = commit && text !== '' && Number.isFinite(number) ? Math.round(number / 2) * 2 : number
    const next = { ...size, [key]: dimension }
    const other = key === 'width' ? 'height' : 'width'
    if (locked && dimension > 0 && Number.isFinite(dimension)) {
      next[other] = Math.round((key === 'width' ? dimension / lockedAspect.current : dimension * lockedAspect.current) / 2) * 2
    }
    if (commit && String(dimension) === values[key] && String(next[other]) === values[other]) return
    setPreset(inferVideoEditSequencePreset(next))
    setValues({ ...values, [key]: commit && text !== '' ? String(dimension) : text, [other]: locked && dimension > 0 ? String(next[other]) : values[other] })
  }
  const matchedRate = VIDEO_EDIT_FRAME_RATES.find(rate => rate.numerator * values.frameRate.denominator === values.frameRate.numerator * rate.denominator) ?? values.frameRate
  const rateKey = `${matchedRate.numerator}/${matchedRate.denominator}`
  const parKey = `${values.pixelAspectRatio.numerator}/${values.pixelAspectRatio.denominator}`
  const par = PIXEL_ASPECT_RATIOS.find(value => value.numerator * values.pixelAspectRatio.denominator === values.pixelAspectRatio.numerator * value.denominator)
  const tierAspect = preset.ratio === '自定义' ? currentAspect : videoEditSequenceRatioValue(preset.ratio)
  return <UiModal isOpen size="form" title={title} contentClassName="overflow-y-auto px-4 py-4" onClose={() => { if (!busy) onClose() }} footer={<>
    <UiButton variant="quiet" className="mr-auto" disabled={busy || defaultsSaved || Boolean(sizeError)} onClick={saveAsDefaults}>{defaultsSaved ? '已保存为默认值' : '保存为默认值'}</UiButton>
    <UiButton disabled={busy} onClick={onClose}>取消</UiButton>
    <UiButton variant="primary" disabled={busy || Boolean(sizeError)} onClick={() => { void submit() }}>{mode === 'edit' ? '保存' : '新建'}</UiButton>
  </>}>
    <div className="space-y-5">
      <UiGroup>
        <UiFormRow label="名称" inline><UiInput aria-label="序列名称" className="w-72" disabled={busy} value={values.name} maxLength={200} onChange={event => setValues({ ...values, name: event.target.value })} /></UiFormRow>
        <UiFormRow label="素材箱" inline><UiSelect aria-label="序列素材箱" className="w-72" disabled={busy} value={values.binId} onChange={event => setValues({ ...values, binId: event.target.value })}><option value="">素材根目录</option>{bins.map(bin => <option key={bin.id} value={bin.id}>{bin.name}</option>)}</UiSelect></UiFormRow>
      </UiGroup>
      <div className="flex flex-col items-center gap-5 sm:flex-row">
        <UiPanel variant="inset" className="flex h-40 w-40 shrink-0 items-center justify-center p-3" aria-label="序列预览"><div className="flex h-full w-full items-center justify-center"><FrameShape size={size} custom={preset.ratio === '自定义'} /></div></UiPanel>
        <UiGroup className="min-w-0 w-full flex-1">
          <UiFormRow label="比例" inline><Dropdown ariaLabel="画面比例" className="w-48" disabled={busy} value={preset.ratio} options={[...VIDEO_EDIT_SEQUENCE_RATIOS, '自定义' as const].map(value => ({ label: value, value }))} onSelect={chooseRatio} /></UiFormRow>
          <UiFormRow label="分辨率" inline><Dropdown ariaLabel="分辨率" className="w-48" disabled={busy} value={preset.tier} options={[
            ...VIDEO_EDIT_SEQUENCE_TIERS.map(({ label }) => {
              const enabled = isVideoEditSequenceSize(videoEditSequenceTierSize(tierAspect, label))
              return { label, value: label, disabled: !enabled, tooltip: !enabled ? '超过 8K 上限' : label === '8K' ? PREVIEW_HINT : undefined }
            }), { label: '自定义', value: '自定义' as const },
          ]} onSelect={chooseTier} /></UiFormRow>
          <UiFormRow label="尺寸" inline><div className="w-48">
            <div className="flex items-center gap-1">
              <UiInput ref={widthRef} type="number" aria-label="宽度" className="min-w-0 w-full" disabled={busy} min={VIDEO_EDIT_SEQUENCE_LIMITS.minDimension} max={VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension} step={2} value={values.width} aria-invalid={Boolean(sizeError)} aria-describedby={sizeError ? sizeErrorId : undefined} onChange={event => editSize('width', event.target.value)} onBlur={event => editSize('width', event.target.value, true)} />
              <UiIconButton tone="bare" on={locked} size="sm" aria-label="锁定比例" disabled={busy} onClick={() => { if (!locked) lockedAspect.current = currentAspect; setLocked(value => !value) }}>{locked ? <Link className="h-4 w-4" /> : <Unlink className="h-4 w-4" />}</UiIconButton>
              <UiInput type="number" aria-label="高度" className="min-w-0 w-full" disabled={busy} min={VIDEO_EDIT_SEQUENCE_LIMITS.minDimension} max={VIDEO_EDIT_SEQUENCE_LIMITS.maxDimension} step={2} value={values.height} aria-invalid={Boolean(sizeError)} aria-describedby={sizeError ? sizeErrorId : undefined} onChange={event => editSize('height', event.target.value)} onBlur={event => editSize('height', event.target.value, true)} />
            </div>
            {sizeError && <div id={sizeErrorId} className="mt-1"><UiError size="xs" align="start" title={sizeError} message="" /></div>}
          </div></UiFormRow>
          <UiFormRow label="帧率" inline><Dropdown ariaLabel="帧率" className="w-48" disabled={busy} value={rateKey} display={`${Number(videoEditFps(values.frameRate).toFixed(3))} 帧`} options={VIDEO_EDIT_FRAME_RATES.map(rate => {
            const fps = videoEditFps(rate)
            return { label: `${Number(fps.toFixed(3))} 帧`, value: `${rate.numerator}/${rate.denominator}`, tooltip: fps > 60 ? PREVIEW_HINT : undefined }
          })} onSelect={value => { const [numerator, denominator] = value.split('/').map(Number); setValues({ ...values, frameRate: { numerator, denominator } }) }} /></UiFormRow>
        </UiGroup>
      </div>
      <div>
        <UiButton aria-expanded={advanced} disabled={busy} onClick={() => setAdvanced(value => !value)}>{advanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}更多设置</UiButton>
        {advanced && <UiGroup className="mt-3">
          <UiFormRow label="像素长宽比" inline><UiSelect aria-label="像素长宽比" className="w-72" disabled={busy} value={par ? `${par.numerator}/${par.denominator}` : parKey} onChange={event => { const [numerator, denominator] = event.target.value.split('/').map(Number); setValues({ ...values, pixelAspectRatio: { numerator, denominator } }) }}>
            {PIXEL_ASPECT_RATIOS.map(value => <option key={value.label} value={`${value.numerator}/${value.denominator}`}>{value.label}</option>)}
            {!par && <option value={parKey}>素材像素 {Number((values.pixelAspectRatio.numerator / values.pixelAspectRatio.denominator).toFixed(3))}</option>}
          </UiSelect></UiFormRow>
          <UiFormRow label="音频采样率" inline><UiSelect aria-label="音频采样率" className="w-72" disabled={busy} value={values.sampleRate} onChange={event => setValues({ ...values, sampleRate: Number(event.target.value) as 44100 | 48000 })}><option value={48000}>48000 Hz</option><option value={44100}>44100 Hz</option></UiSelect></UiFormRow>
          <UiFormRow label="声道" inline><UiSelect aria-label="声道" className="w-72" disabled={busy} value={values.channels} onChange={event => setValues({ ...values, channels: Number(event.target.value) as 1 | 2 })}><option value={2}>立体声</option><option value={1}>单声道</option></UiSelect></UiFormRow>
        </UiGroup>}
      </div>
      {error && <UiError size="xs" align="start" title={error} message="" />}
    </div>
  </UiModal>
}
