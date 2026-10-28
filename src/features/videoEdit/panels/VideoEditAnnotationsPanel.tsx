import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Check, CircleDot, Copy, CornerUpLeft, Send, Trash2, Undo2 } from 'lucide-react'
import { Dropdown, UiButton, UiEmpty, UiIconButton, UiInput, UiOptionButton, UiOverflowRow, UiTextArea, UiToolbar, type UiPanelFooterAction, type UiPanelFooterTool } from '@/components/ui'
import { UI_DIVIDER_CLASS } from '@/components/ui/styleTokens'
import { VIDEO_EDIT_ANNOTATION_COLORS } from '@/core/theme/colorTokens'
import { VIDEO_EDIT_ANNOTATION_STATUS_LABELS, videoEditAnnotationColor, type VideoEditAnnotation } from '@/core/videoEdit/annotations'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import { videoEditFps } from '@/core/videoEdit/time'
import { resolveVideoEditElementAnnotation } from '../application/videoEditCodeElements'
import { createVideoEditAnnotation, deleteVideoEditAnnotation, jumpToVideoEditAnnotation, reviewVideoEditAnnotation, selectedVideoEditAnnotation, selectedVideoEditAnnotations, selectVideoEditAnnotation, sendVideoEditAnnotations, setVideoEditAnnotationListFilter, setVideoEditAnnotationSelection, subscribeVideoEditAnnotationSelection, undoVideoEditAnnotationChange, updateVideoEditAnnotation, VIDEO_EDIT_ANNOTATION_LIST_FILTERS, videoEditAnnotationList, videoEditAnnotationListFilter, videoEditAnnotationSelectionRevision, type VideoEditAnnotationListFilter } from '../application/videoEditAnnotations'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from '../application/videoEditCommands'
import { focusVideoEditPanel, subscribeVideoEdit, videoEditCommittedDocument, type VideoEditInstance } from '../application/videoEditService'
import { timelineTimecode } from '../timeline/timelineGeometry'
import { selectVideoEditProjectItems } from './videoEditProjectModel'

interface Props { instance: VideoEditInstance; visible?: boolean; onError: (error: unknown) => void }
interface RowProps { sequenceId: string; mark: VideoEditAnnotation; number: number; fps: number; expanded: boolean; picked: boolean; onPick: (event: React.MouseEvent, id: string) => void }
/** 状态点：待发送空心、待处理强调色、已改完成功色、已确认灰色（画面、面板、时间线同一套词与颜色）。 */
const STATUS_DOT: Record<VideoEditAnnotation['status'], string> = { draft: 'border border-text3', open: 'bg-accent', addressed: 'bg-success-solid', resolved: 'bg-text3' }
const ink = (mark: VideoEditAnnotation): string => ['white', 'yellow'].includes(videoEditAnnotationColor(mark)) ? VIDEO_EDIT_ANNOTATION_COLORS.black : VIDEO_EDIT_ANNOTATION_COLORS.white
const reply = (text: string) => ({ id: crypto.randomUUID(), author: { kind: 'user' as const, name: '我' }, createdAt: new Date().toISOString(), text })
const clock = (value: string): string => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * 一条批注（重要记录 019）：编号徽标与画面上同色；正文 + 时间码与状态。只选中一条时不铺底色，展开出这一条要做的事
 * （草稿改文字、讨论、审查、补充说明）；多选时选中的几条铺中性选中底、都不展开。删除只在悬停或展开时出现。
 */
function AnnotationRow({ instance, sequenceId, mark, number, fps, expanded, picked, onPick, onError }: Props & RowProps): React.ReactElement {
  const element = mark.target.kind === 'element' ? resolveVideoEditElementAnnotation(instance, mark, sequenceId, mark.frame) : undefined
  const [text, setText] = useState(mark.text); const [note, setNote] = useState('')
  useEffect(() => { setText(mark.text) }, [mark.text])
  const projectId = instance.document.id
  const run = (action: () => void): void => { try { action() } catch (error) { onError(error) } }
  const commitText = (): void => { if (text.trim() && text !== mark.text) run(() => updateVideoEditAnnotation(projectId, mark.id, current => ({ ...current, text }))) }
  const append = (): void => { if (!note.trim()) return; run(() => { updateVideoEditAnnotation(projectId, mark.id, current => ({ ...current, thread: [...current.thread, reply(note)] })); setNote('') }) }
  const resolved = mark.status === 'resolved'
  const noteLabel = mark.status === 'addressed' ? `标注 ${number} 驳回理由` : `标注 ${number} 补充说明`
  const reject = (): void => run(() => { reviewVideoEditAnnotation(projectId, mark.id, false, note); setNote('') })
  return <div className="group/annotation relative px-1" data-video-edit-annotation={mark.id} data-expanded={expanded || undefined}>
    <UiOptionButton variant="menu" active={picked} aria-pressed={picked || undefined} aria-label={`跳到标注 ${number}`} aria-expanded={expanded} className="w-full items-start gap-2" onClick={event => onPick(event, mark.id)}>
      <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold ${resolved ? 'opacity-50' : ''}`} style={{ backgroundColor: VIDEO_EDIT_ANNOTATION_COLORS[videoEditAnnotationColor(mark)], color: ink(mark) }}>{number}</span>
      <span className="mr-6 flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`line-clamp-2 whitespace-normal break-words text-13 ${resolved ? 'text-text3' : 'text-text1'}`}>{mark.text}</span>
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-2xs text-text3">
          <span className="font-mono">{timelineTimecode(mark.frame, fps)}{mark.endFrame !== undefined ? ` – ${timelineTimecode(mark.endFrame, fps)}` : ''}</span>
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[mark.status]}`} />{VIDEO_EDIT_ANNOTATION_STATUS_LABELS[mark.status]}
          {element && <span className="min-w-0 truncate">· {element.missing ? '元素已不存在' : element.label}</span>}
        </span>
      </span>
    </UiOptionButton>
    <UiIconButton size="xs" tone="danger" aria-label={`删除标注 ${number}`} tooltip="删除这条批注" className={`absolute right-2 top-1.5 ${expanded ? '' : 'opacity-0 focus-visible:opacity-100 group-hover/annotation:opacity-100'}`} onClick={() => run(() => deleteVideoEditAnnotation(projectId, mark.id))}><Trash2 /></UiIconButton>
    {/* 已改完的不用展开也能驳回：悬停这一条就在右下（状态行那一侧）出现文字按钮，不压正文 */}
    {mark.status === 'addressed' && !expanded && <UiButton size="sm" aria-label={`驳回标注 ${number}`} tooltip="没改好，退回给助手重改" className="absolute bottom-0.5 right-2 opacity-0 focus-visible:opacity-100 group-hover/annotation:opacity-100" onClick={reject}>驳回</UiButton>}
    {expanded && <div className="flex gap-2 px-3 pb-3" data-video-edit-annotation-details><span aria-hidden="true" className="w-5 shrink-0" /><div className="flex min-w-0 flex-1 flex-col gap-2">
      {mark.status === 'draft' && <UiTextArea aria-label={`标注 ${number} 说明`} rows={2} value={text} onChange={event => setText(event.target.value)} onBlur={commitText} />}
      {mark.thread.map(message => <div key={message.id} className="flex flex-col gap-0.5">
        <span className="text-2xs text-text3">{message.author.name} · {clock(message.createdAt)}</span>
        <p className="whitespace-pre-wrap break-words text-xs text-text2">{message.text}</p>
      </div>)}
      {mark.status === 'addressed' && <div className="flex flex-wrap items-center gap-1">
        <UiButton variant="secondary" size="sm" tooltip="没改好，退回给助手重改（下面填的理由会一起带上）" onClick={reject}>驳回</UiButton>
        <UiButton size="sm" tooltip="确认改好了，这条从列表里收起" onClick={() => run(() => reviewVideoEditAnnotation(projectId, mark.id, true))}><Check />确认</UiButton>
        {/* 手动标的已改完没有关联修改，不出现撤销 */}
        {mark.addressedBy?.transactionId && <UiButton size="sm" onClick={() => run(() => undoVideoEditAnnotationChange(projectId, mark.id))}><Undo2 />撤销这次修改</UiButton>}
      </div>}
      {resolved && <div className="flex"><UiButton size="sm" onClick={() => run(() => reviewVideoEditAnnotation(projectId, mark.id, false))}>重开</UiButton></div>}
      {!resolved && mark.status !== 'draft' && <div className="flex items-center gap-1">
        <UiInput size="sm" className="min-w-0 flex-1" aria-label={noteLabel} placeholder={mark.status === 'addressed' ? '驳回理由（可选），驳回时一起发给助手' : '补充说明'} value={note} onChange={event => setNote(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); append() } }} />
        <UiIconButton size="sm" aria-label="补充" tooltip="补充到讨论" disabled={!note.trim()} onClick={append}><Send /></UiIconButton>
      </div>}
    </div></div>}
  </div>
}

/** 底栏“改状态”菜单：每一项就是对应的批量命令（确认与驳回会附上审查回复）。 */
const STATUS_COMMANDS = [{ id: 'annotations_reject', label: '标为待处理' }, { id: 'annotations_mark_addressed', label: '标为已改完' }, { id: 'annotations_resolve', label: '标为已确认' }] as const satisfies readonly { id: VideoEditCommandId; label: string }[]
const MORE_COMMANDS = [{ id: 'annotations_select_in_out', label: '按入出点选' }, { id: 'annotations_select_clips', label: '按选中片段选' }, { id: 'annotations_clear_handled', label: '清除已处理' }, { id: 'annotations_clear_all', label: '清除全部' }] as const satisfies readonly { id: VideoEditCommandId; label: string }[]

/**
 * 批注面板（重要记录 019）：有待发送时顶部才出现发送区；入出点设好时可以批注这一段；然后是筛选和批注列表。
 * 列表可以多选（Shift 连选、Ctrl 加选、Ctrl+A 全选当前筛选）；底栏左边是条数与已选，右边是对选中的批量操作，
 * 每个按钮执行的是菜单栏“批注”里的同一条命令。画在节目画面上的批注由命令带里的批注工具负责，这里只看、审、发。
 */
export const VideoEditAnnotationsPanel = memo(function VideoEditAnnotationsPanel({ instance, visible = true, onError }: Props): React.ReactElement {
  const snapshot = useRef<{ document: VideoEditInstance['document']; view: string }>()
  const anchor = useRef<string | null>(null)
  useSyncExternalStore(subscribeVideoEditAnnotationSelection, videoEditAnnotationSelectionRevision)
  useSyncExternalStore(subscribeVideoEdit, () => {
    const document = videoEditCommittedDocument(instance)
    const view = JSON.stringify([instance.activeSequenceId, instance.inFrame, instance.outFrame, instance.targetTrackIds, instance.selectedClipIds, selectedVideoEditAnnotation(instance.document.id)])
    if (!snapshot.current || snapshot.current.document !== document || snapshot.current.view !== view) snapshot.current = { document, view }
    return snapshot.current
  })
  const [note, setNote] = useState(''); const [sending, setSending] = useState(false); const [rangeNote, setRangeNote] = useState('')
  const projectId = instance.document.id
  const filter = videoEditAnnotationListFilter(instance)
  const sequence = instance.document.sequences.find(sequence => sequence.id === instance.activeSequenceId)
  const drafts = sequence?.annotations.filter(mark => mark.status === 'draft') ?? []
  const total = instance.document.sequences.reduce((sum, sequence) => sum + sequence.annotations.length, 0)
  const entries = videoEditAnnotationList(instance)
  const chosen = selectedVideoEditAnnotations(instance)
  const chosenIds = new Set(chosen.map(entry => entry.mark.id))
  const selected = selectedVideoEditAnnotation(projectId)
  const context = captureVideoEditCommandContext(projectId, 'annotations', { includeClipboard: false })
  const available = (id: VideoEditCommandId) => videoEditCommandState(context, id)
  const command = (id: VideoEditCommandId): void => { void executeVideoEditCommand(captureVideoEditCommandContext(projectId, 'annotations', { includeClipboard: false }), id).catch(onError) }
  /** 单击选中并跳到这一条；Ctrl 加选或取消、Shift 从上次单击的那条连选，都不跳转。 */
  const pick = (event: React.MouseEvent, id: string): void => {
    try {
      const toggle = event.ctrlKey || event.metaKey; const range = event.shiftKey
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
  const tools: UiPanelFooterTool[] = chosen.length > 0 ? [
    commandTool('annotations_resolve', '确认选中批注', '确认选中的已改完批注', Check),
    commandTool('annotations_reject', '驳回选中批注', '没改好，退回给助手重改', CornerUpLeft),
    { kind: 'menu', id: 'status', label: '改状态', tooltip: '把选中的批注改成某个状态', icon: CircleDot, menu: () => commandMenu(STATUS_COMMANDS) },
    commandTool('delete', '删除选中批注', '删除选中的批注', Trash2, 'danger'),
  ] : []
  // 面板自己的低频操作与收起的工具共用底栏这一个“更多”
  const moreCommands = <>
    {commandMenu(MORE_COMMANDS.slice(0, 2))}
    <div className={`my-1 ${UI_DIVIDER_CLASS}`} />
    {commandMenu(MORE_COMMANDS.slice(2))}
  </>
  const send = async (external: boolean): Promise<void> => { if (!sequence) return; setSending(true); try { await sendVideoEditAnnotations(projectId, sequence.id, note, external); setNote('') } catch (error) { onError(error) } finally { setSending(false) } }
  const addRange = (): void => {
    if (!sequence || instance.inFrame === null || instance.outFrame === null || !rangeNote.trim()) return
    try { createVideoEditAnnotation(projectId, sequence.id, { frame: instance.inFrame, endFrame: instance.outFrame - 1, target: { kind: 'range', startFrame: instance.inFrame, endFrame: instance.outFrame - 1, ...(instance.targetTrackIds.length ? { trackIds: [...instance.targetTrackIds] } : {}), ...(instance.selectedClipIds.length ? { clipIds: [...instance.selectedClipIds] } : {}) }, text: rangeNote }); setRangeNote('') } catch (error) { onError(error) }
  }
  if (!visible) return <div />
  const fps = sequence ? videoEditFps(sequence.frameRate) : 30
  return <div className="flex h-full min-h-0 flex-col" aria-label="批注面板" onPointerDownCapture={claimKeyboard} onFocusCapture={claimKeyboard}>
    {drafts.length > 0 && <div className="flex shrink-0 flex-col gap-2 border-b border-line px-4 py-3" data-video-edit-annotation-composer>
      <span className="text-xs font-semibold text-text1">{drafts.length} 条待发送</span>
      <UiInput size="sm" aria-label="标注整体说明" placeholder="整体说明（可选）" value={note} onChange={event => setNote(event.target.value)} />
      <div className="flex flex-wrap items-center gap-1">
        <UiButton variant="primary" size="sm" disabled={sending} loading={sending} onClick={() => { void send(false) }}><Send />发送给助手</UiButton>
        <UiButton size="sm" disabled={sending} onClick={() => { void send(true) }}><Copy />复制给外部 Agent</UiButton>
      </div>
    </div>}
    {instance.inFrame !== null && instance.outFrame !== null && <div className="flex shrink-0 flex-col gap-2 border-b border-line px-4 py-3">
      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-text1">入出点这一段<span className="font-mono text-2xs font-normal text-text3">{timelineTimecode(instance.inFrame, fps)} – {timelineTimecode(instance.outFrame - 1, fps)}</span></span>
      <div className="flex items-center gap-1"><UiInput size="sm" className="min-w-0 flex-1" aria-label="时间段标注说明" placeholder="这段要改什么？" value={rangeNote} onChange={event => setRangeNote(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) addRange() }} /><UiButton size="sm" variant="secondary" disabled={!rangeNote.trim()} onClick={addRange}>标注时间段</UiButton></div>
    </div>}
    {total > 0 && <div className="flex h-band-tab shrink-0 items-center px-1.5">
      <Dropdown ariaLabel="筛选批注" appearance="text" size="sm" value={filter} onSelect={value => setVideoEditAnnotationListFilter(projectId, value as VideoEditAnnotationListFilter)} options={[...VIDEO_EDIT_ANNOTATION_LIST_FILTERS]} />
    </div>}
    <div className="min-h-0 flex-1">{entries.length ? <Virtuoso className="h-full" data={entries} computeItemKey={(_index, entry) => entry.mark.id} itemContent={(_index, entry) => <AnnotationRow instance={instance} onError={onError} expanded={chosen.length <= 1 && selected === entry.mark.id} picked={chosen.length > 1 && chosenIds.has(entry.mark.id)} onPick={pick} {...entry} />} />
      : total ? <UiEmpty size="xs" title="暂无批注" description={filter === 'active' ? '都确认过了，已确认的在“已确认”筛选里。' : '换一个筛选看看。'} />
        : <UiEmpty size="xs" title="还没有批注" description="在命令带选批注工具，直接在画面上画。" />}</div>
    {total > 0 && <UiToolbar variant="footer" aria-label="批注工具" tools={tools} more={moreCommands} moreLabel="更多批注操作">
      {/* 面板压窄时先让出“已选”，只留条数 */}
      <UiOverflowRow items={[{ id: 'count', priority: 2, pinned: true, node: <span>{entries.length} 条</span> }, ...(chosen.length ? [{ id: 'selection', priority: 1, node: <span>&nbsp;· 已选 {chosen.length}</span> }] : [])]} renderOverflow={() => null} />
    </UiToolbar>}
  </div>
})
