import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { UiEmpty, UiError, UiIconButton, UiInput, UiRangeInput } from '@/components/ui'
import { ArrowRightFromLine, ArrowRightToLine, AudioLines, BetweenVerticalStart, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Eraser, FastForward, Film, Link2, Pause, Play, Replace, Rewind, Square, X, type LucideIcon } from 'lucide-react'
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
import { WaveformView } from '@/components/waveform/WaveformView'
import { useSettingsStore } from '@/stores/settingsStore'
import { timelineCommandPresentation } from '../timeline/timelineCommandPresentation'
import { VideoEditMonitorButton, VideoEditMonitorButtonEditor, useVideoEditMonitorButtonIds, type VideoEditMonitorButtonSpec } from './VideoEditMonitorButtons'
import { useWaveformData } from '@/hooks/useWaveformData'
import { useMonitorZoom } from './useMonitorZoom'

/** 源按钮栏里走剪辑命令的按钮；入出点与 J/K/L 沿用原有名称（自动化场景按名称点击）。 */
const SOURCE_COMMAND_BUTTONS: Array<{ id: 'mark_in' | 'mark_out' | 'clear_in_out' | 'step_back_five' | 'step_back' | 'play_reverse' | 'play_stop' | 'play_forward' | 'step_forward' | 'step_forward_five' | 'insert' | 'overwrite'; Icon: LucideIcon; title?: string }> = [
  { id: 'mark_in', Icon: ArrowRightFromLine, title: '设入点' }, { id: 'mark_out', Icon: ArrowRightToLine, title: '设出点' }, { id: 'clear_in_out', Icon: Eraser },
  { id: 'step_back_five', Icon: ChevronsLeft }, { id: 'step_back', Icon: ChevronLeft }, { id: 'play_reverse', Icon: Rewind, title: '反向（静音）' }, { id: 'play_stop', Icon: Square, title: '停止' },
  { id: 'play_forward', Icon: FastForward, title: '正向' }, { id: 'step_forward', Icon: ChevronRight }, { id: 'step_forward_five', Icon: ChevronsRight },
  { id: 'insert', Icon: BetweenVerticalStart }, { id: 'overwrite', Icon: Replace },
]
const SOURCE_PLAYBACK_BUTTONS = new Set(['mark_in', 'mark_out', 'clear_in_out', 'step_back_five', 'step_back', 'play_reverse', 'play_stop', 'play_pause', 'play_forward', 'step_forward', 'step_forward_five'])

export function VideoEditSourcePanel({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (error: unknown) => void; visible?: boolean }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditSource, videoEditSourceRevision)
  const host = useRef<HTMLDivElement>(null)
  const presenterRef = useRef<ReturnType<typeof createVideoEditSourcePresenter> | null>(null)
  const projectId = instance.document.id
  const state = readVideoEditSource(projectId)
  const item = instance.document.items.find(item => item.id === state.itemId)
  const media = instance.document.media.find(media => media.id === item?.mediaId)
  const [draftTime, setDraftTime] = useState('0')
  const [levels, setLevels] = useState<VideoEditAudioLevel[]>([])
  const pictured = !!media && media.kind !== 'audio'
  // 显示比例与节目监视器同一套（滚轮无极缩放、中键平移、下拉等级）；换素材回到“适合”
  const zoom = useMonitorZoom({ width: media?.width || 1920, height: media?.height || 1080, label: '源显示比例' })
  const { setDisplay: setZoomDisplay } = zoom
  useEffect(() => { setZoomDisplay('fit') }, [state.itemId, setZoomDisplay])
  const sourceDurationUs = Math.round((media?.durationSeconds ?? 0) * 1e6)
  // 多级波形覆盖整段素材：显示入出点之间，未设时显示整段（不再按 30 分钟分块解码）。
  const waveStartUs = state.inUs ?? 0
  const waveEndUs = Math.min(sourceDurationUs, state.outUs ?? sourceDurationUs)
  const hasWave = !!media && (media.kind === 'audio' || media.kind === 'video' && media.hasAudio === true) && waveEndUs > waveStartUs
  const waveform = useWaveformData(hasWave ? { source: media.path, ...(media.sourceRevision ? { sourceRevision: media.sourceRevision } : {}), channels: 2 } : null, 'full', visible)
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
      if (!media) throw new Error('此素材项没有源文件，请选择视频、图片或音频。')
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
  const meterLevels = levels.length ? levels : [{ peak: 0, rms: 0 }, { peak: 0, rms: 0 }]
  const sounding = media?.kind === 'audio' || media?.hasAudio === true
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const buttonIds = useVideoEditMonitorButtonIds('source')
  const dragComponents = media?.kind === 'audio' ? ['audio'] as const : media?.hasAudio ? ['video', 'audio', 'linked'] as const : ['video'] as const
  const sourceButtons: VideoEditMonitorButtonSpec[] = [
    ...SOURCE_COMMAND_BUTTONS.map(({ id, Icon, title }): VideoEditMonitorButtonSpec => {
      const presentation = timelineCommandPresentation(availability, id, shortcuts)
      return { id, title: title ?? presentation.title, tooltip: presentation.tooltip, Icon, enabled: presentation.enabled, hidden: media?.kind === 'image' && SOURCE_PLAYBACK_BUTTONS.has(id), onClick: () => command(id) }
    }),
    { id: 'play_pause', title: state.playing ? '暂停源素材' : '播放源素材', tooltip: timelineCommandPresentation(availability, 'play_pause', shortcuts).tooltip, Icon: state.playing ? Pause : Play, size: 'lg', enabled: enabled('play_pause'), hidden: media?.kind !== 'video', onClick: () => command('play_pause') },
    ...(['video', 'audio', 'linked'] as const).map((component): VideoEditMonitorButtonSpec => {
      const name = component === 'video' ? '拖入画面' : component === 'audio' ? '拖入声音' : '拖入链接音画'
      return {
        id: `drag_${component}`, title: name, tooltip: `${name}：拖入对应时间线轨道，使用当前源入出点`, Icon: component === 'video' ? Film : component === 'audio' ? AudioLines : Link2,
        enabled: state.status === 'ready', hidden: media?.kind === 'image' || !(dragComponents as readonly string[]).includes(component),
        onDragStart: event => { try { writeVideoEditSourceDrag(event.dataTransfer, projectId, component); event.dataTransfer.effectAllowed = 'copy' } catch (error) { event.preventDefault(); onError(error) } },
      }
    }),
  ]
  const sourceButtonOf = new Map(sourceButtons.map(spec => [spec.id, spec]))
  const barButtons = buttonIds.flatMap(id => { const spec = sourceButtonOf.get(id); return spec && !spec.hidden ? [spec] : [] })
  // 源监视器（界面重设计 3.5；剪辑对齐 PR 2.5）：画面区（媒体底 + 纵向电平）→ 定位区（素材名、定位秒、实际时间码、进度、波形、入出点读数）→
  // 唯一一条控制带：自定义按钮栏（默认入出点、逐帧、J/K/L、插入、覆盖、拖入）+“+”按钮编辑器 ｜ 适应、关闭（窄面板时整组换行，不横向滚动）。压在画面上的状态用媒体叠层令牌。
  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-panel" aria-label="源监视器" data-video-edit-panel="source" data-video-edit-source-status={state.status} tabIndex={0}>
    {/* 媒体底只给画面（视频/图片）；音频源是随主题的迷你播放器，压在固定深色媒体底上纸白下读不清（4.1） */}
    <div className={`relative min-h-0 flex-1 ${state.itemId && media?.kind !== 'audio' ? 'bg-media' : ''}`}><div ref={pictured ? zoom.containerRef : undefined} {...(pictured ? zoom.containerProps : {})} className={`absolute bottom-3 left-3 right-6 top-3 flex ${zoom.containerClass}`}>
        <div className={`relative ${zoom.boxClass}`} style={zoom.boxStyle} data-monitor-zoom-box><div ref={host} className="absolute inset-0" data-video-edit-source-host data-video-edit-source-display={zoom.display === 'fit' ? 'fit' : 'zoom'} /></div>
      </div>
      {media?.kind === 'audio' && <div className="relative flex h-full items-center px-3 pr-6"><AudioPlayer src={resolveImageDisplayUrl(media.path)} filePath={media.path} compact surface="plain" active={visible} controlledPlayback={{ currentTime: state.timeUs / 1e6, duration: media.durationSeconds, playing: state.playing, volume: state.volume, disabled: state.status !== 'ready', onTogglePlay: () => command('play_pause'), onSeek: seconds => run({ timeUs: Math.round(seconds * 1e6), playing: false }), onVolume: volume => run({ volume }) }} /></div>}
      {!state.itemId && <UiEmpty size="sm" className="h-full" title="选择源素材" description="在素材面板中双击视频、图片或音频，独立预览原文件。" />}
      {state.itemId && sounding && <VideoEditLevelMeter className="absolute bottom-3 right-2 top-3" levels={meterLevels} title="源播放电平" />}
      {state.itemId && (state.status === 'loading' || state.playing && state.playbackDirection === -1) && <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-media-scrim px-2 py-1 text-xs text-on-media">{state.status === 'loading' ? '正在打开源素材…' : '正在反向静音浏览'}</span>}
    </div>
    {state.itemId && <div className="flex shrink-0 flex-col gap-1 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-text2" title={item?.name}>{item?.name}</span>
        {media?.kind !== 'image' && <div className="w-28 shrink-0"><UiInput aria-label="源素材定位秒" type="number" size="sm" min={0} max={media?.durationSeconds ?? 0} step={0.000001} className="tabular-nums" value={draftTime} onFocus={() => { editingTime.current = true }} onChange={event => setDraftTime(event.target.value)} onBlur={() => { editingTime.current = false; run({ timeUs: Math.round(Number(draftTime) * 1e6), playing: false }) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} /></div>}
        <span aria-label="源实际时间码" className="shrink-0 px-1 font-mono text-xs tabular-nums text-text3">{videoEditSourceTimecode(media?.kind === 'video' ? state.presentedTimeUs : state.timeUs)}</span>
      </div>
      {media?.kind === 'video' && <UiRangeInput aria-label="源素材进度" min={0} max={Math.round((media?.durationSeconds ?? 0) * 1e6)} step={1} value={state.timeUs} onChange={event => run({ timeUs: Number(event.target.value), playing: false })} />}
      {hasWave && waveform.data && <div className="pointer-events-none flex w-full flex-col gap-0.5" data-video-edit-source-waveform>
        <span className="font-mono text-2xs tabular-nums text-text3">{videoEditSourceTimecode(waveStartUs)} — {videoEditSourceTimecode(waveEndUs)}</span>
        <WaveformView waveform={waveform} startSeconds={waveStartUs / 1e6} endSeconds={waveEndUs / 1e6} playedSeconds={state.timeUs / 1e6} height={20 * waveform.data.pyramid.channelCount} />
      </div>}
      {hasWave && waveform.status === 'error' && <UiError size="xs" align="start" title="波形未能读取" message={waveform.error ?? ''} />}
      {media?.kind !== 'image' && <span className="font-mono text-2xs tabular-nums text-text3">入点 {state.inUs === null ? '未设置' : videoEditSourceTimecode(state.inUs)} · 出点 {state.outUs === null ? '未设置' : videoEditSourceTimecode(state.outUs)}</span>}
    </div>}
    {state.itemId && <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-center gap-x-1 gap-y-0.5 border-t border-line px-2 py-1" role="toolbar" aria-label="源监视器控制">
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-0.5" role="group" aria-label="源监视器按钮">
        {barButtons.map(spec => <VideoEditMonitorButton key={spec.id} spec={spec} />)}
        <VideoEditMonitorButtonEditor kind="source" specs={sourceButtons} />
      </div>
      {pictured && zoom.dropdown}
      <UiIconButton aria-label="关闭源素材" title="关闭源素材" onClick={() => run({ itemId: '', timeUs: 0, playing: false })}><X size={15} /></UiIconButton>
    </div>}
    {state.error && <UiError size="sm" title={state.error} message="" />}
  </div>
}
