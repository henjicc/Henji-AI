import { useState, useSyncExternalStore } from 'react'
import { Copy, MoreHorizontal, Send } from 'lucide-react'
import { PanelTrigger, UiButton, UiIconButton, UiOptionButton, UiSegmented } from '@/components/ui'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { VIDEO_EDIT_ANNOTATION_COLORS } from '@/core/theme/colorTokens'
import { VIDEO_EDIT_ANNOTATION_COLOR_LABELS, VIDEO_EDIT_ANNOTATION_COLOR_NAMES, VIDEO_EDIT_ANNOTATION_WEIGHT_LABELS, VIDEO_EDIT_ANNOTATION_WEIGHTS, type VideoEditAnnotationWeight } from '@/core/videoEdit/annotations'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import { chooseVideoEditAnnotationShape, sendVideoEditAnnotations, setVideoEditAnnotationBrush, subscribeVideoEditAnnotationBrush, VIDEO_EDIT_ANNOTATION_SHAPE_COMMANDS, VIDEO_EDIT_ANNOTATION_SHAPES, videoEditAnnotationBrush, videoEditAnnotationBrushRevision } from './application/videoEditAnnotations'
import { focusVideoEditPanel, type VideoEditInstance } from './application/videoEditService'
import { VIDEO_EDIT_ANNOTATION_SHAPE_ICONS } from './timeline/VideoEditTimelineTools'
import type { timelineCommandPresentation } from './timeline/timelineCommandPresentation'

type Presentation = ReturnType<typeof timelineCommandPresentation>

/**
 * 批注工具的参数条（重要记录 019）：紧跟命令带里的工具组（窄窗口时在命令带下的从属参数带）。形状、颜色、粗细是“接下来怎么画”，
 * 选中画面上的一条批注时改颜色或粗细也作用到它（由画面上的批注层接手）；右端是这个工具的动作：助手改好的去批注面板审查，
 * 待发送的批注发给助手。
 * 节目画面本身不放任何工具。
 */
export function VideoEditAnnotationToolOptions({ instance, presentation, onError }: { instance: VideoEditInstance; presentation: (id: VideoEditCommandId) => Presentation; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditAnnotationBrush, videoEditAnnotationBrushRevision)
  const projectId = instance.document.id
  const brush = videoEditAnnotationBrush(projectId)
  const sequence = instance.document.sequences.find(item => item.id === instance.activeSequenceId)
  const drafts = sequence?.annotations.filter(mark => mark.status === 'draft').length ?? 0
  const reviews = sequence?.annotations.filter(mark => mark.status === 'addressed').length ?? 0
  const [sending, setSending] = useState(false)
  const run = (operation: () => void): void => { try { operation() } catch (error) { onError(error) } }
  const send = (external: boolean): void => {
    if (!sequence) return
    setSending(true)
    void sendVideoEditAnnotations(projectId, sequence.id, '', external).catch(onError).finally(() => setSending(false))
  }
  return <div className="flex shrink-0 items-center gap-2" data-video-edit-annotation-options>
    <div role="radiogroup" aria-label="批注形状" className="flex items-center gap-0.5">
      {VIDEO_EDIT_ANNOTATION_SHAPES.map(shape => {
        const Icon = VIDEO_EDIT_ANNOTATION_SHAPE_ICONS[shape]; const command = presentation(VIDEO_EDIT_ANNOTATION_SHAPE_COMMANDS[shape])
        return <UiIconButton key={shape} size="sm" role="radio" aria-checked={brush.shape === shape} selection="mode" on={brush.shape === shape} aria-label={command.title} tooltip={command.tooltip} onClick={() => run(() => chooseVideoEditAnnotationShape(projectId, shape))}><Icon /></UiIconButton>
      })}
    </div>
    <div role="radiogroup" aria-label="批注颜色" className="flex items-center gap-1.5 px-1">
      {VIDEO_EDIT_ANNOTATION_COLOR_NAMES.map(color => <UiOptionButton key={color} variant="swatch" role="radio" aria-checked={brush.color === color} aria-label={`${VIDEO_EDIT_ANNOTATION_COLOR_LABELS[color]}色`} tooltip={`${VIDEO_EDIT_ANNOTATION_COLOR_LABELS[color]}色`} active={brush.color === color} onClick={() => run(() => setVideoEditAnnotationBrush(projectId, { color }))} style={{ backgroundColor: VIDEO_EDIT_ANNOTATION_COLORS[color] }} />)}
    </div>
    <UiSegmented<VideoEditAnnotationWeight> ariaLabel="批注粗细" size="sm" value={brush.weight} onChange={weight => run(() => setVideoEditAnnotationBrush(projectId, { weight }))}
      options={VIDEO_EDIT_ANNOTATION_WEIGHTS.map(weight => ({ value: weight, label: VIDEO_EDIT_ANNOTATION_WEIGHT_LABELS[weight] }))} />
    {reviews > 0 && <UiButton size="sm" tooltip="助手改完了；有不满意的到批注面板里驳回" onClick={() => run(() => focusVideoEditPanel(projectId, 'annotations'))}>已改完 · {reviews}</UiButton>}
    {drafts > 0 && <>
      <UiButton size="sm" variant="secondary" loading={sending} disabled={sending} onClick={() => send(false)}><Send />发送给助手 · {drafts}</UiButton>
      <PanelTrigger panelSize="menu" zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu" renderPanel={() => <div className="flex flex-col gap-1" role="menu" aria-label="更多批注操作">
        <UiOptionButton role="menuitem" variant="menu" size="sm" className="gap-2" disabled={sending} onClick={() => send(true)}><Copy size={UI_ICON_SIZE.sm} />复制给外部 Agent</UiOptionButton>
      </div>}>
        {({ open, togglePanel }) => <UiIconButton size="sm" aria-label="更多批注操作" tooltip="复制给外部 Agent" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><MoreHorizontal /></UiIconButton>}
      </PanelTrigger>
    </>}
  </div>
}
