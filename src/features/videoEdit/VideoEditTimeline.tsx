import { VideoEditEmptyTimeline } from './panels/VideoEditEmptyTimeline'
import { Link, Magnet, Minus, Plus } from 'lucide-react'
import { UiIconButton, UiRangeInput, UiToolbar, type UiPanelFooterAction } from '@/components/ui'
import { ICON_FRAME_BLEND, ICON_MOTION_BLUR } from '@/core/theme/icons'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import { getActiveVideoEditSequence, setVideoEditTimelineView, type VideoEditInstance } from './application/videoEditService'
import { captureVideoEditCommandContext, executeVideoEditCommand } from './application/videoEditCommands'
import { useSettingsStore } from '@/stores/settingsStore'
import { VideoEditTimelineCanvas } from './timeline/VideoEditTimelineCanvas'
import { VideoEditTimecode } from './timeline/VideoEditTimelineTransport'
import { TIMELINE_CORNER_STACKED_BELOW, useTimelineHeaderWidth } from './timeline/timelineGeometry'
import { timelineCommandPresentation } from './timeline/timelineCommandPresentation'
import { VideoEditSequenceTabs } from './panels/VideoEditSequenceTabs'

const ZOOM_MIN = 0.1
const ZOOM_MAX = 20

/**
 * 时间线（重要记录 019）：不再单占一行工具栏。编辑工具在剪辑命令带；轨道头上方的角落格（够宽时一行）：
 * 左边是时间码（Premiere 播放指示器的位置，可拖动、单击输入、Ctrl+单击切换帧号），右边是这条时间线的统一开关
 * （链接选择、吸附、运动模糊、帧混合、序列设置）；缩放在右下角底栏。
 * 拆分、删除在“剪辑”“编辑”菜单与快捷键里。播放控制在节目监视器。
 */
function VideoEditTimelineContent({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (error: unknown) => void; visible?: boolean }): React.ReactElement {
  const sequence = getActiveVideoEditSequence(instance)
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const context = captureVideoEditCommandContext(instance.document.id, 'timeline')
  const presentation = (id: VideoEditCommandId) => timelineCommandPresentation(context, id, shortcuts)
  const execute = (id: VideoEditCommandId): void => { void executeVideoEditCommand(captureVideoEditCommandContext(instance.document.id, 'timeline'), id).catch(onError) }
  const run = (operation: () => void): void => { try { operation() } catch (error) { onError(error) } }
  const snapping = presentation('toggle_snapping')
  const linkedSelection = presentation('toggle_linked_selection')
  const motionBlur = presentation('toggle_motion_blur')
  const frameBlend = presentation('toggle_frame_blend')
  const MotionBlurIcon = ICON_MOTION_BLUR, FrameBlendIcon = ICON_FRAME_BLEND
  const zoomButton = (id: 'zoom_in' | 'zoom_out', label: string, icon: UiPanelFooterAction['icon']): UiPanelFooterAction => {
    const state = presentation(id)
    return { kind: 'action', id, label, icon, tooltip: state.label, disabled: !state.enabled, disabledReason: state.reason, onSelect: () => execute(id) }
  }
  const zoomSlider = <UiRangeInput aria-label="时间线缩放" min={ZOOM_MIN} max={ZOOM_MAX} step={0.1} value={instance.zoom} onChange={event => run(() => setVideoEditTimelineView(instance.document.id, { zoom: Number(event.target.value) }))} />
  const corner = <TimelineCorner instance={instance}>
      <UiIconButton size="xs" on={linkedSelection.checked} disabled={!linkedSelection.enabled} aria-label={linkedSelection.title} tooltip={`${linkedSelection.tooltip}（按住 Alt 临时切换）`} onClick={() => execute('toggle_linked_selection')}><Link /></UiIconButton>
      <UiIconButton size="xs" on={snapping.checked} disabled={!snapping.enabled} aria-label={snapping.title} tooltip={snapping.tooltip} onClick={() => execute('toggle_snapping')}><Magnet /></UiIconButton>
      <UiIconButton size="xs" on={motionBlur.checked} disabled={!motionBlur.enabled} aria-label={motionBlur.title} tooltip={`${motionBlur.tooltip}：整条序列的总开关，运动的片段与图层沿运动方向模糊`} onClick={() => execute('toggle_motion_blur')}><MotionBlurIcon /></UiIconButton>
      <UiIconButton size="xs" on={frameBlend.checked} disabled={!frameBlend.enabled} aria-label={frameBlend.title} tooltip={`${frameBlend.tooltip}：慢放片段默认把相邻两帧混合`} onClick={() => execute('toggle_frame_blend')}><FrameBlendIcon /></UiIconButton>
      <VideoEditSequenceTabs instance={instance} onError={onError} />
  </TimelineCorner>
  return <div className="flex h-full min-h-0 select-none flex-col bg-panel" aria-label="剪辑时间线" data-video-edit-timeline>
    <VideoEditTimelineCanvas key={JSON.stringify([instance.document.id, sequence.id])} instance={instance} sequence={sequence} pixels={60 * instance.zoom / sequence.fps} onError={onError} visible={visible} corner={corner} />
    <UiToolbar variant="footer" aria-label="时间线缩放" moreLabel="更多缩放控制" tools={[
      zoomButton('zoom_out', '缩小时间线', Minus),
      // 面板变窄先收滑杆（最宽），缩小、放大按钮留到最后
      { kind: 'custom', id: 'zoom', label: '时间线缩放', priority: -1, node: <div className="flex w-24 items-center">{zoomSlider}</div>, overflow: <div className="flex w-40 items-center px-2 pb-1">{zoomSlider}</div> },
      zoomButton('zoom_in', '放大时间线', Plus),
    ]} />
  </div>
}

/**
 * 角落格：时间码与时间线开关。轨道头随窄面板收窄时时间码字号跟着变小；再窄放不进一行时改成时间码在上、开关在下，
 * 两者都不被裁掉或叠在一起。
 */
function TimelineCorner({ instance, children }: { instance: VideoEditInstance; children: React.ReactNode }): React.ReactElement {
  const header = useTimelineHeaderWidth()
  const stacked = header < TIMELINE_CORNER_STACKED_BELOW
  const timecode = <VideoEditTimecode instance={instance} label="当前时间码" primary className={`${header < 180 ? 'px-1 text-xs' : 'px-1.5 text-15'} ${stacked ? 'self-start' : ''}`} />
  const toolbar = <div className="flex h-6 shrink-0 items-center gap-0.5" role="toolbar" aria-label="时间线开关">{children}</div>
  return stacked
    ? <div className="flex min-w-0 flex-1 flex-col justify-center">{timecode}{toolbar}</div>
    : <div className="flex min-w-0 flex-1 items-center"><div className="flex min-w-0 flex-1 items-center">{timecode}</div>{toolbar}</div>
}

export function VideoEditTimeline(props: Parameters<typeof VideoEditTimelineContent>[0]): React.ReactElement {
  return props.instance.activeSequenceId ? <VideoEditTimelineContent {...props} /> : <VideoEditEmptyTimeline instance={props.instance} onError={props.onError} />
}
