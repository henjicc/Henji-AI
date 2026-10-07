import { useEffect, useState, useSyncExternalStore } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Check, Copy, MessageSquare, Send, Trash2, Undo2 } from 'lucide-react'
import { Dropdown, UiButton, UiEmpty, UiGroup, UiInput, UiTextArea } from '@/components/ui'
import { VIDEO_EDIT_ANNOTATION_STATUS_LABELS, type VideoEditAnnotation } from '@/core/videoEdit/annotations'
import { resolveVideoEditElementAnnotation } from '../application/videoEditCodeElements'
import { videoEditFps } from '@/core/videoEdit/time'
import { createVideoEditAnnotation, deleteVideoEditAnnotation, jumpToVideoEditAnnotation, reviewVideoEditAnnotation, selectedVideoEditAnnotation, sendVideoEditAnnotations, undoVideoEditAnnotationChange, updateVideoEditAnnotation } from '../application/videoEditAnnotations'
import { focusVideoEditPanel, subscribeVideoEditDomain, subscribeVideoEditView, videoEditDomainRevision, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { timelineTimecode } from '../timeline/timelineGeometry'
import { VideoEditAnnotationThumbnail } from './VideoEditAnnotationThumbnail'

interface Props { instance: VideoEditInstance; visible?: boolean; onError: (error: unknown) => void }
function AnnotationRow({ instance, sequenceId, mark, number, fps, onError }: Props & { sequenceId: string; mark: VideoEditAnnotation; number: number; fps: number }): React.ReactElement {
  const element = mark.target.kind === 'element' ? resolveVideoEditElementAnnotation(instance, mark, sequenceId, mark.frame) : undefined
  const [text, setText] = useState(mark.text); const [opinion, setOpinion] = useState(''); const [reply, setReply] = useState('')
  useEffect(() => { setText(mark.text) }, [mark.text])
  const run = (action: () => void): void => { try { action() } catch (error) { onError(error) } }
  const commitText = (): void => { if (text.trim() && text !== mark.text) run(() => updateVideoEditAnnotation(instance.document.id, mark.id, current => ({ ...current, text }))) }
  return <div className={`space-y-2 border-b border-line px-3 py-3 ${selectedVideoEditAnnotation(instance.document.id) === mark.id ? 'bg-selected-accent' : ''}`} data-video-edit-annotation={mark.id}>
    <div className="flex items-start gap-2">
      <UiButton aria-label={`跳到标注 ${number}`} onClick={() => run(() => jumpToVideoEditAnnotation(instance.document.id, mark.id))}><VideoEditAnnotationThumbnail document={instance.document} sequenceId={sequenceId} frame={mark.frame} /></UiButton>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-13"><span>标注 {number}</span><span className={mark.status === 'addressed' ? 'text-success-text' : mark.status === 'open' ? 'text-accent-text' : 'text-text2'}>{VIDEO_EDIT_ANNOTATION_STATUS_LABELS[mark.status]}</span></div>
        <div className="font-mono text-2xs text-text3">{timelineTimecode(mark.frame, fps)}{mark.endFrame !== undefined ? ` – ${timelineTimecode(mark.endFrame, fps)}` : ''}</div>
        <div className="text-2xs text-text3">{mark.author.name} · {new Date(mark.createdAt).toLocaleString()}</div>
      </div>
      <UiButton variant="danger" size="sm" aria-label={`删除标注 ${number}`} onClick={() => run(() => deleteVideoEditAnnotation(instance.document.id, mark.id))}><Trash2 size={14} /></UiButton>
    </div>
    {mark.status === 'draft' ? <UiTextArea aria-label={`标注 ${number} 说明`} rows={2} value={text} onChange={event => setText(event.target.value)} onBlur={commitText} /> : <p className="whitespace-pre-wrap break-words text-13 text-text1">{mark.text}</p>}
    {element && <p className="text-xs text-text2">{element.missing ? '元素已不存在' : `代码元素：${element.label}`}</p>}
    {mark.status === 'addressed' && <div className="space-y-2">
      <UiInput aria-label={`标注 ${number} 审查意见`} placeholder="重开时告诉助手哪里还需调整" value={opinion} onChange={event => setOpinion(event.target.value)} />
      <div className="flex flex-wrap gap-2"><UiButton variant="secondary" size="sm" onClick={() => run(() => reviewVideoEditAnnotation(instance.document.id, mark.id, true))}><Check size={14} />通过</UiButton><UiButton size="sm" onClick={() => run(() => reviewVideoEditAnnotation(instance.document.id, mark.id, false, opinion))}>重开</UiButton><UiButton size="sm" onClick={() => run(() => undoVideoEditAnnotationChange(instance.document.id, mark.id))}><Undo2 size={14} />撤销这次修改</UiButton></div>
    </div>}
    {mark.status === 'resolved' && <UiButton size="sm" onClick={() => run(() => reviewVideoEditAnnotation(instance.document.id, mark.id, false))}>重开</UiButton>}
    {mark.thread.length > 0 && <details><summary className="cursor-pointer text-xs text-text2">讨论 · {mark.thread.length} 条</summary><Virtuoso className="h-48" data={mark.thread} itemContent={(_index, message) => <div className="space-y-1 py-2"><div className="text-2xs text-text3">{message.author.name} · {new Date(message.createdAt).toLocaleString()}</div><p className="whitespace-pre-wrap break-words text-13 text-text1">{message.text}</p></div>} /></details>}
    {mark.status !== 'resolved' && <div className="flex gap-2"><UiInput aria-label={`标注 ${number} 补充说明`} placeholder="补充说明" value={reply} onChange={event => setReply(event.target.value)} /><UiButton size="sm" disabled={!reply.trim()} onClick={() => run(() => { updateVideoEditAnnotation(instance.document.id, mark.id, current => ({ ...current, thread: [...current.thread, { id: crypto.randomUUID(), author: { kind: 'user', name: '我' }, createdAt: new Date().toISOString(), text: reply }] })); setReply('') })}>补充</UiButton></div>}
  </div>
}
export function VideoEditAnnotationsPanel({ instance, visible = true, onError }: Props): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision); useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const [filter, setFilter] = useState('all'); const [note, setNote] = useState(''); const [sending, setSending] = useState(false); const [rangeNote, setRangeNote] = useState('')
  const sequence = instance.document.sequences.find(sequence => sequence.id === instance.activeSequenceId)
  const drafts = sequence?.annotations.filter(mark => mark.status === 'draft') ?? []
  const entries = instance.document.sequences.flatMap(sequence => sequence.annotations.map((mark, index) => ({ mark, sequenceId: sequence.id, number: index + 1, fps: videoEditFps(sequence.frameRate) }))).filter(entry => filter === 'all' || entry.mark.status === filter)
  const send = async (external: boolean): Promise<void> => { if (!sequence) return; setSending(true); try { await sendVideoEditAnnotations(instance.document.id, sequence.id, note, external) } catch (error) { onError(error) } finally { setSending(false) } }
  const addRange = (): void => {
    if (!sequence || instance.inFrame === null || instance.outFrame === null || !rangeNote.trim()) return
    try { createVideoEditAnnotation(instance.document.id, sequence.id, { frame: instance.inFrame, endFrame: instance.outFrame - 1, target: { kind: 'range', startFrame: instance.inFrame, endFrame: instance.outFrame - 1, ...(instance.targetTrackIds.length ? { trackIds: [...instance.targetTrackIds] } : {}), ...(instance.selectedClipIds.length ? { clipIds: [...instance.selectedClipIds] } : {}) }, text: rangeNote }); setRangeNote('') } catch (error) { onError(error) }
  }
  if (!visible) return <div />
  return <div className="flex h-full min-h-0 flex-col" aria-label="批注面板">
    <UiGroup className="shrink-0 px-3 py-3" titleTone="compact" title={`${drafts.length} 条待发送`}>
      <UiInput aria-label="标注整体说明" placeholder="整体说明（可选）" value={note} onChange={event => setNote(event.target.value)} />
      <div className="flex flex-wrap gap-2"><UiButton variant="primary" size="sm" disabled={sending || !drafts.length} onClick={() => { void send(false) }}><Send size={14} />发送给助手</UiButton><UiButton size="sm" disabled={sending || !drafts.length} onClick={() => { void send(true) }}><Copy size={14} />复制给外部 Agent</UiButton></div>
      {instance.inFrame !== null && instance.outFrame !== null && <div className="flex gap-2"><UiInput aria-label="时间段标注说明" placeholder="这段要改什么？" value={rangeNote} onChange={event => setRangeNote(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) addRange() }} /><UiButton size="sm" disabled={!rangeNote.trim()} onClick={addRange}>标注时间段</UiButton></div>}
      <Dropdown label="筛选批注" ariaLabel="筛选批注" value={filter} onSelect={setFilter} options={[{ value: 'all', label: '全部' }, { value: 'draft', label: '待发送' }, { value: 'open', label: '待处理' }, { value: 'addressed', label: '待审查' }, { value: 'resolved', label: '已通过' }]} />
    </UiGroup>
    {entries.length ? <Virtuoso className="min-h-0 flex-1" data={entries} computeItemKey={(_index, entry) => entry.mark.id} itemContent={(_index, entry) => <AnnotationRow instance={instance} onError={onError} {...entry} />} /> : <UiEmpty size="xs" title="暂无批注" description="在节目画面上标注，或圈出时间段。" />}
  </div>
}
export function VideoEditAnnotationQueueButton({ instance }: { instance: VideoEditInstance }): React.ReactElement {
  const count = instance.document.sequences.find(sequence => sequence.id === instance.activeSequenceId)?.annotations.filter(mark => mark.status === 'draft').length ?? 0
  return <UiButton size="sm" onClick={() => focusVideoEditPanel(instance.document.id, 'annotations')}><MessageSquare size={14} />{count ? `${count} 条待发送` : '批注'}</UiButton>
}
