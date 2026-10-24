import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Check, Copy, Send, Trash2, Undo2 } from 'lucide-react'
import { Dropdown, UiButton, UiEmpty, UiIconButton, UiInput, UiOptionButton, UiTextArea } from '@/components/ui'
import { VIDEO_EDIT_ANNOTATION_COLORS } from '@/core/theme/colorTokens'
import { VIDEO_EDIT_ANNOTATION_STATUS_LABELS, videoEditAnnotationColor, type VideoEditAnnotation } from '@/core/videoEdit/annotations'
import { videoEditFps } from '@/core/videoEdit/time'
import { resolveVideoEditElementAnnotation } from '../application/videoEditCodeElements'
import { createVideoEditAnnotation, deleteVideoEditAnnotation, jumpToVideoEditAnnotation, reviewVideoEditAnnotation, selectedVideoEditAnnotation, selectVideoEditAnnotation, sendVideoEditAnnotations, undoVideoEditAnnotationChange, updateVideoEditAnnotation } from '../application/videoEditAnnotations'
import { subscribeVideoEdit, videoEditCommittedDocument, type VideoEditInstance } from '../application/videoEditService'
import { timelineTimecode } from '../timeline/timelineGeometry'

interface Props { instance: VideoEditInstance; visible?: boolean; onError: (error: unknown) => void }
/** 状态点：待发送空心、待处理强调色、待审查警示色、已通过成功色（画面、面板、时间线同一套词与颜色）。 */
const STATUS_DOT: Record<VideoEditAnnotation['status'], string> = { draft: 'border border-text3', open: 'bg-accent', addressed: 'bg-warning-solid', resolved: 'bg-success-solid' }
const ink = (mark: VideoEditAnnotation): string => ['white', 'yellow'].includes(videoEditAnnotationColor(mark)) ? VIDEO_EDIT_ANNOTATION_COLORS.black : VIDEO_EDIT_ANNOTATION_COLORS.white
const reply = (text: string) => ({ id: crypto.randomUUID(), author: { kind: 'user' as const, name: '我' }, createdAt: new Date().toISOString(), text })
const clock = (value: string): string => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * 一条批注（重要记录 019）：编号徽标与画面上同色；正文 + 时间码与状态。选中不铺底色，展开出这一条要做的事
 * （草稿改文字、讨论、审查、补充说明）；删除只在悬停或展开时出现。
 */
function AnnotationRow({ instance, sequenceId, mark, number, fps, expanded, onError }: Props & { sequenceId: string; mark: VideoEditAnnotation; number: number; fps: number; expanded: boolean }): React.ReactElement {
  const element = mark.target.kind === 'element' ? resolveVideoEditElementAnnotation(instance, mark, sequenceId, mark.frame) : undefined
  const [text, setText] = useState(mark.text); const [note, setNote] = useState('')
  useEffect(() => { setText(mark.text) }, [mark.text])
  const projectId = instance.document.id
  const run = (action: () => void): void => { try { action() } catch (error) { onError(error) } }
  const commitText = (): void => { if (text.trim() && text !== mark.text) run(() => updateVideoEditAnnotation(projectId, mark.id, current => ({ ...current, text }))) }
  const append = (): void => { if (!note.trim()) return; run(() => { updateVideoEditAnnotation(projectId, mark.id, current => ({ ...current, thread: [...current.thread, reply(note)] })); setNote('') }) }
  const resolved = mark.status === 'resolved'
  const noteLabel = mark.status === 'addressed' ? `标注 ${number} 审查意见` : `标注 ${number} 补充说明`
  return <div className="group/annotation relative px-1" data-video-edit-annotation={mark.id} data-expanded={expanded || undefined}>
    <UiOptionButton variant="menu" aria-label={`跳到标注 ${number}`} aria-expanded={expanded} className="w-full items-start gap-2" onClick={() => run(() => { selectVideoEditAnnotation(projectId, mark.id); jumpToVideoEditAnnotation(projectId, mark.id) })}>
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
    {expanded && <div className="flex gap-2 px-3 pb-3" data-video-edit-annotation-details><span aria-hidden="true" className="w-5 shrink-0" /><div className="flex min-w-0 flex-1 flex-col gap-2">
      {mark.status === 'draft' && <UiTextArea aria-label={`标注 ${number} 说明`} rows={2} value={text} onChange={event => setText(event.target.value)} onBlur={commitText} />}
      {mark.thread.map(message => <div key={message.id} className="flex flex-col gap-0.5">
        <span className="text-2xs text-text3">{message.author.name} · {clock(message.createdAt)}</span>
        <p className="whitespace-pre-wrap break-words text-xs text-text2">{message.text}</p>
      </div>)}
      {mark.status === 'addressed' && <div className="flex flex-wrap items-center gap-1">
        <UiButton variant="secondary" size="sm" onClick={() => run(() => reviewVideoEditAnnotation(projectId, mark.id, true))}><Check />通过</UiButton>
        <UiButton size="sm" onClick={() => run(() => { reviewVideoEditAnnotation(projectId, mark.id, false, note); setNote('') })}>重开</UiButton>
        <UiButton size="sm" onClick={() => run(() => undoVideoEditAnnotationChange(projectId, mark.id))}><Undo2 />撤销这次修改</UiButton>
      </div>}
      {resolved && <div className="flex"><UiButton size="sm" onClick={() => run(() => reviewVideoEditAnnotation(projectId, mark.id, false))}>重开</UiButton></div>}
      {!resolved && mark.status !== 'draft' && <div className="flex items-center gap-1">
        <UiInput size="sm" className="min-w-0 flex-1" aria-label={noteLabel} placeholder={mark.status === 'addressed' ? '补充说明，重开时一起发给助手' : '补充说明'} value={note} onChange={event => setNote(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); append() } }} />
        <UiIconButton size="sm" aria-label="补充" tooltip="补充到讨论" disabled={!note.trim()} onClick={append}><Send /></UiIconButton>
      </div>}
    </div></div>}
  </div>
}

const FILTERS = [{ value: 'all', label: '全部' }, { value: 'draft', label: '待发送' }, { value: 'open', label: '待处理' }, { value: 'addressed', label: '待审查' }, { value: 'resolved', label: '已通过' }]

/**
 * 批注面板（重要记录 019）：有待发送时顶部才出现发送区；入出点设好时可以批注这一段；下面是“N 条 · 筛选”和批注列表。
 * 画在节目画面上的批注由命令带里的批注工具负责，这里只看、审、发。
 */
export const VideoEditAnnotationsPanel = memo(function VideoEditAnnotationsPanel({ instance, visible = true, onError }: Props): React.ReactElement {
  const snapshot = useRef<{ document: VideoEditInstance['document']; view: string }>()
  useSyncExternalStore(subscribeVideoEdit, () => {
    const document = videoEditCommittedDocument(instance)
    const view = JSON.stringify([instance.activeSequenceId, instance.inFrame, instance.outFrame, instance.targetTrackIds, instance.selectedClipIds, selectedVideoEditAnnotation(instance.document.id)])
    if (!snapshot.current || snapshot.current.document !== document || snapshot.current.view !== view) snapshot.current = { document, view }
    return snapshot.current
  })
  const [filter, setFilter] = useState('all'); const [note, setNote] = useState(''); const [sending, setSending] = useState(false); const [rangeNote, setRangeNote] = useState('')
  const projectId = instance.document.id
  const sequence = instance.document.sequences.find(sequence => sequence.id === instance.activeSequenceId)
  const drafts = sequence?.annotations.filter(mark => mark.status === 'draft') ?? []
  const all = instance.document.sequences.flatMap(sequence => sequence.annotations.map((mark, index) => ({ mark, sequenceId: sequence.id, number: index + 1, fps: videoEditFps(sequence.frameRate) })))
  const entries = all.filter(entry => filter === 'all' || entry.mark.status === filter)
  const selected = selectedVideoEditAnnotation(projectId)
  const send = async (external: boolean): Promise<void> => { if (!sequence) return; setSending(true); try { await sendVideoEditAnnotations(projectId, sequence.id, note, external); setNote('') } catch (error) { onError(error) } finally { setSending(false) } }
  const addRange = (): void => {
    if (!sequence || instance.inFrame === null || instance.outFrame === null || !rangeNote.trim()) return
    try { createVideoEditAnnotation(projectId, sequence.id, { frame: instance.inFrame, endFrame: instance.outFrame - 1, target: { kind: 'range', startFrame: instance.inFrame, endFrame: instance.outFrame - 1, ...(instance.targetTrackIds.length ? { trackIds: [...instance.targetTrackIds] } : {}), ...(instance.selectedClipIds.length ? { clipIds: [...instance.selectedClipIds] } : {}) }, text: rangeNote }); setRangeNote('') } catch (error) { onError(error) }
  }
  if (!visible) return <div />
  const fps = sequence ? videoEditFps(sequence.frameRate) : 30
  return <div className="flex h-full min-h-0 flex-col" aria-label="批注面板">
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
    {all.length > 0 && <div className="flex h-band-tab shrink-0 items-center pl-4 pr-1.5">
      <span className="flex-1 text-xs text-text3">{entries.length} 条</span>
      <Dropdown ariaLabel="筛选批注" appearance="text" size="sm" value={filter} onSelect={setFilter} options={FILTERS} />
    </div>}
    {entries.length ? <Virtuoso className="min-h-0 flex-1" data={entries} computeItemKey={(_index, entry) => entry.mark.id} itemContent={(_index, entry) => <AnnotationRow instance={instance} onError={onError} expanded={selected === entry.mark.id} {...entry} />} />
      : all.length ? <UiEmpty size="xs" title="暂无批注" description="换一个筛选看看。" />
        : <UiEmpty size="xs" title="还没有批注" description="在命令带选批注工具，直接在画面上画。" />}
  </div>
})
