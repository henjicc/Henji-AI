import { Hand, MousePointer2, Scissors, ArrowRight } from 'lucide-react'
import { UiButton, UiIconButton, UiRangeInput } from '@/components/ui'
import { getActiveVideoEditSequence, setVideoEditTimelineView, type VideoEditInstance } from './application/videoEditService'
import { captureVideoEditCommandContext, executeVideoEditCommand } from './application/videoEditCommands'
import { useSettingsStore } from '@/stores/settingsStore'
import { VideoEditTimelineCanvas } from './timeline/VideoEditTimelineCanvas'
import { VideoEditTimelineTransport } from './timeline/VideoEditTimelineTransport'
import { timelineCommandPresentation } from './timeline/timelineCommandPresentation'

export function VideoEditTimeline({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (error: unknown) => void; visible?: boolean }): React.ReactElement {
  const sequence = getActiveVideoEditSequence(instance)
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const context = captureVideoEditCommandContext(instance.document.id, 'timeline')
  const snapping = timelineCommandPresentation(context, 'toggle_snapping', shortcuts)
  const run = (operation: () => void): void => { try { operation() } catch (error) { onError(error) } }
  return <div className="flex h-full min-h-0 select-none flex-col bg-panel" aria-label="剪辑时间线" data-video-edit-timeline>
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap px-2 py-1">
      <VideoEditTimelineTransport instance={instance} onError={onError} />
      <div className="flex items-center gap-0.5" role="group" aria-label="时间线工具">
        {([{ id: 'select_tool', icon: MousePointer2 }, { id: 'razor_tool', icon: Scissors }, { id: 'hand_tool', icon: Hand }, { id: 'track_tool', icon: ArrowRight }] as const).map(({ id, icon: Icon }) => {
          const command = timelineCommandPresentation(context, id, shortcuts)
          return <UiIconButton key={id} appearance="hover-only" active={command.checked} disabled={!command.enabled} className="!h-7 !w-7 !p-0" aria-label={command.title} aria-pressed={command.checked} title={command.tooltip} onClick={() => { void executeVideoEditCommand(captureVideoEditCommandContext(instance.document.id, 'timeline'), id).catch(onError) }}><Icon className="h-3.5 w-3.5" /></UiIconButton>
        })}
      </div>
      <UiButton variant="plain" size="sm" className="!h-7" aria-pressed={snapping.checked} disabled={!snapping.enabled} title={snapping.tooltip} onClick={() => { void executeVideoEditCommand(captureVideoEditCommandContext(instance.document.id, 'timeline'), 'toggle_snapping').catch(onError) }}>{snapping.title}</UiButton>
      <div className="ml-auto flex w-28 shrink-0 items-center"><UiRangeInput aria-label="时间线缩放" min={0.1} max={20} step={0.1} value={instance.zoom} onChange={event => run(() => setVideoEditTimelineView(instance.document.id, { zoom: Number(event.target.value) }))} /></div>
    </div>
    <VideoEditTimelineCanvas key={JSON.stringify([instance.document.id, sequence.id])} instance={instance} sequence={sequence} pixels={60 * instance.zoom / sequence.fps} onError={onError} visible={visible} />
  </div>
}
