import { useSyncExternalStore, type ReactNode } from 'react'
import { getActiveVideoEditSequence, subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { TIMELINE_HEADER_WIDTH, timelineTimecode } from './timelineGeometry'

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
