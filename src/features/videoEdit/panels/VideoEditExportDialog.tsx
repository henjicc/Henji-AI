import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Dropdown, PanelTrigger, UiButton, UiEmpty, UiError, UiIconButton, UiInput, UiLoading, UiModal, UiOptionButton, UiRangeInput } from '@/components/ui'
import { videoEditComposition, videoEditDuration } from '@/core/videoEdit/document'
import { VIDEO_EDIT_DEFAULT_EXPORT_PRESET_ID, patchVideoEditExportSettings, resolveVideoEditExportSettings, videoEditExportEstimatedBytes, videoEditSequenceExportSettings, type VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import { createLogger } from '@/core/logging'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { getPlatform } from '@/platform/runtime'
import { enqueueVideoEditExports, videoEditExportQueue } from '../application/videoEditExportQueue'
import { videoEditExportPresetLibrary } from '../application/videoEditExportPresets'
import { requireVideoEditInstance, subscribeVideoEdit, videoEditExportRange, videoEditRevision } from '../application/videoEditService'
import { readVideoEditProxyState, refreshVideoEditProxies } from '../application/videoEditProxy'
import { videoEditUserErrorMessage } from '../application/videoEditUserError'
import { canEncodeVideoEditExport } from '../engine/videoEditExportEncoder'
import { VideoEditExportField, VideoEditExportFields } from './VideoEditExportFields'
import { VideoEditExportPreview } from './VideoEditExportPreview'
import { VideoEditExportQueueList } from './VideoEditExportQueueList'

const logger = createLogger('features.videoEdit.exportDialog')

export function VideoEditExportDialog({ projectId, onClose }: { projectId: string; onClose: () => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const owner = requireVideoEditInstance(projectId)
  const [sequenceId] = useState(owner.activeSequenceId)
  if (!owner.document.sequences.some(sequence => sequence.id === sequenceId)) return <UiModal isOpen title="导出" onClose={onClose} footer={<><UiButton variant="secondary" disabled>加入队列</UiButton><UiButton variant="primary" disabled>导出</UiButton></>}><UiEmpty title="请先打开序列" /></UiModal>
  return <VideoEditSequenceExportDialog projectId={projectId} sequenceId={sequenceId} onClose={onClose} />
}

function VideoEditSequenceExportDialog({ projectId, sequenceId, onClose }: { projectId: string; sequenceId: string; onClose: () => void }): React.ReactElement {
  const owner = requireVideoEditInstance(projectId)
  const composition = useMemo(() => videoEditComposition(owner.document, sequenceId), [owner.document, sequenceId])
  const presets = videoEditExportPresetLibrary.list()
  const [presetId, setPresetId] = useState(VIDEO_EDIT_DEFAULT_EXPORT_PRESET_ID)
  const [raw, setRaw] = useState(() => videoEditSequenceExportSettings(composition))
  const settings = useMemo(() => resolveVideoEditExportSettings(raw, composition), [raw, composition])
  const [fileName, setFileName] = useState(`${composition.name.replace(/[\\/:*?"<>|]/g, '-')}.mp4`)
  const [directory, setDirectory] = useState('')
  const [rangeMode, setRangeMode] = useState('sequence')
  const duration = videoEditDuration(composition)
  const marks = sequenceId === owner.activeSequenceId ? owner : owner.sequenceViews.get(sequenceId)
  const hasMarks = marks?.inFrame !== null && marks?.inFrame !== undefined && marks?.outFrame !== null && marks?.outFrame !== undefined && marks.outFrame > marks.inFrame && marks.outFrame <= duration
  const range = rangeMode === 'marks' && hasMarks ? videoEditExportRange(owner, sequenceId) : { startFrame: 0, endFrame: duration }
  const [frame, setFrame] = useState(Math.min(Math.max(0, owner.frame), Math.max(0, duration - 1)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [notice, setNotice] = useState('')
  const [presetAction, setPresetAction] = useState<'save' | 'rename' | null>(null)
  const [presetName, setPresetName] = useState('')
  const [showQueue, setShowQueue] = useState(false)
  const probeKey = `${settings.width}/${settings.height}/${settings.fps}/${settings.videoBitrateMbps}`
  const [probe, setProbe] = useState<{ key: string; supported: Record<string, boolean>; error?: string }>({ key: '', supported: {} })
  useEffect(() => {
    let active = true
    const combinations = (['avc', 'hevc'] as const).flatMap(codec => (['hardware', 'software'] as const).flatMap(encoderPreference => (['vbr', 'cbr'] as const).map(bitrateMode => ({ codec, encoderPreference, bitrateMode }))))
    void Promise.all(combinations.map(async value => [`${value.codec}/${value.encoderPreference}/${value.bitrateMode}`, await canEncodeVideoEditExport({ ...value, width: settings.width, height: settings.height, frameRate: settings.fps!, bitrate: settings.videoBitrateMbps * 1_000_000 })] as const)).then(
      values => { if (active) setProbe({ key: probeKey, supported: Object.fromEntries(values) }) },
      reason => { if (active) setProbe({ key: probeKey, supported: {}, error: videoEditUserErrorMessage(reason) }) },
    )
    return () => { active = false }
  }, [probeKey, settings.width, settings.height, settings.fps, settings.videoBitrateMbps])
  useEffect(() => { let active = true; void refreshVideoEditProxies(projectId).catch(reason => { if (active) setError(videoEditUserErrorMessage(reason)) }); return () => { active = false } }, [projectId])
  const support = (codec: VideoEditExportSettings['codec'], preference: VideoEditExportSettings['encoderPreference'], mode: VideoEditExportSettings['bitrateMode']): boolean => probe.key === probeKey && Boolean(probe.supported[`${codec}/${preference}/${mode}`])
  const probing = probe.key !== probeKey
  const codecChoice = (codec: VideoEditExportSettings['codec']): Pick<VideoEditExportSettings, 'codec' | 'encoderPreference' | 'bitrateMode'> | undefined => {
    for (const encoderPreference of [settings.encoderPreference, settings.encoderPreference === 'hardware' ? 'software' as const : 'hardware' as const]) {
      for (const bitrateMode of [settings.bitrateMode, settings.bitrateMode === 'vbr' ? 'cbr' as const : 'vbr' as const]) {
        if (support(codec, encoderPreference, bitrateMode)) return { codec, encoderPreference, bitrateMode }
      }
    }
    return undefined
  }
  const encoderError = settings.videoEnabled && !probing && !support(settings.codec, settings.encoderPreference, settings.bitrateMode) ? probe.error ?? `当前设备不支持所选编码设置。${settings.codec === 'avc' ? '请尝试 HEVC，或' : '请'}降低规格、切换性能或码率模式。` : ''
  const canExport = !settingsError && duration > 0 && Boolean(fileName.trim()) && !/[\\/:*?"<>|]/.test(fileName) && !/^\.+$/.test(fileName) && (!settings.videoEnabled || !probing && !encoderError)
  const patch = (values: Partial<VideoEditExportSettings>): void => {
    try {
      const next = resolveVideoEditExportSettings(patchVideoEditExportSettings(settings, values), composition); setRaw(next); setPresetId('custom'); setError(''); setSettingsError('')
      if (next.format !== settings.format) setFileName(value => `${value.replace(/\.[^./\\]+$/, '')}.${next.format}`)
    } catch (reason) { setSettingsError('此设置超出可导出的规格，请使用偶数宽高并保持在 8K 范围内。'); logger.warn('导出设置未接受', { event: 'video_edit.export.settings_rejected', error: reason }) }
  }
  const selectPreset = (id: string): void => {
    const value = presets.find(value => value.id === id); if (!value) return
    const next = id === VIDEO_EDIT_DEFAULT_EXPORT_PRESET_ID ? videoEditSequenceExportSettings(composition) : resolveVideoEditExportSettings(value.settings, composition)
    setPresetId(id); setRaw(next); setSettingsError(''); setFileName(name => `${name.replace(/\.[^./\\]+$/, '')}.${next.format}`)
  }
  const chooseDirectory = async (): Promise<void> => {
    try { const selected = await getPlatform().system.dialog.open({ directory: true, multiple: false }); const path = Array.isArray(selected) ? selected[0] : selected; if (path) setDirectory(path); setError('') } catch (reason) { setError(videoEditUserErrorMessage(reason)) }
  }
  const submit = async (wait: boolean): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      const name = `${fileName.replace(/\.(mp4|aac|wav)$/i, '')}.${settings.format}`
      const path = directory ? await getPlatform().system.paths.join(directory, name) : undefined
      const jobs = await enqueueVideoEditExports([{ projectId, sequenceId, ...(presetId !== 'custom' ? { presetId } : {}), settings, range, path, fileName: name }])
      if (!jobs.length) return
      if (wait) { const job = await videoEditExportQueue.wait(jobs[0].id); if (job.state === 'failed') throw new Error(job.error); if (job.state === 'completed') onClose() }
      else setNotice('已加入导出队列，可继续添加另一份。')
    } catch (reason) { setError(videoEditUserErrorMessage(reason)) } finally { setBusy(false) }
  }
  const savePreset = (): void => {
    try { const value = presetAction === 'rename' ? videoEditExportPresetLibrary.update(presetId, { name: presetName }) : videoEditExportPresetLibrary.save(presetName, settings); setPresetId(value.id); setPresetAction(null); setError('') } catch (reason) { setError(videoEditUserErrorMessage(reason)) }
  }
  const hasProxies = composition.clips.some(clip => { const mediaId = composition.items.find(item => item.id === clip.itemId)?.mediaId; return mediaId && readVideoEditProxyState(projectId, mediaId).status === 'ready' })
  const seconds = (range.endFrame - range.startFrame) / composition.fps
  const bytes = videoEditExportEstimatedBytes(settings, seconds)
  const estimated = bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(1)} MB`
  const customPreset = presets.some(value => value.id === presetId && !value.id.startsWith('builtin:'))
  return <>
    <UiModal isOpen title="导出" size="editor" contentClassName="overflow-hidden" onClose={onClose} footer={<><UiButton variant="secondary" disabled={busy || !canExport} onClick={() => void submit(false)}>加入队列</UiButton><UiButton variant="primary" disabled={busy || !canExport} onClick={() => void submit(true)}>{busy ? '正在导出…' : '导出'}</UiButton></>}>
      <div className="flex min-h-0 flex-1">
        <div className="w-80 shrink-0 overflow-y-auto border-r border-line">
          <div className="space-y-2 px-3 py-3">
            <VideoEditExportField label="文件名"><UiInput size="sm" aria-label="导出文件名" value={fileName} disabled={busy} onChange={event => setFileName(event.target.value)} /></VideoEditExportField>
            <VideoEditExportField label="位置"><UiButton variant="link" disabled={busy} aria-label="选择导出目录" className="max-w-full" onClick={() => void chooseDirectory()}><span className="truncate" data-observation-sensitive={directory ? 'true' : undefined} title={directory}>{directory || '选择目录…'}</span></UiButton></VideoEditExportField>
            <VideoEditExportField label="预设" lock={<PanelTrigger size="sm" panelWidth="content" closeOnPanelClick panelPadding="menu" renderPanel={() => <>
              <UiOptionButton variant="menu" disabled={busy} onClick={() => { setPresetName(''); setPresetAction('save') }}>保存当前设置为预设</UiOptionButton>
              <UiOptionButton variant="menu" disabled={busy || !customPreset} onClick={() => { setPresetName(presets.find(value => value.id === presetId)!.name); setPresetAction('rename') }}>重命名</UiOptionButton>
              <UiOptionButton variant="menu" disabled={busy || !customPreset} onClick={() => { try { videoEditExportPresetLibrary.remove(presetId); setPresetId('custom'); setError('') } catch (reason) { setError(videoEditUserErrorMessage(reason)) } }}>删除自定义预设</UiOptionButton>
            </>}>{controls => <UiIconButton size="sm" aria-label="管理导出预设" disabled={busy} onClick={controls.togglePanel}><MoreHorizontal className="h-4 w-4" /></UiIconButton>}</PanelTrigger>}><Dropdown size="sm" ariaLabel="导出预设" value={presetId} minWidthStrategy="none" disabled={busy} options={[...presets.map(value => ({ value: value.id, label: value.name })), { value: 'custom', label: '自定义', disabled: true }]} onSelect={selectPreset} /></VideoEditExportField>
            <VideoEditExportField label="格式"><Dropdown size="sm" ariaLabel="导出格式" value={settings.videoEnabled ? settings.codec : settings.format} minWidthStrategy="none" disabled={busy} options={[
              ...(['avc', 'hevc'] as const).map(codec => ({ value: codec, label: codec === 'avc' ? 'MP4 · H.264' : 'MP4 · HEVC (H.265)', disabled: probing || !codecChoice(codec), tooltip: !codecChoice(codec) ? codec === 'avc' ? '当前规格不支持 H.264；8K 请尝试 HEVC，或降低规格。' : '当前规格不支持 HEVC；请降低规格。' : !support(codec, settings.encoderPreference, settings.bitrateMode) ? '选择后使用本机可用的性能与码率模式，请检查编码分区。' : undefined })),
              { value: 'aac', label: '音频 · AAC' }, { value: 'wav', label: '音频 · WAV' },
            ]} onSelect={value => value === 'avc' || value === 'hevc' ? patch({ format: 'mp4', ...codecChoice(value) }) : patch({ format: value as 'aac' | 'wav' })} /></VideoEditExportField>
          </div>
          <VideoEditExportFields viewer={owner} settings={settings} busy={busy} hasProxies={hasProxies} patch={patch} probing={probing} support={support} matchSequence={() => patch({ followSequence: { resolution: true, fps: true, sampleRate: true, channels: true } })} />
          <div className="space-y-2 px-3 pb-3">
            {notice && <p role="status" className="text-xs text-text2">{notice}</p>}
            {(notice || busy || error) && videoEditExportQueue.list().length > 0 && <UiButton size="sm" onClick={() => setShowQueue(true)}>查看导出队列</UiButton>}
            {busy && <UiLoading size="xs" message="正在处理导出…" />}
            {(error || settingsError || encoderError) && <UiError size="xs" message={error || settingsError || encoderError} />}
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
          <VideoEditExportPreview projectId={projectId} composition={composition} settings={settings} frame={Math.max(0, Math.min(duration - 1, frame))} />
          <UiRangeInput aria-label="导出预览时刻" min={0} max={Math.max(0, duration - 1)} step={1} value={frame} disabled={!settings.videoEnabled || duration === 0} onChange={event => setFrame(Number(event.target.value))} />
          <div className="flex items-center gap-2"><span className="text-xs text-text2">范围</span><Dropdown size="sm" ariaLabel="导出范围" value={rangeMode === 'marks' && hasMarks ? 'marks' : 'sequence'} className="w-36" disabled={busy} options={[{ value: 'sequence', label: '整个序列' }, { value: 'marks', label: '入点到出点', disabled: !hasMarks, tooltip: !hasMarks ? '请先在时间线设置有效的入点和出点。' : undefined }]} onSelect={setRangeMode} /><span aria-label="导出时长" className="ml-auto font-mono text-xs text-text2">{videoEditFrameTimecode(range.endFrame - range.startFrame, composition.fps)}</span></div>
          <div className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs text-text2">
            <div className="min-w-0"><p className="mb-1 font-medium text-text1">来源</p><p>{composition.width} × {composition.height} · {Number(composition.fps.toFixed(3))} 帧 · {composition.sampleRate / 1000} kHz {composition.channels === 2 ? '立体声' : '单声道'}</p></div>
            <div className="min-w-0"><p className="mb-1 font-medium text-text1">输出</p><p>{settings.videoEnabled ? `${settings.codec === 'avc' ? 'H.264' : 'HEVC'} · ${settings.width} × ${settings.height} · ${Number(settings.fps!.toFixed(3))} 帧 · ${settings.videoBitrateMbps} Mbps` : ''}{settings.audioEnabled ? `${settings.videoEnabled ? ' · ' : ''}${settings.audioCodec === 'aac' ? `AAC ${settings.audioBitrateKbps} kbps` : 'WAV 24 位 PCM'} · ${settings.sampleRate / 1000} kHz ${settings.channels === 2 ? '立体声' : '单声道'}` : ' · 无声'}</p><p className="mt-1">预计大小约 {estimated}</p></div>
          </div>
        </div>
      </div>
    </UiModal>
    {presetAction && <UiModal isOpen title={presetAction === 'save' ? '保存导出预设' : '重命名导出预设'} onClose={() => setPresetAction(null)} footer={<UiButton variant="primary" disabled={!presetName.trim()} onClick={savePreset}>保存</UiButton>}><UiInput aria-label="自定义预设名称" value={presetName} onChange={event => setPresetName(event.target.value)} />{error && <UiError message={error} />}</UiModal>}
    {showQueue && <UiModal isOpen title="导出队列" onClose={() => setShowQueue(false)}><VideoEditExportQueueList /></UiModal>}
  </>
}
