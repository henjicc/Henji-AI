import { Link, Magnet, Minus, Plus, Scissors, SquareSplitHorizontal, Trash2 } from 'lucide-react'
import { UiIconButton, UiRangeInput } from '@/components/ui'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import { getActiveVideoEditSequence, setVideoEditTimelineView, type VideoEditInstance } from './application/videoEditService'
import { captureVideoEditCommandContext, executeVideoEditCommand } from './application/videoEditCommands'
import { useSettingsStore } from '@/stores/settingsStore'
import { VideoEditTimelineCanvas } from './timeline/VideoEditTimelineCanvas'
import { VideoEditTimecode } from './timeline/VideoEditTimelineTransport'
import { timelineCommandPresentation } from './timeline/timelineCommandPresentation'
import { VideoEditSequenceTabs } from './panels/VideoEditSequenceTabs'
import { VideoEditTimelineTools } from './timeline/VideoEditTimelineTools'

const ZOOM_MIN = 0.1
const ZOOM_MAX = 20

/**
 * 时间线（界面重设计 3.5，设计稿 VideoEdit）：只有一条工具栏——序列标签 ｜ 工具（模式，选中态，按 PR 工具面板分组）· 唯一一条分隔线 ·
 * 链接选择、吸附（开关）与拆分、删除（动作）｜ 缩放。文字由文字工具（T）在轨道上单击添加。播放控制在节目监视器。
 */
export function VideoEditTimeline({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (error: unknown) => void; visible?: boolean }): React.ReactElement {
  const sequence = getActiveVideoEditSequence(instance)
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const context = captureVideoEditCommandContext(instance.document.id, 'timeline')
  const presentation = (id: VideoEditCommandId) => timelineCommandPresentation(context, id, shortcuts)
  const execute = (id: VideoEditCommandId): void => { void executeVideoEditCommand(captureVideoEditCommandContext(instance.document.id, 'timeline'), id).catch(onError) }
  const run = (operation: () => void): void => { try { operation() } catch (error) { onError(error) } }
  const snapping = presentation('toggle_snapping')
  const linkedSelection = presentation('toggle_linked_selection')
  const action = (id: 'split' | 'delete', Icon: typeof Scissors, tone?: 'danger'): React.ReactElement => {
    const command = presentation(id)
    return <UiIconButton tone={tone} aria-label={id === 'split' ? '拆分' : '删除'} title={command.tooltip} disabled={!command.enabled} onClick={() => execute(id)}><Icon size={15} /></UiIconButton>
  }
  return <div className="flex h-full min-h-0 select-none flex-col bg-panel" aria-label="剪辑时间线" data-video-edit-timeline>
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-gap px-2" role="toolbar" aria-label="时间线工具栏">
      {/* 时间码放在最左（Premiere 时间线左上角的播放指示器位置），可拖动、单击输入、Ctrl+单击切换帧号 */}
      <VideoEditTimecode instance={instance} label="当前时间码" className="px-1.5 text-13" />
      <VideoEditSequenceTabs instance={instance} onError={onError} />
      <VideoEditTimelineTools presentation={presentation} execute={execute} />
      <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-line" />
      <UiIconButton on={linkedSelection.checked} disabled={!linkedSelection.enabled} aria-label={linkedSelection.title} title={`${linkedSelection.tooltip}（按住 Alt 临时切换）`} onClick={() => execute('toggle_linked_selection')}><Link size={15} /></UiIconButton>
      <UiIconButton on={snapping.checked} disabled={!snapping.enabled} aria-label={snapping.title} title={snapping.tooltip} onClick={() => execute('toggle_snapping')}><Magnet size={15} /></UiIconButton>
      <div className="ml-2 flex items-center gap-0.5" role="group" aria-label="片段编辑">
        {action('split', SquareSplitHorizontal)}
        {action('delete', Trash2, 'danger')}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1 pl-3">
        <UiIconButton size="sm" aria-label="缩小时间线" title={presentation('zoom_out').tooltip} disabled={!presentation('zoom_out').enabled} onClick={() => execute('zoom_out')}><Minus size={13} /></UiIconButton>
        <div className="flex w-24 items-center"><UiRangeInput aria-label="时间线缩放" min={ZOOM_MIN} max={ZOOM_MAX} step={0.1} value={instance.zoom} onChange={event => run(() => setVideoEditTimelineView(instance.document.id, { zoom: Number(event.target.value) }))} /></div>
        <UiIconButton size="sm" aria-label="放大时间线" title={presentation('zoom_in').tooltip} disabled={!presentation('zoom_in').enabled} onClick={() => execute('zoom_in')}><Plus size={13} /></UiIconButton>
      </div>
    </div>
    <VideoEditTimelineCanvas key={JSON.stringify([instance.document.id, sequence.id])} instance={instance} sequence={sequence} pixels={60 * instance.zoom / sequence.fps} onError={onError} visible={visible} />
  </div>
}
