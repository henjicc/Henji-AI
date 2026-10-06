import { useEffect, useRef, useState } from 'react'
import { UiButton, UiError, UiFormRow, UiGroup, UiLoading, UiModal, UiSelect } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditGainMode, VideoEditLoudnessMeasurement } from '@/core/videoEdit/loudness'
import { applyVideoEditAudioGain, measureVideoEditClips, type VideoEditGainTarget } from '../application/videoEditLoudness'
import { VideoEditLoudnessFields } from './VideoEditLoudnessFields'
import { videoEditUserErrorMessage } from '../application/videoEditUserError'

export function VideoEditAudioGainDialog({ target, onClose }: { target: VideoEditGainTarget; onClose: () => void }): React.ReactElement {
  const [mode, setMode] = useState<VideoEditGainMode>('adjust')
  const [value, setValue] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [measurements, setMeasurements] = useState<VideoEditLoudnessMeasurement[]>([])
  const operation = useRef<AbortController>()
  useEffect(() => () => operation.current?.abort(), [])
  const close = (): void => { operation.current?.abort(); onClose() }
  const run = async (apply: boolean): Promise<void> => {
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError('')
    try {
      if (apply) { await applyVideoEditAudioGain(target, mode, value, controller.signal); if (!controller.signal.aborted) onClose() }
      else { const results = await measureVideoEditClips(target, controller.signal); if (!controller.signal.aborted) setMeasurements(results) }
    } catch (reason) { if (!controller.signal.aborted) setError(videoEditUserErrorMessage(reason)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const format = (value: number | null, unit: string): string => value === null ? '无法测量' : `${value.toFixed(1)} ${unit}`
  return <UiModal isOpen title="音频增益" onClose={close} footer={<><UiButton onClick={close}>{busy ? '取消处理' : '取消'}</UiButton><UiButton variant="primary" disabled={busy} onClick={() => void run(true)}>确定</UiButton></>}>
    <div className="space-y-4">
      <UiGroup>
        <UiFormRow label="增益方式" inline><UiSelect aria-label="增益方式" disabled={busy} value={mode} onChange={event => { const next = event.target.value as VideoEditGainMode; setMode(next); setValue(next === 'loudness' ? -14 : next.startsWith('peak') ? -1 : 0) }}>
          <option value="set">将增益设置为</option><option value="adjust">调整增益值</option><option value="peak_max">标准化最大峰值为</option><option value="peak_all">标准化所有峰值为</option><option value="loudness">响度标准化到</option>
        </UiSelect></UiFormRow>
        {mode === 'loudness' ? <VideoEditLoudnessFields target={value} onTarget={setValue} /> : <UiFormRow label={mode.startsWith('peak') ? '目标峰值' : '增益'} inline><div className="flex items-center gap-2"><NumberInput ariaLabel="增益 dB" value={value} min={-96} max={mode.startsWith('peak') ? 0 : mode === 'set' ? 6.02 : 96} step={.5} precision={2} widthClassName="w-24" onChange={setValue} /><span>{mode.startsWith('peak') ? 'dBFS' : 'dB'}</span></div></UiFormRow>}
        <UiButton disabled={busy} onClick={() => void run(false)}>测量所选声音</UiButton>
      </UiGroup>
      {busy && <UiLoading message="正在处理声音…" />}
      {measurements.length > 0 && <UiGroup title="测量结果">{measurements.map((measurement, index) => <p key={index} className="text-xs text-text2">声音 {index + 1}：积分 {format(measurement.integratedLufs, 'LUFS')} · 短期 {format(measurement.shortTermLufs, 'LUFS')} · 真峰值 {format(measurement.truePeakDbtp, 'dBTP')}</p>)}</UiGroup>}
      {error && <UiError message={error} />}
    </div>
  </UiModal>
}
