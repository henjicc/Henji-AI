import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Check, CircleDot, Copy, CornerUpLeft, LocateFixed, Send, Trash2, Undo2 } from 'lucide-react'
import { Dropdown, PanelTrigger, UiButton, UiEmpty, UiIconButton, UiInput, UiOptionButton, UiTextArea, UiToolbar, type UiPanelFooterAction, type UiPanelFooterTool } from '@/components/ui'
import type { PanelTriggerControls } from '@/components/ui/PanelTrigger'
import { UI_DIVIDER_CLASS } from '@/components/ui/styleTokens'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { VIDEO_EDIT_ANNOTATION_STATUS_LABELS, type VideoEditAnnotation } from '@/core/videoEdit/annotations'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import { videoEditFps } from '@/core/videoEdit/time'
import { resolveVideoEditElementAnnotation } from '../application/videoEditCodeElements'
import { createVideoEditAnnotation, finishVideoEditAnnotationEdit, hoveredVideoEditAnnotation, jumpToVideoEditAnnotation, reviewVideoEditAnnotation, selectedVideoEditAnnotation, selectedVideoEditAnnotations, selectVideoEditAnnotation, sendVideoEditAnnotations, setHoveredVideoEditAnnotation, setVideoEditAnnotationEditText, setVideoEditAnnotationListFilter, setVideoEditAnnotationSelection, subscribeVideoEditAnnotationSelection, undoVideoEditAnnotationChange, VIDEO_EDIT_ANNOTATION_LIST_FILTERS, videoEditAnnotationEdit, videoEditAnnotationList, videoEditAnnotationListFilter, videoEditAnnotationSelectionRevision, type VideoEditAnnotationListEntry, type VideoEditAnnotationListFilter } from '../application/videoEditAnnotations'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from '../application/videoEditCommands'
import { focusVideoEditPanel, subscribeVideoEdit, videoEditCommittedDocument, type VideoEditInstance } from '../application/videoEditService'
import { timelineTimecode } from '../timeline/timelineGeometry'
import { VideoEditAnnotationBadge } from '../VideoEditAnnotationBadge'
import { selectVideoEditProjectItems } from './videoEditProjectModel'

interface Props { instance: VideoEditInstance; visible?: boolean; onError: (error: unknown) => void }
/** 状态点：待发送空心、待处理强调色、已改完成功色、已确认灰色（画面、面板、时间线同一套词与颜色）。 */
const STATUS_DOT: Record<VideoEditAnnotation['status'], string> = { draft: 'border border-text3', open: 'bg-accent', addressed: 'bg-success-solid', resolved: 'bg-text3' }
const clock = (value: string): string => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
/** 刚播过去的批注在列表里提亮多久（秒）。 */
const PASSING_SECONDS = 1

/** 列表里的一项：播放头细线、按时间分组的小标题、一条批注。 */
type Item = { kind: 'playhead'; label: string } | { kind: 'head'; key: string; label: string } | { kind: 'row'; entry: VideoEditAnnotationListEntry }
interface Group { key: string; sequenceId: string; start: number; end: number; entries: VideoEditAnnotationListEntry[] }

function groupsOf(entries: readonly VideoEditAnnotationListEntry[]): Group[] {
  const groups: Group[] = []
  for (const entry of entries) {
    const start = entry.mark.frame; const end = entry.mark.endFrame ?? entry.mark.frame
    const key = `${entry.sequenceId}:${start}:${end}`
    const last = groups.at(-1)
    if (last?.key === key) last.entries.push(entry); else groups.push({ key, sequenceId: entry.sequenceId, start, end, entries: [entry] })
  }
  return groups
}
/** 播放头相对活动序列各组的位置：0 已过、1 正在画面上、2 还没到；连同刚播过的那组，变了列表才需要重画。 */
function playheadSlots(groups: readonly Group[], sequenceId: string, frame: number, passing: number): string {
  return groups.filter(group => group.sequenceId === sequenceId).map(group => group.end < frame ? (frame - group.end <= passing ? 'p' : '0') : group.start <= frame ? '1' : '2').join('')
}

/**
 * 面板的批注列表（创新版草图 B1–B3）：列表就是一条竖着的时间线，活动序列按时间分组，强调色细线是播放头，
 * 正在画面上的那几条紧跟其下；“跟随播放头”开着时列表随播放头滚动，播放中刚经过的那组短暂提亮。
 * 每条一行（同色序号 + 单行正文 + 状态点），悬停看全文；选中的那条就地展开成文本框，和画面标签编辑同一份文字。
 * 指针停在一行上时，画面与时间线上只亮这一条。可以多选（Shift 连选、Ctrl 加选、Ctrl+A 全选当前筛选），
 * 底栏右边是对选中的批量操作与唯一主动作“发送”，每个按钮执行的是菜单栏“批注”里的同一条命令。
 */
export const VideoEditAnnotationsPanel = memo(function VideoEditAnnotationsPanel({ instance, visible = true, onError }: Props): React.ReactElement {
  const snapshot = useRef<{ document: VideoEditInstance['document']; view: string }>()
  const anchor = useRef<string | null>(null)
  const list = useRef<VirtuosoHandle | null>(null)
  const composer = useRef<PanelTriggerControls | null>(null)
  useSyncExternalStore(subscribeVideoEditAnnotationSelection, videoEditAnnotationSelectionRevision)
  useSyncExternalStore(subscribeVideoEdit, () => {
    const document = videoEditCommittedDocument(instance)
    // 面板藏起来时不算播放头位置（播放中每帧都会问一次）
    if (!visible) { if (!snapshot.current || snapshot.current.document !== document) snapshot.current = { document, view: '' }; return snapshot.current }
    const sequence = document.sequences.find(item => item.id === instance.activeSequenceId)
    const fps = sequence ? videoEditFps(sequence.frameRate) : 30
    // 播放中只在播放头跨过某组时重画（播放头那一行不写时间码，免得显示过时的读数）；停着时拖动播放头逐帧更新
    const slots = playheadSlots(groupsOf(videoEditAnnotationList(instance)), instance.activeSequenceId, instance.frame, instance.playing ? fps * PASSING_SECONDS : 0)
    const view = JSON.stringify([instance.activeSequenceId, instance.inFrame, instance.outFrame, instance.targetTrackIds, instance.selectedClipIds, selectedVideoEditAnnotation(instance.document.id), slots, instance.playing || instance.frame])
    if (!snapshot.current || snapshot.current.document !== document || snapshot.current.view !== view) snapshot.current = { document, view }
    return snapshot.current
  })
  const [note, setNote] = useState(''); const [sending, setSending] = useState(false); const [rangeNote, setRangeNote] = useState('')
  const [follow, setFollow] = useState(true)
  /** 选中后按 Esc 或点开别处收回成一行的那条；再点它又展开。 */
  const [collapsed, setCollapsed] = useState<string | null>(null)
  const projectId = instance.document.id
  const filter = videoEditAnnotationListFilter(instance)
  const sequence = instance.document.sequences.find(sequence => sequence.id === instance.activeSequenceId)
  const fps = sequence ? videoEditFps(sequence.frameRate) : 30
  const drafts = sequence?.annotations.filter(mark => mark.status === 'draft') ?? []
  const total = instance.document.sequences.reduce((sum, sequence) => sum + sequence.annotations.length, 0)
  const entries = videoEditAnnotationList(instance)
  const chosen = selectedVideoEditAnnotations(instance)
  const chosenIds = new Set(chosen.map(entry => entry.mark.id))
  const selected = selectedVideoEditAnnotation(projectId)
  const hovered = hoveredVideoEditAnnotation(projectId)
  const edit = videoEditAnnotationEdit(projectId)
  const context = captureVideoEditCommandContext(projectId, 'annotations', { includeClipboard: false })
  const available = (id: VideoEditCommandId) => videoEditCommandState(context, id)
  const command = (id: VideoEditCommandId): void => { void executeVideoEditCommand(captureVideoEditCommandContext(projectId, 'annotations', { includeClipboard: false }), id).catch(onError) }
  const run = (action: () => void): void => { try { action() } catch (error) { onError(error) } }

  // 列表项：活动序列在前、按时间分组并插入播放头；其他序列各自一节放在后面
  const groups = groupsOf(entries)
  const frame = instance.frame
  const items: Item[] = []
  let playheadIndex = -1
  const multiSequence = new Set(groups.map(group => group.sequenceId)).size > 1 || groups.some(group => group.sequenceId !== instance.activeSequenceId)
  for (const sequenceId of [instance.activeSequenceId, ...instance.document.sequences.map(item => item.id).filter(id => id !== instance.activeSequenceId)]) {
    const own = groups.filter(group => group.sequenceId === sequenceId)
    const active = sequenceId === instance.activeSequenceId
    if (!own.length && !active) continue
    if (multiSequence && !active) items.push({ kind: 'head', key: `seq:${sequenceId}`, label: instance.document.sequences.find(item => item.id === sequenceId)?.name ?? '' })
    const placePlayhead = (): void => { if (active && playheadIndex < 0 && own.length) { playheadIndex = items.length; items.push({ kind: 'playhead', label: instance.playing ? '' : timelineTimecode(frame, fps) }) } }
    for (const group of own) {
      // 播放头插在第一组“还没开始”的前面：正好在这一帧的点批注排在线下（画面上），跨过这一帧的时间段留在线上
      if (group.start >= frame) placePlayhead()
      const onFrame = active && group.start <= frame && frame <= group.end
      const time = group.end > group.start ? `${timelineTimecode(group.start, fps)} – ${timelineTimecode(group.end, fps)}` : timelineTimecode(group.start, fps)
      items.push({ kind: 'head', key: group.key, label: onFrame ? `画面上 ${group.entries.length} 条` : group.entries.length > 1 ? `${time} · ${group.entries.length} 条` : time })
      for (const entry of group.entries) items.push({ kind: 'row', entry })
    }
    placePlayhead()
  }
  const passing = new Set(instance.playing ? groups.filter(group => group.sequenceId === instance.activeSequenceId && group.end < frame && frame - group.end <= fps * PASSING_SECONDS).flatMap(group => group.entries.map(entry => entry.mark.id)) : [])
  const slotKey = snapshot.current?.view
  useEffect(() => { if (follow && visible && playheadIndex >= 0) list.current?.scrollToIndex({ index: playheadIndex, align: 'start' }) }, [follow, visible, playheadIndex, slotKey])

  /** 单击选中并跳到这一条；Ctrl 加选或取消、Shift 从上次单击的那条连选，都不跳转。 */
  const pick = (event: React.MouseEvent, id: string): void => {
    try {
      const toggle = event.ctrlKey || event.metaKey; const range = event.shiftKey
      setCollapsed(null)
      if (!toggle && !range) { anchor.current = id; selectVideoEditAnnotation(projectId, id); jumpToVideoEditAnnotation(projectId, id); return }
      const next = selectVideoEditProjectItems(entries.map(entry => entry.mark.id), chosen.map(entry => entry.mark.id), id, anchor.current ?? selected ?? null, { toggle, range })
      if (!range) anchor.current = id
      setVideoEditAnnotationSelection(projectId, next, next.includes(id) ? id : next.at(-1))
    } catch (error) { onError(error) }
  }
  // 面板里的点选不经过节目画面跳转时，快捷键（Ctrl+A、Delete）也要落到批注上
  const claimKeyboard = (): void => { if (instance.activePanel !== 'annotations') focusVideoEditPanel(projectId, 'annotations', { reveal: false }) }
  const commandTool = (id: VideoEditCommandId, label: string, tooltip: string, icon: UiPanelFooterAction['icon'], tone?: 'danger'): UiPanelFooterAction => {
    const state = available(id)
    return { kind: 'action', id, label, tooltip, icon, tone, disabled: !state.enabled, disabledReason: state.reason, onSelect: () => command(id) }
  }
  const commandMenu = (items: readonly { id: VideoEditCommandId; label: string }[]) => items.map(item => { const state = available(item.id); return <UiOptionButton key={item.id} variant="menu" size="sm" disabled={!state.enabled} disabledReason={state.reason} onClick={() => command(item.id)}>{item.label}</UiOptionButton> })
  const send = async (external: boolean): Promise<void> => { if (!sequence) return; setSending(true); try { await sendVideoEditAnnotations(projectId, sequence.id, note, external); setNote('') } catch (error) { onError(error) } finally { setSending(false) } }
  const sendTool: UiPanelFooterTool[] = drafts.length ? [{ kind: 'custom', id: 'send', label: '发送', priority: 9, node: <PanelTrigger panelSize="compact" panelPadding="content" alignment="bottomRight" zIndex={Z_LAYERS.dropdown} controlsRef={composer} renderPanel={() => <div className="flex flex-col gap-3" data-video-edit-annotation-composer>
    <UiInput size="sm" autoFocus aria-label="批注整体说明" placeholder="整体说明（可选）" value={note} onChange={event => setNote(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); composer.current?.closePanel(); void send(false) } }} />
    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
      <UiButton size="sm" disabled={sending} onClick={() => { composer.current?.closePanel(); void send(true) }}><Copy />复制给外部 Agent</UiButton>
      <UiButton variant="primary" size="sm" disabled={sending} onClick={() => { composer.current?.closePanel(); void send(false) }}><Send />发送给助手</UiButton>
    </div>
  </div>}>
    {({ open, togglePanel }) => <UiButton variant="primary" size="sm" loading={sending} disabled={sending} aria-expanded={open} data-panel-trigger-button tooltip="把待发送的批注发给助手处理" onClick={togglePanel}><Send />发送 {drafts.length} 条</UiButton>}
  </PanelTrigger> }] : []
  const tools: UiPanelFooterTool[] = [...(chosen.length > 0 ? [
    commandTool('annotations_resolve', '确认选中批注', '确认选中的已改完批注', Check),
    commandTool('annotations_reject', '驳回选中批注', '没改好，退回给助手重改', CornerUpLeft),
    { kind: 'menu', id: 'status', label: '改状态', tooltip: '把选中的批注改成某个状态', icon: CircleDot, menu: () => commandMenu(STATUS_COMMANDS) } satisfies UiPanelFooterTool,
    commandTool('delete', '删除选中批注', '删除选中的批注', Trash2, 'danger'),
  ] : []), ...sendTool]
  // 面板自己的低频操作与收起的工具共用底栏这一个“更多”
  const moreCommands = <>
    {commandMenu(MORE_COMMANDS.slice(0, 2))}
    <div className={`my-1 ${UI_DIVIDER_CLASS}`} />
    {commandMenu(MORE_COMMANDS.slice(2))}
  </>
  const addRange = (): void => {
    if (!sequence || instance.inFrame === null || instance.outFrame === null || !rangeNote.trim()) return
    try { createVideoEditAnnotation(projectId, sequence.id, { frame: instance.inFrame, endFrame: instance.outFrame - 1, target: { kind: 'range', startFrame: instance.inFrame, endFrame: instance.outFrame - 1, ...(instance.targetTrackIds.length ? { trackIds: [...instance.targetTrackIds] } : {}), ...(instance.selectedClipIds.length ? { clipIds: [...instance.selectedClipIds] } : {}) }, text: rangeNote }); setRangeNote('') } catch (error) { onError(error) }
  }
  if (!visible) return <div />
  const renderItem = (item: Item): React.ReactElement => {
    if (item.kind === 'playhead') return <div className="flex h-4 items-center gap-1.5 px-2 text-3xs tabular-nums text-accent-text" data-video-edit-annotation-playhead>{item.label && <span>{item.label}</span>}<span aria-hidden="true" className="h-px flex-1 bg-accent-ring" /></div>
    if (item.kind === 'head') return <div className="flex h-6 items-end truncate px-2 pb-1 text-2xs tabular-nums text-text3">{item.label}</div>
    const { entry } = item
    return <AnnotationRow instance={instance} entry={entry} onError={onError} expanded={chosen.length <= 1 && selected === entry.mark.id && collapsed !== entry.mark.id}
      picked={chosen.length > 1 && chosenIds.has(entry.mark.id)} highlighted={hovered === entry.mark.id || passing.has(entry.mark.id)} editText={edit?.id === entry.mark.id ? edit.text : undefined}
      onPick={pick} onCollapse={() => setCollapsed(entry.mark.id)} run={run} />
  }
  return <div className="flex h-full min-h-0 flex-col" aria-label="批注面板" onPointerDownCapture={claimKeyboard} onFocusCapture={claimKeyboard}>
    {instance.inFrame !== null && instance.outFrame !== null && <div className="flex shrink-0 flex-col gap-2 border-b border-line px-3 py-3">
      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-text1">入出点这一段<span className="tabular-nums text-2xs font-normal text-text3">{timelineTimecode(instance.inFrame, fps)} – {timelineTimecode(instance.outFrame - 1, fps)}</span></span>
      <div className="flex items-center gap-1"><UiInput size="sm" className="min-w-0 flex-1" aria-label="时间段标注说明" placeholder="这段要改什么？" value={rangeNote} onChange={event => setRangeNote(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) addRange() }} /><UiButton size="sm" variant="secondary" disabled={!rangeNote.trim()} onClick={addRange}>标注时间段</UiButton></div>
    </div>}
    {total > 0 && <div className="flex h-band-tab shrink-0 items-center px-1.5">
      <Dropdown ariaLabel="筛选批注" appearance="text" size="sm" value={filter} onSelect={value => setVideoEditAnnotationListFilter(projectId, value as VideoEditAnnotationListFilter)} options={[...VIDEO_EDIT_ANNOTATION_LIST_FILTERS]} />
      <span className="flex-1" />
      <UiIconButton size="sm" on={follow} aria-pressed={follow} aria-label="跟随播放头" tooltip={follow ? '跟随播放头：列表随播放头滚动（点一下关闭）' : '跟随播放头：让列表随播放头滚动'} onClick={() => setFollow(value => !value)}><LocateFixed /></UiIconButton>
    </div>}
    <div className="min-h-0 flex-1 px-1">{entries.length ? <Virtuoso ref={list} className="h-full" data={items} computeItemKey={(_index, item) => item.kind === 'row' ? item.entry.mark.id : item.kind === 'head' ? item.key : 'playhead'} itemContent={(_index, item) => renderItem(item)} />
      : total ? <UiEmpty size="xs" title="暂无批注" description={filter === 'active' ? '都确认过了，已确认的在“已确认”筛选里。' : '换一个筛选看看。'} />
        : <UiEmpty size="xs" title="还没有批注" description="在命令带选批注工具，直接在画面上画。" />}</div>
    {total > 0 && <UiToolbar variant="footer" aria-label="批注工具" tools={tools} more={moreCommands} moreLabel="更多批注操作">
      <span className="truncate">{chosen.length ? `已选 ${chosen.length}` : `${entries.length} 条`}</span>
    </UiToolbar>}
  </div>
})

/** 底栏“改状态”菜单：每一项就是对应的批量命令（确认与驳回会附上审查回复）。 */
const STATUS_COMMANDS = [{ id: 'annotations_reject', label: '标为待处理' }, { id: 'annotations_mark_addressed', label: '标为已改完' }, { id: 'annotations_resolve', label: '标为已确认' }] as const satisfies readonly { id: VideoEditCommandId; label: string }[]
const MORE_COMMANDS = [{ id: 'annotations_select_in_out', label: '按入出点选' }, { id: 'annotations_select_clips', label: '按选中片段选' }, { id: 'annotations_clear_handled', label: '清除已处理' }, { id: 'annotations_clear_all', label: '清除全部' }] as const satisfies readonly { id: VideoEditCommandId; label: string }[]

interface RowProps {
  instance: VideoEditInstance; entry: VideoEditAnnotationListEntry; expanded: boolean; picked: boolean; highlighted: boolean
  /** 正在改、还没保存的文字（列表与画面标签共用），没在改时为 undefined */
  editText?: string
  onPick: (event: React.MouseEvent, id: string) => void; onCollapse: () => void; run: (action: () => void) => void; onError: (error: unknown) => void
}

/**
 * 一条批注：收起时一行（同色序号、单行正文、状态点），悬停看全文；只选中这一条时就地展开，原来那一行变成文本框，
 * 下面跟时间与状态；已改完的再给审查（驳回理由、确认、撤销这次修改），已确认的给重开。多选时选中的几条铺中性选中底、都不展开。
 */
function AnnotationRow({ instance, entry, expanded, picked, highlighted, editText, onPick, onCollapse, run }: RowProps): React.ReactElement {
  const { mark, number, fps, sequenceId } = entry
  const projectId = instance.document.id
  const element = mark.target.kind === 'element' ? resolveVideoEditElementAnnotation(instance, mark, sequenceId, mark.frame) : undefined
  const [reason, setReason] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const resolved = mark.status === 'resolved'
  const editable = mark.status === 'draft' || mark.status === 'open'
  const hover = { onPointerEnter: () => setHoveredVideoEditAnnotation(projectId, mark.id), onPointerLeave: () => setHoveredVideoEditAnnotation(projectId, null) }
  // 指针停着时这一行被卸载（删掉、筛掉、列表回收）收不到离开事件，自己把悬停清掉，免得画面上其余批注一直压暗
  useEffect(() => () => { if (hoveredVideoEditAnnotation(projectId) === mark.id) setHoveredVideoEditAnnotation(projectId, null) }, [projectId, mark.id])
  const time = `${timelineTimecode(mark.frame, fps)}${mark.endFrame !== undefined ? ` – ${timelineTimecode(mark.endFrame, fps)}` : ''}`
  const statusDot = <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[mark.status]}`} />
  if (!expanded) return <div className={`py-px ${highlighted ? 'rounded-control bg-hover' : ''}`} data-video-edit-annotation={mark.id} {...hover}>
    <UiOptionButton variant="menu" active={picked} aria-pressed={picked || undefined} aria-expanded={false} aria-label={`跳到标注 ${number}`} tooltip={mark.text} className="w-full gap-2" onClick={event => onPick(event, mark.id)}>
      <VideoEditAnnotationBadge number={number} muted={resolved} />
      <span className={`min-w-0 flex-1 truncate text-13 ${resolved ? 'text-text3' : 'text-text1'}`}>{mark.text}</span>
      <span className="sr-only">{VIDEO_EDIT_ANNOTATION_STATUS_LABELS[mark.status]}</span>{statusDot}
    </UiOptionButton>
  </div>
  const reject = (): void => run(() => { reviewVideoEditAnnotation(projectId, mark.id, false, reason); setReason('') })
  return <div className="py-px" data-video-edit-annotation={mark.id} data-expanded {...hover}>
    <div ref={box} className="flex gap-2 rounded-control bg-selected px-2 pb-2.5 pt-1.5"
      onBlur={event => { if (!box.current?.contains(event.relatedTarget as Node | null) && editText === undefined) onCollapse() }}>
      <UiIconButton size="2xs" tone="bare" aria-expanded aria-label={`跳到标注 ${number}`} tooltip="跳到这条批注的画面" onClick={event => onPick(event, mark.id)}><VideoEditAnnotationBadge number={number} muted={resolved} /></UiIconButton>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {editable ? <UiTextArea height="line" fit="content" aria-label={`标注 ${number} 说明`} value={editText ?? mark.text}
          onFocus={() => setVideoEditAnnotationEditText(projectId, mark.id, editText ?? mark.text)}
          onChange={event => setVideoEditAnnotationEditText(projectId, mark.id, event.target.value)}
          onBlur={event => { run(() => finishVideoEditAnnotationEdit(projectId, mark.id, true)); if (!box.current?.contains(event.relatedTarget as Node | null)) onCollapse() }}
          onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); run(() => finishVideoEditAnnotationEdit(projectId, mark.id, false)); onCollapse() } }} />
          : <p className={`whitespace-pre-wrap break-words text-13 ${resolved ? 'text-text3' : 'text-text1'}`}>{mark.text}</p>}
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-2xs text-text3">
          <span className="tabular-nums">{time}</span>{statusDot}{VIDEO_EDIT_ANNOTATION_STATUS_LABELS[mark.status]}
          {element && <span className="min-w-0 truncate">· {element.missing ? '元素已不存在' : element.label}</span>}
        </span>
        {mark.status === 'addressed' && <>
          {mark.thread.map(message => <div key={message.id} className="flex flex-col gap-0.5">
            <span className="text-2xs text-text3">{message.author.name} · {clock(message.createdAt)}</span>
            <p className="whitespace-pre-wrap break-words text-xs text-text2">{message.text}</p>
          </div>)}
          <UiInput size="sm" aria-label={`标注 ${number} 驳回理由`} placeholder="驳回理由（可选），驳回时一起发给助手" value={reason} onChange={event => setReason(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); reject() } }} />
          <div className="flex items-center gap-1 whitespace-nowrap">
            <UiButton variant="secondary" size="sm" tooltip="没改好，退回给助手重改（上面填的理由会一起带上）" onClick={reject}>驳回</UiButton>
            <UiButton size="sm" tooltip="确认改好了，这条从列表里收起" onClick={() => run(() => reviewVideoEditAnnotation(projectId, mark.id, true))}><Check />确认</UiButton>
            {/* 手动标的已改完没有关联修改，不出现撤销 */}
            {mark.addressedBy?.transactionId && <UiIconButton size="sm" aria-label="撤销这次修改" tooltip="撤销助手为这条做的修改" onClick={() => run(() => undoVideoEditAnnotationChange(projectId, mark.id))}><Undo2 /></UiIconButton>}
          </div>
        </>}
        {resolved && <div className="flex"><UiButton size="sm" onClick={() => run(() => reviewVideoEditAnnotation(projectId, mark.id, false))}>重开</UiButton></div>}
      </div>
    </div>
  </div>
}

