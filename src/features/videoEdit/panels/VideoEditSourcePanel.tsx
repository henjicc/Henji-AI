import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { UiButton, UiEmpty, UiError, UiInput, UiLoading, UiRangeInput } from '@/components/ui'
import AudioPlayer from '@/components/AudioPlayer'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import type { VideoEditInstance } from '../application/videoEditService'
import { requireVideoEditInstance } from '../application/videoEditService'
import { closeVideoEditSource, observeVideoEditSource, readVideoEditSource, registerVideoEditSourcePresenter, subscribeVideoEditSource, updateVideoEditSource, videoEditSourceRevision } from '../application/videoEditSource'
import { createVideoEditSourcePresenter } from './videoEditSourcePresenter'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from '../application/videoEditCommands'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import { videoEditSourceTimecode } from '@/core/videoEdit/timecode'
import { videoEditItemAudioLayout } from '@/core/videoEdit/audioChannels'
import { writeVideoEditSourceDrag } from '../application/videoEditSourceRange'
import type { VideoEditAudioLevel } from '../engine/videoEditAudioMeter'
import { VideoEditLevelMeter } from './VideoEditLevelMeter'
import Waveform from '@/components/Waveform'
import { useVideoEditWaveformRanges } from './useVideoEditWaveformRanges'

export function VideoEditSourcePanel({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (error: unknown) => void; visible?: boolean }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditSource, videoEditSourceRevision)
  const host = useRef<HTMLDivElement>(null)
  const presenterRef = useRef<ReturnType<typeof createVideoEditSourcePresenter> | null>(null)
  const projectId = instance.document.id
  const state = readVideoEditSource(projectId)
  const item = instance.document.items.find(item => item.id === state.itemId)
  const media = instance.document.media.find(media => media.id === item?.mediaId)
  const [draftTime, setDraftTime] = useState('0')
  const [display, setDisplay] = useState<'fit' | 'actual'>('fit')
  const [levels, setLevels] = useState<VideoEditAudioLevel[]>([])
  const sourceDurationUs = Math.round((media?.durationSeconds ?? 0) * 1e6)
  const waveStartUs = state.inUs ?? (sourceDurationUs <= 30 * 60 * 1e6 ? 0 : Math.floor(state.timeUs / 30e6) * 30e6)
  const waveEndUs = Math.min(sourceDurationUs, state.outUs ?? (sourceDurationUs <= 30 * 60 * 1e6 ? sourceDurationUs : waveStartUs + 30e6), waveStartUs + 30 * 60 * 1e6)
  const hasWave = !!media && (media.kind === 'audio' || media.kind === 'video' && media.hasAudio === true) && waveEndUs > waveStartUs
  const wave = useVideoEditWaveformRanges(hasWave ? [{ key: 'source', request: { source: media.path, ...(media.sourceRevision ? { sourceRevision: media.sourceRevision } : {}), startUs: waveStartUs, endUs: waveEndUs, bucketCount: 256, channels: 2 } }] : [], visible).get('source')
  const editingTime = useRef(false)
  useEffect(() => { if (!editingTime.current) setDraftTime((state.timeUs / 1e6).toFixed(6)) }, [state.timeUs])
  const run = (values: Parameters<typeof updateVideoEditSource>[1]): void => { void updateVideoEditSource(projectId, values).catch(error => {
    if (error instanceof Error && /请求已被更新|预览已关闭/.test(error.message)) return
    onError(error)
  }) }
  const command = (id: VideoEditCommandId): void => { void executeVideoEditCommand(captureVideoEditCommandContext(projectId, 'source'), id).catch(onError) }
  const availability = captureVideoEditCommandContext(projectId, 'source', { includeClipboard: false })
  const enabled = (id: VideoEditCommandId): boolean => videoEditCommandState(availability, id).enabled
  useEffect(() => {
    if (!visible || !host.current) { closeVideoEditSource(projectId); return }
    const presenter = createVideoEditSourcePresenter(host.current, itemId => {
      const document = requireVideoEditInstance(projectId).document
      const item = document.items.find(item => item.id === itemId)
      const media = document.media.find(media => media.id === item?.mediaId)
      if (!media) throw new Error('此项目项没有源文件，请选择视频、图片或音频。')
      return media
    }, (itemId, observation) => observeVideoEditSource(projectId, itemId, observation), setLevels, itemId => {
      const document = requireVideoEditInstance(projectId).document
      const item = document.items.find(item => item.id === itemId)
      return item ? videoEditItemAudioLayout(item, document.media.find(media => media.id === item.mediaId)) : undefined
    })
    presenterRef.current = presenter
    const unregister = registerVideoEditSourcePresenter(projectId, presenter.present, presenter.release)
    return () => { presenterRef.current = null; presenter.dispose(); unregister() }
  }, [projectId, visible])
  useEffect(() => { if (state.status === 'closed') presenterRef.current?.release() }, [state.status, state.itemId])
  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-app" aria-label="源监视器" data-video-edit-panel="source" data-video-edit-source-status={state.status} tabIndex={0}>
    <div className="relative min-h-0 flex-1 p-3"><div ref={host} className={display === 'fit' ? 'absolute inset-3' : 'absolute inset-3 overflow-auto [&>video]:!h-auto [&>video]:!w-auto [&>img]:!h-auto [&>img]:!w-auto [&>canvas]:!h-auto [&>canvas]:!w-auto'} data-video-edit-source-host data-video-edit-source-display={display} />
      {media?.kind === 'audio' && <div className="relative flex h-full items-center"><AudioPlayer src={resolveImageDisplayUrl(media.path)} filePath={media.path} compact surface="plain" active={visible} controlledPlayback={{ currentTime: state.timeUs / 1e6, duration: media.durationSeconds, playing: state.playing, volume: state.volume, disabled: state.status !== 'ready', onTogglePlay: () => command('play_pause'), onSeek: seconds => run({ timeUs: Math.round(seconds * 1e6), playing: false }), onVolume: volume => run({ volume }) }} /></div>}
      {!state.itemId && <UiEmpty title="选择源素材" description="在项目素材中双击视频、图片或音频，独立预览原文件。" />}
    </div>
    {state.itemId && <div className="flex max-h-[60%] shrink-0 flex-wrap items-center gap-2 overflow-y-auto px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{item?.name}</span>
      <span aria-label="源实际时间码" className="text-2xs tabular-nums text-text-muted">{videoEditSourceTimecode(media?.kind === 'video' ? state.presentedTimeUs : state.timeUs)}</span>
      {media?.kind !== 'audio' && <><UiButton variant="plain" aria-pressed={display === 'fit'} onClick={() => setDisplay('fit')}>适合窗口</UiButton><UiButton variant="plain" aria-pressed={display === 'actual'} onClick={() => setDisplay('actual')}>100%</UiButton></>}
      {media?.kind === 'video' && <UiButton variant="plain" disabled={!enabled('play_pause')} onClick={() => command('play_pause')}>{state.playing ? '暂停源素材' : '播放源素材'}</UiButton>}
      <UiButton variant="plain" onClick={() => run({ itemId: '', timeUs: 0, playing: false })}>关闭源素材</UiButton>
      {media?.kind !== 'image' && <div className="flex w-full flex-wrap items-center gap-1 text-xs">
        <UiButton variant="plain" disabled={!enabled('play_reverse')} onClick={() => command('play_reverse')}>反向（静音）</UiButton><UiButton variant="plain" disabled={!enabled('play_stop')} onClick={() => command('play_stop')}>停止</UiButton><UiButton variant="plain" disabled={!enabled('play_forward')} onClick={() => command('play_forward')}>正向</UiButton>
        <UiButton variant="plain" disabled={!enabled('mark_in')} onClick={() => command('mark_in')}>设入点</UiButton><UiButton variant="plain" disabled={!enabled('mark_out')} onClick={() => command('mark_out')}>设出点</UiButton>
        <span className="text-text-muted">入 {state.inUs === null ? '未设置' : videoEditSourceTimecode(state.inUs)} · 出 {state.outUs === null ? '未设置' : videoEditSourceTimecode(state.outUs)}</span>
        {state.playing && state.playbackDirection === -1 && <span className="text-text-muted">正在反向静音浏览</span>}
      </div>}
      {media?.kind !== 'image' && <div className="flex w-full items-center gap-2"><UiInput aria-label="源素材定位秒" type="number" min={0} max={media?.durationSeconds ?? 0} step={0.000001} className="w-28" value={draftTime} onFocus={() => { editingTime.current = true }} onChange={event => setDraftTime(event.target.value)} onBlur={() => { editingTime.current = false; run({ timeUs: Math.round(Number(draftTime) * 1e6), playing: false }) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} />
        {media?.kind === 'video' && <UiRangeInput aria-label="源素材进度" min={0} max={Math.round((media?.durationSeconds ?? 0) * 1e6)} step={1} value={state.timeUs} onChange={event => run({ timeUs: Number(event.target.value), playing: false })} />}</div>}
      {media?.kind !== 'image' && <div className="flex w-full flex-wrap gap-1" aria-label="源选区拖放">
        {(media?.kind === 'audio' ? ['audio'] as const : media?.hasAudio ? ['video', 'audio', 'linked'] as const : ['video'] as const).map(component => <UiButton key={component} variant="ghost" draggable={state.status === 'ready'} disabled={state.status !== 'ready'} onDragStart={event => { try { writeVideoEditSourceDrag(event.dataTransfer, projectId, component); event.dataTransfer.effectAllowed = 'copy' } catch (error) { event.preventDefault(); onError(error) } }} title="拖入对应时间线轨道，使用当前源入出点">{component === 'video' ? '拖入画面' : component === 'audio' ? '拖入声音' : '拖入链接音画'}</UiButton>)}
      </div>}
      {(media?.kind === 'audio' || media?.hasAudio) && <div className="w-full"><VideoEditLevelMeter levels={levels.length ? levels : [{ peak: 0, rms: 0 }, { peak: 0, rms: 0 }]} title="源播放电平" /></div>}
      {wave?.result && <div className="pointer-events-none w-full" data-video-edit-source-waveform>
        <span className="text-2xs text-text-muted">{videoEditSourceTimecode(wave.result.startUs)} — {videoEditSourceTimecode(wave.result.endUs)}</span>
        {wave.result.channels.map((channel, index) => <Waveform key={index} samples={channel.peak} duration={(wave.result!.endUs - wave.result!.startUs) / 1e6} height={20} />)}
      </div>}
      {wave?.error && <UiError size="xs" title="波形未能读取" message={wave.error} />}
      {state.status === 'loading' && <UiLoading message="正在打开源素材…" />}
    </div>}
    {state.error && <UiError message={state.error} />}
  </div>
}
