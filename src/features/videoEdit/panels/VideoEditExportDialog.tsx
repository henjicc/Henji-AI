import { useEffect, useState, useSyncExternalStore } from 'react'
import { UiButton, UiCheckbox, UiError, UiFormRow, UiGroup, UiInput, UiLoading, UiModal, UiSelect } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import { enqueueVideoEditExports, videoEditExportQueue } from '../application/videoEditExportQueue'
import { videoEditExportPresetLibrary } from '../application/videoEditExportPresets'
import { requireVideoEditInstance, subscribeVideoEdit, videoEditExportRange, videoEditRevision } from '../application/videoEditService'
import { VideoEditLoudnessFields } from './VideoEditLoudnessFields'
import { VideoEditExportQueueList } from './VideoEditExportQueueList'
import { videoEditUserErrorMessage } from '../application/videoEditUserError'
import { selectVideoEditExportEncoder } from '../engine/videoEditExportEncoder'

export function VideoEditExportDialog({ projectId, onClose }: { projectId: string; onClose: () => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const owner = requireVideoEditInstance(projectId)
  const presets = videoEditExportPresetLibrary.list()
  const [presetId, setPresetId] = useState('builtin:bilibili')
  const [settings, setSettings] = useState<VideoEditExportSettings>(() => presets.find(value => value.id === presetId)!.settings)
  const [sequenceId, setSequenceId] = useState(owner.activeSequenceId)
  const [range, setRange] = useState(() => { try { return videoEditExportRange(owner) } catch { return { startFrame: 0, endFrame: 1 } } })
  const [advanced, setAdvanced] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const sequence = owner.document.sequences.find(sequence => sequence.id === sequenceId)
  const outputWidth = settings.keepSequenceSize && sequence ? Math.round(sequence.width * sequence.pixelAspectRatio.numerator / sequence.pixelAspectRatio.denominator) : settings.width
  const outputHeight = settings.keepSequenceSize && sequence ? sequence.height : settings.height
  const outputFps = settings.fps ?? (sequence ? sequence.frameRate.numerator / sequence.frameRate.denominator : 60)
  const needsProbe = settings.format === 'mp4' && (Math.max(outputWidth, outputHeight) > 4096 || outputFps > 60)
  const probeKey = needsProbe ? `${outputWidth}/${outputHeight}/${outputFps}/${settings.videoBitrateMbps}` : ''
  const [encoderSupport, setEncoderSupport] = useState({ key: '', error: '' })
  useEffect(() => {
    if (!probeKey) return
    let active = true
    void selectVideoEditExportEncoder({ width: outputWidth, height: outputHeight, frameRate: outputFps, bitrate: settings.videoBitrateMbps * 1_000_000 }).then(
      () => { if (active) setEncoderSupport({ key: probeKey, error: '' }) },
      reason => { if (active) setEncoderSupport({ key: probeKey, error: videoEditUserErrorMessage(reason) }) },
    )
    return () => { active = false }
  }, [probeKey, outputWidth, outputHeight, outputFps, settings.videoBitrateMbps])
  const encoderError = probeKey && encoderSupport.key === probeKey ? encoderSupport.error : ''
  const canExport = Boolean(sequence?.clips.length) && (!probeKey || encoderSupport.key === probeKey && !encoderError)
  const patch = (values: Partial<VideoEditExportSettings>): void => setSettings(previous => ({ ...previous, ...values }))
  const selectPreset = (id: string): void => { const value = presets.find(value => value.id === id); if (value) { setPresetId(id); setSettings(value.settings) } }
  const selectSequence = (id: string): void => { setSequenceId(id); try { setRange(videoEditExportRange(owner, id)); setError('') } catch (reason) { setError(videoEditUserErrorMessage(reason)) } }
  const submit = async (wait: boolean): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      const jobs = await enqueueVideoEditExports([{ projectId, sequenceId, presetId, settings, range }])
      if (!jobs.length) return
      if (wait) {
        const job = await videoEditExportQueue.wait(jobs[0].id)
        if (job.state === 'failed') throw new Error(job.error)
        if (job.state === 'completed') onClose()
      } else setNotice('已加入导出队列，可继续添加另一份。')
    } catch (reason) { setError(videoEditUserErrorMessage(reason)) }
    finally { setBusy(false) }
  }
  const savePreset = (): void => {
    try { const value = videoEditExportPresetLibrary.save(name, settings); setPresetId(value.id); setName(''); setNotice('自定义预设已保存。'); setError('') }
    catch (reason) { setError(videoEditUserErrorMessage(reason)) }
  }
  return <UiModal isOpen title="导出" onClose={() => { if (!busy) onClose() }} footer={<><UiButton disabled={busy} onClick={onClose}>关闭</UiButton><UiButton variant="secondary" disabled={busy || !canExport} onClick={() => void submit(false)}>加入队列</UiButton><UiButton variant="primary" disabled={busy || !canExport} onClick={() => void submit(true)}>{busy ? '正在处理…' : '立即导出'}</UiButton></>}>
    <UiGroup>
      <UiFormRow label="序列" inline><UiSelect aria-label="导出序列" value={sequenceId} disabled={busy} onChange={event => selectSequence(event.target.value)}>{owner.document.sequences.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</UiSelect></UiFormRow>
      <UiFormRow label="预设" inline><UiSelect aria-label="导出预设" value={presetId} disabled={busy} onChange={event => selectPreset(event.target.value)}>{presets.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</UiSelect></UiFormRow>
      {settings.format === 'mp4' && <UiFormRow label="画幅处理" info="适合和留黑边保留完整画面；填充会按中心裁切画面边缘。" inline><UiSelect aria-label="画幅处理" value={settings.fit} disabled={busy} onChange={event => patch({ fit: event.target.value as VideoEditExportSettings['fit'] })}><option value="fit">适合</option><option value="fill">填充（裁切）</option><option value="letterbox">留黑边</option></UiSelect></UiFormRow>}
      <p className="text-xs text-text2">{settings.format === 'mp4' ? `${settings.keepSequenceSize ? '原画幅' : `${settings.width} × ${settings.height}`} · ${settings.fps ?? '序列'} fps · ${settings.videoBitrateMbps} Mbps` : settings.format === 'wav' ? 'WAV · 24 位无损声音' : `AAC · ${settings.audioBitrateKbps} kbps`}{settings.loudness ? ` · ${settings.loudness.targetLufs} LUFS` : ' · 保持时间线音量'}</p>
      <UiButton aria-expanded={advanced} disabled={busy} onClick={() => setAdvanced(value => !value)}>高级设置</UiButton>
      {advanced && <UiGroup>
        <UiFormRow label="格式" inline><UiSelect aria-label="导出格式" value={settings.format} onChange={event => patch({ format: event.target.value as VideoEditExportSettings['format'] })}><option value="mp4">MP4 视频</option><option value="aac">AAC 音频</option><option value="wav">WAV 音频</option></UiSelect></UiFormRow>
        {settings.format === 'mp4' && <>
          <UiFormRow label="保持序列画幅" inline><UiCheckbox checked={settings.keepSequenceSize ?? false} onCheckedChange={keepSequenceSize => patch({ keepSequenceSize })} /></UiFormRow>
          {!settings.keepSequenceSize && <UiFormRow label="分辨率"><div className="flex flex-wrap items-center gap-2"><NumberInput ariaLabel="导出宽度" value={settings.width} min={16} max={7680} step={2} widthClassName="w-24" onChange={width => patch({ width })} /><span>×</span><NumberInput ariaLabel="导出高度" value={settings.height} min={16} max={7680} step={2} widthClassName="w-24" onChange={height => patch({ height })} /></div></UiFormRow>}
          <UiFormRow label="帧率"><div className="flex flex-wrap items-center gap-2"><UiCheckbox checked={settings.fps === null} onCheckedChange={checked => patch({ fps: checked ? null : 30 })} aria-label="保持序列帧率" /><span>保持序列</span>{settings.fps !== null && <NumberInput ariaLabel="导出帧率" value={settings.fps} min={1} max={120} step={1} widthClassName="w-24" onChange={fps => patch({ fps })} />}</div></UiFormRow>
          <UiFormRow label="视频码率 Mbps" inline><NumberInput ariaLabel="视频码率 Mbps" value={settings.videoBitrateMbps} min={.1} max={200} step={1} precision={1} widthClassName="w-24" onChange={videoBitrateMbps => patch({ videoBitrateMbps })} /></UiFormRow>
        </>}
        {settings.format !== 'wav' && <UiFormRow label="音频码率 kbps" inline><NumberInput ariaLabel="音频码率 kbps" value={settings.audioBitrateKbps} min={32} max={512} step={32} widthClassName="w-24" onChange={audioBitrateKbps => patch({ audioBitrateKbps })} /></UiFormRow>}
        <UiFormRow label="入点（帧）" inline><NumberInput ariaLabel="导出入点" value={range.startFrame} min={0} widthClassName="w-24" onChange={startFrame => setRange(value => ({ ...value, startFrame }))} /></UiFormRow>
        <UiFormRow label="出点（帧）" info="导出到此帧之前，不包含此帧。" inline><NumberInput ariaLabel="导出出点" value={range.endFrame} min={1} widthClassName="w-24" onChange={endFrame => setRange(value => ({ ...value, endFrame }))} /></UiFormRow>
        <UiFormRow label="响度标准化" info="仅调整这次导出的整片声音，不改变时间线或预览音量。" inline><UiCheckbox checked={Boolean(settings.loudness)} onCheckedChange={enabled => patch({ loudness: enabled ? { targetLufs: -14, truePeakDbtp: -1 } : null })} /></UiFormRow>
        {settings.loudness && <><VideoEditLoudnessFields target={settings.loudness.targetLufs} onTarget={targetLufs => patch({ loudness: { targetLufs, truePeakDbtp: settings.loudness!.truePeakDbtp } })} /><UiFormRow label="真峰值上限 dBTP" inline><NumberInput ariaLabel="真峰值上限 dBTP" value={settings.loudness.truePeakDbtp} min={-8} max={0} step={.1} precision={1} widthClassName="w-24" onChange={truePeakDbtp => patch({ loudness: { targetLufs: settings.loudness!.targetLufs, truePeakDbtp } })} /></UiFormRow></>}
        <UiFormRow label="保存为自定义预设"><div className="flex min-w-0 flex-wrap gap-2"><UiInput aria-label="自定义预设名称" value={name} onChange={event => setName(event.target.value)} /><UiButton disabled={!name.trim()} onClick={savePreset}>保存</UiButton></div></UiFormRow>
      </UiGroup>}
      {notice && <p role="status" className="text-xs text-text2">{notice}</p>}
      {busy && <UiLoading size="xs" message="正在处理导出…" />}
      {(error || encoderError) && <UiError message={error || encoderError} />}
    </UiGroup>
    <VideoEditExportQueueList />
  </UiModal>
}
