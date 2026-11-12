import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ZodError } from 'zod'
import { hardwareEncodeLimitation } from '@/services/mediaCache/hardwareCapabilities'
import { Dropdown, UiButton, UiEmpty, UiError, UiGroup, UiInput, UiLoading, UiModal, UiRangeInput } from '@/components/ui'
import { videoEditComposition, videoEditDuration } from '@/core/videoEdit/document'
import { VIDEO_EDIT_DEFAULT_EXPORT_PRESET_ID, applyVideoEditExportQuality, patchVideoEditExportSettings, resolveVideoEditExportSettings, videoEditExportChangedFields, videoEditExportEstimatedBytes, videoEditExportPresetModified, videoEditExportQualityOf, videoEditSequenceExportSettings, type VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import type { VideoEditExportCapabilities, VideoEditExportQuality } from '@/core/videoEdit/exportEncoding'
import { createLogger } from '@/core/logging'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { formatFileSize, formatFrameRate, formatKbps, formatMbps, formatSampleRate, videoCodecLabel } from '@/core/format/specFormat'
import { getPlatform } from '@/platform/runtime'
import { enqueueVideoEditExports, videoEditExportQueue } from '../application/videoEditExportQueue'
import { videoEditExportPresetLibrary } from '../application/videoEditExportPresets'
import { videoEditExportMemory } from '../application/videoEditExportMemory'
import { requireVideoEditInstance, subscribeVideoEdit, videoEditExportRange, videoEditRevision } from '../application/videoEditService'
import { readVideoEditProxyState, refreshVideoEditProxies } from '../application/videoEditProxy'
import { videoEditUserErrorMessage } from '../application/videoEditUserError'
import { adaptVideoEditExportPreset, probeVideoEditExport, probeVideoEditExportAudioBitrates, videoEditExportProbeKey, type VideoEditExportSupport } from '../engine/videoEditExportEncoder'
import { VideoEditExportField, VideoEditExportFields } from './VideoEditExportFields'
import { VIDEO_EDIT_EXPORT_QUALITY_LABELS } from './videoEditExportUi'
import { VideoEditExportPresetMenu } from './VideoEditExportPresetMenu'
import { VideoEditExportPreview } from './VideoEditExportPreview'
import { VideoEditExportQueueList } from './VideoEditExportQueueList'
import { VideoEditFontWarnings } from './VideoEditFontWarnings'

const logger = createLogger('features.videoEdit.exportDialog')

export function VideoEditExportDialog({ projectId, onClose }: { projectId: string; onClose: () => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const owner = requireVideoEditInstance(projectId)
  const [sequenceId] = useState(owner.activeSequenceId)
  if (!owner.document.sequences.some(sequence => sequence.id === sequenceId)) return <UiModal isOpen title="导出" onClose={onClose} footer={<><UiButton variant="secondary" disabled>加入队列</UiButton><UiButton variant="primary" disabled>导出</UiButton></>}><UiEmpty title="请先打开序列" /></UiModal>
  return <VideoEditSequenceExportDialog projectId={projectId} sequenceId={sequenceId} onClose={onClose} />
}

const withExtension = (name: string, format: string): string => `${name.replace(/\.[^./\\]+$/, '')}.${format}`
/** 默认的“与序列一致”带着响度设置但不算主动要求；其他预设带响度即要求标准化。 */
const presetRequestsLoudness = (presetId: string, settings: VideoEditExportSettings): boolean => presetId !== VIDEO_EDIT_DEFAULT_EXPORT_PRESET_ID && Boolean(settings.loudness)
const differs = (settings: VideoEditExportSettings, baseline: VideoEditExportSettings): boolean => videoEditExportPresetModified(settings, { id: 'baseline', name: 'baseline', settings: baseline })

function VideoEditSequenceExportDialog({ projectId, sequenceId, onClose }: { projectId: string; sequenceId: string; onClose: () => void }): React.ReactElement {
  const owner = requireVideoEditInstance(projectId)
  const composition = useMemo(() => videoEditComposition(owner.document, sequenceId), [owner.document, sequenceId])
  const presets = videoEditExportPresetLibrary.list()
  const [initial] = useState(() => {
    try {
      const entry = videoEditExportMemory.read(projectId, sequenceId)
      if (entry) resolveVideoEditExportSettings(entry.settings, composition)
      return { entry, error: '' }
    } catch (reason) { logger.warn('上次导出设置未恢复', { event: 'video_edit.export.memory_restore_failed', error: reason }); return { entry: undefined, error: videoEditUserErrorMessage(reason) } }
  })
  const memory = initial.entry
  const [presetId, setPresetId] = useState(() => memory ? presets.some(value => value.id === memory.presetId) ? memory.presetId : 'custom' : VIDEO_EDIT_DEFAULT_EXPORT_PRESET_ID)
  const [raw, setRaw] = useState(() => memory?.settings ?? videoEditSequenceExportSettings(composition))
  const settings = useMemo(() => resolveVideoEditExportSettings(raw, composition), [raw, composition])
  const preset = presets.find(value => value.id === presetId)
  const presetSettingsKey = JSON.stringify(preset?.settings ?? null)
  const presetDefaults = useMemo(() => {
    if (!preset) return undefined
    return preset.id === VIDEO_EDIT_DEFAULT_EXPORT_PRESET_ID ? videoEditSequenceExportSettings(composition) : resolveVideoEditExportSettings(preset.settings, composition)
    // presetSettingsKey 代表预设内容；预设被更新时需要重新得到基线
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, presetSettingsKey, composition])
  const adaptationKey = presetDefaults ? `${presetId}/${JSON.stringify(presetDefaults)}` : ''
  // 预设先解析序列再按设备适配，同一结果既是编辑初值也是“已修改”与恢复的基线；用户编辑不重建基线。
  const [baseline, setBaseline] = useState<{ key: string; presetId: string; settings?: VideoEditExportSettings; error: string }>({ key: '', presetId: '', error: '' })
  // 选了预设、或首次打开没有上次记录时，适配结果直接成为当前设置；从上次记录恢复的设置保持原样。
  const applyPreset = useRef<string | null>(memory ? null : presetId)
  const latest = useRef({ raw, baseline }); latest.current = { raw, baseline }
  useEffect(() => {
    if (!presetDefaults) return
    let active = true
    const settle = (next: VideoEditExportSettings, error: string): void => {
      if (!active) return
      const previous = latest.current.baseline
      // 序列规格变化导致基线重算时，未改过的设置跟着新基线走；改过的保留用户的值。
      const follow = applyPreset.current === presetId || previous.presetId === presetId && previous.settings !== undefined && !differs(latest.current.raw, previous.settings)
      setBaseline({ key: adaptationKey, presetId, settings: next, error })
      if (follow) setRaw(next)
      applyPreset.current = null
    }
    void adaptVideoEditExportPreset(presetDefaults).then(next => settle(next, ''), reason => settle(presetDefaults, videoEditUserErrorMessage(reason)))
    return () => { active = false }
  }, [presetDefaults, adaptationKey, presetId])
  const adapting = Boolean(presetDefaults && baseline.key !== adaptationKey)
  const baselinePreset = preset && !adapting && baseline.settings ? { ...preset, settings: baseline.settings } : undefined
  const modified = Boolean(baselinePreset && videoEditExportPresetModified(settings, baselinePreset))
  const changedEncoding = baselinePreset?.settings.encoding && settings.encoding ? videoEditExportChangedFields(settings, baselinePreset) : []
  const [capabilities, setCapabilities] = useState<{ value?: VideoEditExportCapabilities; error?: string }>({})
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => getPlatform().videoEditExport.capabilities()).then(
      value => { if (active) setCapabilities({ value }) },
      reason => { logger.warn('导出编码器检查失败', { event: 'video_edit.export.capabilities_failed', error: reason }); if (active) setCapabilities({ error: '无法检查本机编码器，请重新打开导出窗口重试。' }) },
    )
    return () => { active = false }
  }, [])
  const [fileName, setFileName] = useState(() => memory ? memory.requestedFileName ?? memory.fileName : `${composition.name.replace(/[\\/:*?"<>|]/g, '-')}.mp4`)
  const [directory, setDirectory] = useState(memory?.directory ?? '')
  const duration = videoEditDuration(composition)
  // 上次按指定区间导出的范围原样恢复；序列变短时夹到序列内，夹完为空或就是整片时按整个序列。
  const [rememberedRange] = useState(() => {
    if (memory?.rangeSource !== 'explicit') return undefined
    const startFrame = Math.min(memory.range.startFrame, duration), endFrame = Math.min(memory.range.endFrame, duration)
    return endFrame > startFrame && (startFrame > 0 || endFrame < duration) ? { startFrame, endFrame } : undefined
  })
  const [rangeMode, setRangeMode] = useState(memory?.rangeSource === 'in-out' ? 'marks' : rememberedRange ? 'remembered' : 'sequence')
  const marks = sequenceId === owner.activeSequenceId ? owner : owner.sequenceViews.get(sequenceId)
  const hasMarks = marks?.inFrame !== null && marks?.inFrame !== undefined && marks?.outFrame !== null && marks?.outFrame !== undefined && marks.outFrame > marks.inFrame && marks.outFrame <= duration
  const noMarks = (marks?.inFrame ?? null) === null && (marks?.outFrame ?? null) === null
  const shownRange = rangeMode === 'marks' && hasMarks ? 'marks' : rangeMode === 'remembered' && rememberedRange && rememberedRange.endFrame <= duration ? 'remembered' : 'sequence'
  const range = shownRange === 'marks' ? videoEditExportRange(owner, sequenceId) : shownRange === 'remembered' ? rememberedRange! : { startFrame: 0, endFrame: duration }
  const [frame, setFrame] = useState(Math.min(Math.max(0, owner.frame), Math.max(0, duration - 1)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initial.error)
  const [settingsError, setSettingsError] = useState('')
  const [notice, setNotice] = useState('')
  const [loudnessRequested, setLoudnessRequested] = useState(() => Boolean(memory && (memory.loudnessRequested ?? presetRequestsLoudness(memory.presetId, memory.settings))))
  const [presetAction, setPresetAction] = useState<'save' | 'rename' | null>(null)
  const [presetName, setPresetName] = useState('')
  const [showQueue, setShowQueue] = useState(false)
  const probeKey = videoEditExportProbeKey(settings)
  const [probe, setProbe] = useState<{ key: string; supported: Record<string, boolean>; current?: VideoEditExportSupport; error?: string }>({ key: '', supported: {} })
  useEffect(() => {
    let active = true
    const combinations = (['avc', 'hevc'] as const).flatMap(codec => (['hardware', 'software'] as const).flatMap(encoderPreference => (['vbr', 'cbr'] as const).map(bitrateMode => ({ codec, encoderPreference, bitrateMode }))))
    void Promise.all([probeVideoEditExport(settings), Promise.all(combinations.map(async value => [`${value.codec}/${value.encoderPreference}/${value.bitrateMode}`, (await probeVideoEditExport({ ...settings, ...value })).videoSupported] as const)),
      Promise.all((['auto', 1, 2] as const).map(async keyframeInterval => [`keyframe:${keyframeInterval}`, (await probeVideoEditExport({ ...settings, keyframeInterval })).videoSupported] as const)),
    ]).then(
      ([current, values, keyframes]) => {
        if (active) {
          logger.debug('导出面板编码检查完成', { event: 'video_edit.export.panel_probe_completed', context: { configuration: probeKey, supported: current.supported, reason: current.reason } })
          setProbe({ key: probeKey, current, supported: Object.fromEntries([...values, ...keyframes]) })
        }
      },
      reason => { if (active) setProbe({ key: probeKey, supported: {}, error: videoEditUserErrorMessage(reason) }) },
    )
    return () => { active = false }
  }, [probeKey, settings])
  const audioProbeKey = `${settings.audioEnabled}/${settings.audioCodec}/${settings.sampleRate}/${settings.channels}/${settings.audioBitrateKbps}`
  const [audioProbe, setAudioProbe] = useState<{ key: string; supported: Record<number, boolean>; error?: string }>({ key: '', supported: {} })
  useEffect(() => {
    if (!settings.audioEnabled || settings.audioCodec !== 'aac') return
    let active = true
    void probeVideoEditExportAudioBitrates(settings).then(
      supported => { if (active) setAudioProbe({ key: audioProbeKey, supported }) },
      reason => {
        logger.warn('导出音频支持检查失败', { event: 'video_edit.export.audio_probe_failed', error: reason })
        if (active) setAudioProbe({ key: audioProbeKey, supported: {}, error: '无法检查此设备的音频编码支持，请重试或改用 WAV。' })
      },
    )
    return () => { active = false }
  }, [audioProbeKey, settings])
  const audioProbing = settings.audioEnabled && settings.audioCodec === 'aac' && audioProbe.key !== audioProbeKey
  const audioSupport = (bitrate: number): boolean => audioProbe.key === audioProbeKey && Boolean(audioProbe.supported[bitrate])
  useEffect(() => { let active = true; void refreshVideoEditProxies(projectId).catch(reason => { if (active) setError(videoEditUserErrorMessage(reason)) }); return () => { active = false } }, [projectId])
  const support = (codec: VideoEditExportSettings['codec'], preference: VideoEditExportSettings['encoderPreference'], mode: VideoEditExportSettings['bitrateMode']): boolean => probe.key === probeKey && Boolean(probe.supported[`${codec}/${preference}/${mode}`])
  const keyframeSupport = (interval: VideoEditExportSettings['keyframeInterval']): boolean => probe.key === probeKey && Boolean(probe.supported[`keyframe:${interval}`])
  const probing = adapting || probe.key !== probeKey
  const codecChoice = (codec: VideoEditExportSettings['codec']): Pick<VideoEditExportSettings, 'codec' | 'encoderPreference' | 'bitrateMode'> | undefined => {
    for (const encoderPreference of [settings.encoderPreference, settings.encoderPreference === 'hardware' ? 'software' as const : 'hardware' as const]) {
      for (const bitrateMode of [settings.bitrateMode, settings.bitrateMode === 'vbr' ? 'cbr' as const : 'vbr' as const]) {
        if (support(codec, encoderPreference, bitrateMode)) return { codec, encoderPreference, bitrateMode }
      }
    }
    return undefined
  }
  // 预设适配失败只说明预设原样不可用；用户改过设置后以当前设置的探测结果为准。
  const encoderError = !probing ? probe.error ?? (presetDefaults && !modified && baseline.error || probe.current?.reason) ?? '' : ''
  const canExport = !settingsError && !probing && probe.current?.supported && !encoderError && duration > 0 && Boolean(fileName.trim()) && !/[\\/:*?"<>|]/.test(fileName) && !/^\.+$/.test(fileName)
  const patch = (values: Partial<VideoEditExportSettings>): void => {
    try {
      // 切回视频时保留原有画质设置（包括不压制的指定码率）
      const next = resolveVideoEditExportSettings(patchVideoEditExportSettings(settings, values), composition); setRaw(next); setError(''); setSettingsError('')
      applyPreset.current = null
      if ('loudness' in values) setLoudnessRequested(Boolean(next.loudness))
      if (next.format !== settings.format) setFileName(value => withExtension(value, next.format))
    } catch (reason) {
      const issue = reason instanceof ZodError ? reason.issues.find(value => value.path[0] === 'encoding') : undefined
      setSettingsError(reason instanceof ZodError ? issue?.message ?? '此设置超出可导出的规格，请使用偶数宽高并保持在 8K 范围内。' : videoEditUserErrorMessage(reason)); logger.warn('导出设置未接受', { event: 'video_edit.export.settings_rejected', error: reason })
    }
  }
  const selectQuality = (tier: VideoEditExportQuality): void => {
    // 指定码率是不经压制的直接编码，不依赖本机编码器检查
    if (tier === 'bitrate') { patch({ encoding: undefined }); return }
    if (!capabilities.value) return
    try { patch({ encoding: applyVideoEditExportQuality(settings, tier, capabilities.value).encoding }) } catch (reason) { setSettingsError(videoEditUserErrorMessage(reason)) }
  }
  const selectCodec = (codec: VideoEditExportSettings['codec']): void => {
    const next = patchVideoEditExportSettings(settings, { format: 'mp4', ...codecChoice(codec) })
    // 选了画质档时换格式仍保持同一档，并按本机能力重新挑选同格式的编码器
    const tier = videoEditExportQualityOf(settings)
    if (!next.encoding || tier === 'custom' || !capabilities.value) { patch(next); return }
    try { patch({ ...next, encoding: applyVideoEditExportQuality(next, tier, capabilities.value).encoding }) } catch (reason) { setSettingsError(videoEditUserErrorMessage(reason)) }
  }
  const selectPreset = (id: string): void => {
    const value = presets.find(value => value.id === id); if (!value) return
    if (id === presetId && baselinePreset) { restorePreset(); return }
    const next = id === VIDEO_EDIT_DEFAULT_EXPORT_PRESET_ID ? videoEditSequenceExportSettings(composition) : resolveVideoEditExportSettings(value.settings, composition)
    applyPreset.current = id
    setPresetId(id); setRaw(next); setSettingsError(''); setLoudnessRequested(presetRequestsLoudness(id, value.settings)); setFileName(name => withExtension(name, next.format))
  }
  /** 回到所选预设：与重新选择该预设得到同一份设置与响度要求。 */
  const restorePreset = (): void => {
    if (!baselinePreset || !preset) return
    setRaw(baselinePreset.settings); setSettingsError(''); setLoudnessRequested(presetRequestsLoudness(preset.id, preset.settings)); setFileName(name => withExtension(name, baselinePreset.settings.format))
  }
  const chooseDirectory = async (): Promise<void> => {
    try { const selected = await getPlatform().system.dialog.open({ directory: true, multiple: false }); const path = Array.isArray(selected) ? selected[0] : selected; if (path) setDirectory(path); setError('') } catch (reason) { setError(videoEditUserErrorMessage(reason)) }
  }
  const submit = async (wait: boolean): Promise<void> => {
    if (busy || !canExport) return
    setBusy(true); setError(''); setNotice('')
    try {
      const name = `${fileName.replace(/\.(mp4|aac|wav)$/i, '')}.${settings.format}`
      // 选了目录时由队列在目录里取不重名的文件：恢复上次文件名后直接导出不会撞上上一次的成片。
      // 入点到出点、以及没有入出点时的整个序列不传固定范围：记录的区间来源随之是入出点或整片，下次打开按同样方式恢复。
      const jobs = await enqueueVideoEditExports([{ rememberExport: true, projectId, sequenceId, ...(presetId !== 'custom' ? { presetId } : {}), settings, loudnessRequested, ...(shownRange === 'marks' || shownRange === 'sequence' && noMarks ? {} : { range }), ...(directory ? { outputDirectory: async () => directory } : {}), fileName: name }])
      if (!jobs.length) return
      if (wait) { const job = await videoEditExportQueue.wait(jobs[0].id); if (job.state === 'failed') throw new Error(job.error); if (job.state === 'completed') onClose() }
      else setNotice('已加入导出队列，可继续添加另一份。')
    } catch (reason) { setError(videoEditUserErrorMessage(reason)) } finally { setBusy(false) }
  }
  const savePreset = (): void => {
    try { const value = presetAction === 'rename' ? videoEditExportPresetLibrary.update(presetId, { name: presetName }) : videoEditExportPresetLibrary.save(presetName, settings); if (presetAction === 'save') applyPreset.current = value.id; setPresetId(value.id); setPresetAction(null); setError('') } catch (reason) { setError(videoEditUserErrorMessage(reason)) }
  }
  const customPreset = Boolean(preset && !preset.id.startsWith('builtin:'))
  const presetActions = busy ? [] : [
    ...(modified ? [{ label: '恢复为预设', run: restorePreset }] : []),
    ...(modified && customPreset ? [{ label: '更新当前预设', run: () => { try { videoEditExportPresetLibrary.update(presetId, { settings }); applyPreset.current = presetId; setError('') } catch (reason) { setError(videoEditUserErrorMessage(reason)) } } }] : []),
    { label: '另存为新预设', run: () => { setPresetName(''); setPresetAction('save') } },
    ...(customPreset ? [
      { label: '重命名', run: () => { setPresetName(preset!.name); setPresetAction('rename') } },
      { label: '删除', run: () => { try { videoEditExportPresetLibrary.remove(presetId); setPresetId('custom'); setError('') } catch (reason) { setError(videoEditUserErrorMessage(reason)) } } },
    ] : []),
  ]
  const hasProxies = composition.clips.some(clip => { const mediaId = composition.items.find(item => item.id === clip.itemId)?.mediaId; return mediaId && readVideoEditProxyState(projectId, mediaId).status === 'ready' })
  const seconds = (range.endFrame - range.startFrame) / composition.fps
  const bytes = videoEditExportEstimatedBytes(settings, seconds)
  const estimated = formatFileSize(bytes)
  // 按画质压制的码率随画面内容变化，按码率估算的大小没有参考价值，不显示。
  const qualityMode = settings.videoEnabled && settings.encoding?.rateControl === 'quality'
  const tier = videoEditExportQualityOf(settings)
  const videoRate = qualityMode ? tier === 'custom' ? `画质 ${settings.encoding!.quality}` : VIDEO_EDIT_EXPORT_QUALITY_LABELS[tier] : formatMbps(settings.videoBitrateMbps)
  return <>
    <UiModal isOpen title="导出" size="editor" contentPadding="none" contentScroll="none" onClose={onClose} footer={<>{(settingsError || encoderError) && <p role="alert" className="mr-auto self-center text-xs text-text2">{settingsError || encoderError}</p>}<UiButton variant="secondary" disabledReason={settingsError || encoderError || (!canExport ? '请先设置导出位置和有效的导出范围' : undefined)} disabled={busy || !canExport} onClick={() => void submit(false)}>加入队列</UiButton><UiButton loading={busy} variant="primary" disabledReason={settingsError || encoderError || (!canExport ? '请先设置导出位置和有效的导出范围' : undefined)} disabled={busy || !canExport} onClick={() => void submit(true)}>{'导出'}</UiButton></>}>
      <div className="flex min-h-0 flex-1">
        <div className="w-80 shrink-0 overflow-y-auto border-r border-line">
          <UiGroup labelWidth={72} gap="row" className="px-3 py-3">
            <VideoEditExportField label="文件名"><UiInput size="sm" className="w-full" aria-label="导出文件名" value={fileName} disabled={busy} onChange={event => setFileName(event.target.value)} /></VideoEditExportField>
            <VideoEditExportField label="位置"><UiButton variant="link" disabled={busy} aria-label="选择导出目录" className="max-w-full" onClick={() => void chooseDirectory()}><span className="truncate" title={directory}>{directory || '选择目录…'}</span></UiButton></VideoEditExportField>
            <VideoEditExportField label="预设"><VideoEditExportPresetMenu presets={presets} presetId={presetId} modified={modified} actions={presetActions} disabled={busy} onSelect={selectPreset} /></VideoEditExportField>
            <VideoEditExportField label="格式"><Dropdown size="sm" className="w-full" ariaLabel="导出格式" value={settings.videoEnabled ? settings.codec : settings.format} minWidthStrategy="none" disabled={busy} options={[
              ...(['avc', 'hevc'] as const).map(codec => ({ value: codec, label: codec === 'avc' ? 'MP4 · H.264' : 'MP4 · H.265', disabled: probing || !codecChoice(codec), tooltip: !codecChoice(codec) ? codec === 'avc' ? '当前规格不支持 H.264；8K 请尝试 H.265，或降低规格。' : hardwareEncodeLimitation('hevc', settings.width, settings.height) ?? '当前规格不支持 H.265；请降低规格。' : !support(codec, settings.encoderPreference, settings.bitrateMode) ? '选择后使用本机可用的性能与码率模式，请检查编码分区。' : undefined })),
              { value: 'aac', label: '音频 · AAC' }, { value: 'wav', label: '音频 · WAV' },
            ]} onSelect={value => value === 'avc' || value === 'hevc' ? selectCodec(value) : patch({ format: value as 'aac' | 'wav' })} /></VideoEditExportField>
          </UiGroup>
          <VideoEditExportFields viewer={owner} settings={settings} busy={busy} hasProxies={hasProxies} patch={patch} probing={probing} support={support} keyframeSupport={keyframeSupport} audioProbing={audioProbing} audioSupport={audioSupport} matchSequence={() => patch({ followSequence: { resolution: true, fps: true, sampleRate: true, channels: true } })}
            capabilities={capabilities.value} capabilityError={capabilities.error} selectQuality={selectQuality} baselineEncoding={baselinePreset?.settings.encoding} changedEncoding={changedEncoding} />
          <div className="space-y-2 px-3 pb-3">
            {notice && <p role="status" className="text-xs text-text2">{notice}</p>}
            <VideoEditFontWarnings document={composition} />
            {(notice || busy || error) && videoEditExportQueue.list().length > 0 && <UiButton size="sm" onClick={() => setShowQueue(true)}>查看导出队列</UiButton>}
            {busy && <UiLoading size="xs" message="正在处理导出…" />}
            {error && <UiError size="xs" message={error} />}
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
          <VideoEditExportPreview projectId={projectId} composition={composition} settings={settings} frame={Math.max(0, Math.min(duration - 1, frame))} />
          <UiRangeInput aria-label="导出预览时刻" min={0} max={Math.max(0, duration - 1)} step={1} value={frame} disabled={!settings.videoEnabled || duration === 0} onChange={event => setFrame(Number(event.target.value))} />
          <div className="flex items-center gap-2"><span className="text-xs text-text2">范围</span><Dropdown size="sm" ariaLabel="导出范围" value={shownRange} className="w-36" disabled={busy} options={[{ value: 'sequence', label: '整个序列' }, { value: 'marks', label: '入点到出点', disabled: !hasMarks, tooltip: !hasMarks ? '请先在时间线设置有效的入点和出点。' : undefined },
            ...(rememberedRange ? [{ value: 'remembered', label: '上次导出的范围', tooltip: `${videoEditFrameTimecode(rememberedRange.startFrame, composition.fps)} – ${videoEditFrameTimecode(rememberedRange.endFrame, composition.fps)}` }] : [])]} onSelect={setRangeMode} /><span aria-label="导出时长" className="ml-auto tabular-nums text-xs text-text2">{videoEditFrameTimecode(range.endFrame - range.startFrame, composition.fps)}</span></div>
          <div className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs text-text2">
            <div className="min-w-0"><p className="mb-1 font-medium text-text1">来源</p><p>{composition.width} × {composition.height} · {formatFrameRate(composition.fps, 'compact')} · {formatSampleRate(composition.sampleRate)} {composition.channels === 2 ? '立体声' : '单声道'}</p></div>
            <div className="min-w-0"><p className="mb-1 font-medium text-text1">输出</p><p>{settings.videoEnabled ? `${videoCodecLabel(settings.codec)} · ${settings.width} × ${settings.height} · ${formatFrameRate(settings.fps!, 'compact')} · ${videoRate}` : ''}{settings.audioEnabled ? `${settings.videoEnabled ? ' · ' : ''}${settings.audioCodec === 'aac' ? `AAC ${formatKbps(settings.audioBitrateKbps)}` : 'WAV 24 位 PCM'} · ${formatSampleRate(settings.sampleRate)}${settings.channels === 2 ? '立体声' : '单声道'}` : ' · 无声'}</p>{!qualityMode && <p className="mt-1">预计大小约 {estimated}</p>}</div>
          </div>
        </div>
      </div>
    </UiModal>
    {presetAction && <UiModal isOpen title={presetAction === 'save' ? '保存导出预设' : '重命名导出预设'} onClose={() => setPresetAction(null)} footer={<UiButton variant="primary" disabledReason="请先输入预设名称" disabled={!presetName.trim()} onClick={savePreset}>保存</UiButton>}><UiInput aria-label="自定义预设名称" value={presetName} onChange={event => setPresetName(event.target.value)} />{error && <UiError message={error} />}</UiModal>}
    {showQueue && <UiModal isOpen title="导出队列" onClose={() => setShowQueue(false)}><VideoEditExportQueueList /></UiModal>}
  </>
}
