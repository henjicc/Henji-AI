import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Dropdown, UiButton, UiFormRow, UiSegmented } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { createLogger } from '@/core/logging'
import type { RecordingEncoder, RecordingEncoding } from '@/core/screenRecording/encoding'
import { getPlatform } from '@/platform'
import { recordingOutput, type RecordingQuality } from './recordingSetupModel'

type VideoValue = RecordingEncoding & { quality: RecordingQuality; fps: 30 | 60 }

/** The collapsed encoding block every recording entry shares: rate control, bitrate, keyframes, codec, encoder. */
export function RecordingVideoParams<T extends VideoValue>({ value, onChange }: { value: T; onChange(patch: Partial<RecordingEncoding>): void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const [expanded, setExpanded] = useState(false)
  const [encoders, setEncoders] = useState<RecordingEncoder[]>(['auto', 'software'])
  useEffect(() => {
    let active = true
    void getPlatform().screenRecording.capture({ operation: 'encoders', codec: value.codec ?? 'h264' }).then(result => {
      if (active) setEncoders(result as RecordingEncoder[])
    }).catch(error => createLogger('features.screenRecording.setup').warn('编码器列表读取失败', { event: 'recording.encoders.read.failed', error }))
    return () => { active = false }
  }, [value.codec])
  const output = recordingOutput(value)
  const encoderLabels: Record<RecordingEncoder, string> = { auto: t('recording.encoder_auto'), nvidia: 'NVIDIA', intel: 'Intel', amd: 'AMD', apple: 'Apple', software: t('recording.encoder_software') }
  return <>
    <UiButton size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronDown /> : <ChevronRight />}{t('recording.videoParams')}</UiButton>
    {expanded && <>
      <UiFormRow label={t('recording.rateControl')} info={t('recording.rateControlInfo')} density="compact"><UiSegmented ariaLabel={t('recording.rateControl')} size="sm" value={output.rateControl} onChange={rateControl => onChange({ rateControl })} options={(['quality', 'vbr', 'cbr'] as const).map(mode => ({ value: mode, label: t(`recording.rate_${mode}`) }))} /></UiFormRow>
      <UiFormRow label={t('recording.bitrate')} info={t('recording.bitrateInfo')} density="compact"><div className="flex min-w-0 flex-wrap items-center gap-1"><NumberInput size="sm" value={output.bitrate / 1_000_000} min={1} max={100} step={.1} onChange={bitrate => onChange({ bitrate: Math.round(bitrate * 1_000_000) })} /><span className="text-xs text-text2">Mbps</span><UiButton size="sm" onClick={() => onChange({ bitrate: undefined })}>{t('recording.resetDefault')}</UiButton></div></UiFormRow>
      <UiFormRow label={t('recording.keyframes')} info={t('recording.keyframesInfo')} density="compact"><Dropdown size="sm" value={String(output.keyframeFrames ?? 'auto')} options={[{ value: 'auto', label: t('recording.keyframes_auto') }, ...([10, 15, 30, 60, 120] as const).map(frames => ({ value: String(frames), label: t('recording.keyframes_frames', { frames, seconds: Number((frames / value.fps).toFixed(2)) }) }))]} onSelect={frames => onChange({ keyframeFrames: frames === 'auto' ? undefined : Number(frames) as NonNullable<RecordingEncoding['keyframeFrames']> })} /></UiFormRow>
      <UiFormRow label={t('recording.codec')} info={t('recording.codecInfo')} density="compact"><UiSegmented ariaLabel={t('recording.codec')} size="sm" value={output.codec} onChange={codec => onChange({ codec })} options={[{ value: 'h264', label: 'H.264' }, { value: 'hevc', label: 'H.265' }]} /></UiFormRow>
      <UiFormRow label={t('recording.encoder')} info={t('recording.encoderInfo')} density="compact"><UiSegmented ariaLabel={t('recording.encoder')} size="sm" value={encoders.includes(output.encoder) ? output.encoder : 'auto'} onChange={encoder => onChange({ encoder })} options={encoders.map(encoder => ({ value: encoder, label: encoderLabels[encoder] }))} /></UiFormRow>
    </>}
  </>
}
