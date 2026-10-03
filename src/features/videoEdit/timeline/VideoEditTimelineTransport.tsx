import { useSyncExternalStore, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import { videoEditDuration } from '@/core/videoEdit/document'
import { useSettingsStore } from '@/stores/settingsStore'
import { getActiveVideoEditSequence, setVideoEditView, subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { captureVideoEditCommandContext, executeVideoEditCommand } from '../application/videoEditCommands'
import { TIMELINE_HEADER_WIDTH, timelineTimecode } from './timelineGeometry'
import { timelineCommandPresentation } from './timelineCommandPresentation'

/**
 * 节目播放控制（界面重设计 3.5，设计稿 VideoEdit 节目监视器）：跳到开头、上一帧、播放、下一帧、跳到结尾，全部图标。
 * 上一帧/播放/下一帧仍走正式命令（同一启用状态与自定义键位）；跳到首尾只移动播放头（与标尺定位同一视图写入）。
 * 自己订阅视图，播放时只重绘这一小段。
 */
export function VideoEditTransportControls({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const context = captureVideoEditCommandContext(instance.document.id, 'timeline', { includeClipboard: false })
  const last = Math.max(0, videoEditDuration(getActiveVideoEditSequence(instance)) - 1)
  const run = (id: 'step_back' | 'play_pause' | 'step_forward'): void => { void executeVideoEditCommand(captureVideoEditCommandContext(instance.document.id, 'timeline'), id).catch(onError) }
  const jump = (frame: number): void => { try { setVideoEditView(instance.document.id, { frame, playing: false }) } catch (error) { onError(error) } }
  const step = (id: 'step_back' | 'step_forward', Icon: typeof ChevronLeft): React.ReactElement => {
    const command = timelineCommandPresentation(context, id, shortcuts)
    return <UiIconButton aria-label={command.title} title={command.tooltip} disabled={!command.enabled} onClick={() => run(id)}><Icon size={16} /></UiIconButton>
  }
  const play = timelineCommandPresentation(context, 'play_pause', shortcuts)
  return <div className="flex items-center gap-0.5" role="group" aria-label="节目播放控制">
    <UiIconButton aria-label="跳到开头" title="跳到开头" disabled={instance.frame === 0 && !instance.playing} onClick={() => jump(0)}><SkipBack size={15} /></UiIconButton>
    {step('step_back', ChevronLeft)}
    <UiIconButton size="lg" aria-label={play.title} aria-pressed={instance.playing} title={play.tooltip} disabled={!play.enabled} onClick={() => run('play_pause')}>{instance.playing ? <Pause size={18} /> : <Play size={18} />}</UiIconButton>
    {step('step_forward', ChevronRight)}
    <UiIconButton aria-label="跳到结尾" title="跳到结尾" disabled={instance.frame >= last && !instance.playing} onClick={() => jump(last)}><SkipForward size={15} /></UiIconButton>
  </div>
}

/** 时间码读数（等宽数字）：节目监视器与时间线工具栏共用，单独订阅视图。 */
export function VideoEditTimecode({ instance, label, className = '' }: { instance: VideoEditInstance; label: string; className?: string }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const sequence = getActiveVideoEditSequence(instance)
  return <span className={`shrink-0 font-mono tabular-nums ${className}`} aria-label={label}>{timelineTimecode(instance.frame, sequence.fps)}{Number.isInteger(sequence.fps) ? '' : ' NDF'}</span>
}

/** 播放头：强调色竖线（设计稿 VideoEdit；强调色只用于主动作、焦点、播放头与选中指示）。 */
export function VideoEditTimelinePlayhead({ instance, pixels }: { instance: VideoEditInstance; pixels: number }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  return <div className="pointer-events-none absolute bottom-0 top-0 z-raised w-px bg-accent-ring" style={{ left: TIMELINE_HEADER_WIDTH + instance.frame * pixels }} data-video-edit-playhead />
}
export function VideoEditTimelinePosition({ instance, children }: { instance: VideoEditInstance; children: ReactNode }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  return <div className="relative min-w-0 flex-1" role="slider" tabIndex={0} aria-label="剪辑时间定位" aria-valuemin={0} aria-valuemax={Math.floor(getActiveVideoEditSequence(instance).fps * 1800)} aria-valuenow={instance.frame}>{children}</div>
}
