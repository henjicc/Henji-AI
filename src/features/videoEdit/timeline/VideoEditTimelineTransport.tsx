import { useSyncExternalStore, type ReactNode } from 'react'
import { UiButton } from '@/components/ui'
import { useSettingsStore } from '@/stores/settingsStore'
import { getActiveVideoEditSequence, subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { captureVideoEditCommandContext, executeVideoEditCommand } from '../application/videoEditCommands'
import { TIMELINE_HEADER_WIDTH, timelineTimecode } from './timelineGeometry'
import { timelineCommandPresentation } from './timelineCommandPresentation'

export function VideoEditTimelineTransport({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const sequence = getActiveVideoEditSequence(instance)
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const context = captureVideoEditCommandContext(instance.document.id, 'timeline', { includeClipboard: false })
  return <>
    {(['step_back', 'play_pause', 'step_forward'] as const).map(id => {
      const command = timelineCommandPresentation(context, id, shortcuts)
      return <UiButton key={id} size="sm" aria-pressed={id === 'play_pause' ? instance.playing : undefined} disabled={!command.enabled} title={command.tooltip} onClick={() => { void executeVideoEditCommand(captureVideoEditCommandContext(instance.document.id, 'timeline'), id).catch(onError) }}>{command.title}</UiButton>
    })}
    <span className="text-2xs tabular-nums text-text-muted" aria-label="当前时间码">{timelineTimecode(instance.frame, sequence.fps)}</span>
  </>
}
export function VideoEditTimelinePlayhead({ instance, pixels }: { instance: VideoEditInstance; pixels: number }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  return <div className="pointer-events-none absolute bottom-0 top-0 z-raised w-px bg-text-dark" style={{ left: TIMELINE_HEADER_WIDTH + instance.frame * pixels }} data-video-edit-playhead />
}
export function VideoEditTimelinePosition({ instance, children }: { instance: VideoEditInstance; children: ReactNode }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  return <div className="relative min-w-0 flex-1" role="slider" tabIndex={0} aria-label="剪辑时间定位" aria-valuemin={0} aria-valuemax={Math.floor(getActiveVideoEditSequence(instance).fps * 1800)} aria-valuenow={instance.frame}>{children}</div>
}
