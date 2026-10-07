import { createLogger } from '@/core/logging'
import { assertVideoEditAnnotationTransition, videoEditAnnotationSchema, type VideoEditAnnotation, type VideoEditAnnotationTarget } from '@/core/videoEdit/annotations'
import { openAssistant } from '@/features/assistant/store/assistantUiStore'
import { assetToAgentAttachment } from '@/features/assistant/conversation/assistantAttachments'
import { getPlatform } from '@/platform/runtime'
import { createHostContextSnapshot } from '@/features/application-control/hostContext/hostContext'
import { observeVideoEditFrame } from './videoEditFrameObservation'
import { editVideoSequence, focusVideoEditPanel, requireVideoEditInstance, restoreVideoEditSnapshot, setVideoEditView, switchVideoEditSequence } from './videoEditService'

const logger = createLogger('features.videoEdit.annotations')
type MonitorAction = 'select' | 'point' | 'region' | 'stroke' | 'ask'
const monitors = new Map<string, (action: MonitorAction) => void>()
const selected = new Map<string, string>()
export function registerVideoEditAnnotationMonitor(id: string, handler: (action: MonitorAction) => void): () => void {
  monitors.set(id, handler)
  return () => { if (monitors.get(id) === handler) monitors.delete(id) }
}
export function requestVideoEditAnnotationMonitor(id: string, action: MonitorAction): void {
  const handler = monitors.get(id)
  if (!handler) throw new Error('请打开节目画面，再使用标注工具。')
  handler(action)
}
export function selectedVideoEditAnnotation(id: string): string | undefined { return selected.get(id) }
export function createVideoEditAnnotation(projectId: string, sequenceId: string, input: { frame: number; endFrame?: number; clipId?: string; target: VideoEditAnnotationTarget; text: string; status?: 'draft' | 'open' }): string {
  const id = crypto.randomUUID()
  const mark = videoEditAnnotationSchema.parse({ id, ...input, status: input.status ?? 'draft', space: 'composition-normalized', author: { kind: 'user', name: '我' }, createdAt: new Date().toISOString(), thread: [] })
  editVideoSequence(projectId, sequenceId, sequence => ({ ...sequence, annotations: [...sequence.annotations, mark] }))
  selected.set(projectId, id)
  logger.info('创建剪辑标注', { event: 'video_edit.annotation.created', context: { projectId, sequenceId, annotationId: id, target: mark.target.kind } })
  return id
}
export function updateVideoEditAnnotation(projectId: string, id: string, update: (mark: VideoEditAnnotation) => VideoEditAnnotation): void {
  const owner = requireVideoEditInstance(projectId)
  const sequence = owner.document.sequences.find(sequence => sequence.annotations.some(mark => mark.id === id))
  if (!sequence) throw new Error('标注已删除，请重新选择。')
  editVideoSequence(projectId, sequence.id, sequence => ({ ...sequence, annotations: sequence.annotations.map(mark => {
    if (mark.id !== id) return mark
    const next = videoEditAnnotationSchema.parse(update(mark)); assertVideoEditAnnotationTransition(mark, next, 'user'); return next
  }) }))
}
export function deleteVideoEditAnnotation(projectId: string, id: string): void {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(sequence => sequence.annotations.some(mark => mark.id === id))
  if (!sequence) throw new Error('标注已删除。')
  editVideoSequence(projectId, sequence.id, sequence => ({ ...sequence, annotations: sequence.annotations.filter(mark => mark.id !== id) }))
}
export function reviewVideoEditAnnotation(projectId: string, id: string, pass: boolean, opinion = ''): void {
  updateVideoEditAnnotation(projectId, id, mark => ({ ...mark, status: pass ? 'resolved' : 'open', ...(pass ? {} : { addressedBy: undefined }), thread: [...mark.thread, { id: crypto.randomUUID(), author: { kind: 'user', name: '我' }, createdAt: new Date().toISOString(), text: pass ? '审查通过。' : opinion.trim() || '请重新处理。' }] }))
  logger.info('审查剪辑标注', { event: 'video_edit.annotation.reviewed', context: { projectId, annotationId: id, passed: pass } })
}
export function jumpToVideoEditAnnotation(projectId: string, id: string): void {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(sequence => sequence.annotations.some(mark => mark.id === id)); const mark = sequence?.annotations.find(mark => mark.id === id)
  if (!sequence || !mark) throw new Error('标注已删除。')
  selected.set(projectId, id); switchVideoEditSequence(projectId, sequence.id); setVideoEditView(projectId, { playing: false, frame: mark.frame, ...(mark.clipId ? { selection: mark.clipId } : {}) }); focusVideoEditPanel(projectId, 'annotations')
}
/** The normal transaction participant coalesces content edits and addressed into one history boundary. */
export function undoVideoEditAnnotationChange(projectId: string, id: string): void {
  const owner = requireVideoEditInstance(projectId)
  const mark = owner.document.sequences.flatMap(sequence => sequence.annotations).find(mark => mark.id === id)
  if (!mark?.addressedBy) throw new Error('此标注没有可撤销的处理记录。')
  const association = mark.addressedBy
  let index = -1
  for (let candidate = owner.past.length - 1; candidate >= 0; candidate--) { const snapshot = owner.past[candidate]; if (snapshot.revision < association.revision && snapshot.sequences.some(sequence => sequence.annotations.some(prior => prior.id === id && prior.status === 'open'))) { index = candidate; break } }
  const before = owner.past[index]; const after = owner.past[index + 1] ?? owner.document
  const content = (document: typeof owner.document): string => JSON.stringify({ ...document, revision: 0, sequences: document.sequences.map(sequence => ({ ...sequence, annotations: [] })) })
  if (!before || content(after) !== content(owner.document)) throw new Error('此次处理之后已有其他内容修改，请先用剪辑撤销回到该步骤。')
  const annotations = owner.document.sequences.flatMap(sequence => sequence.annotations).filter(item => item.addressedBy?.transactionId === association.transactionId)
  restoreVideoEditSnapshot(projectId, owner.document, { ...before, sequences: before.sequences.map(sequence => ({ ...sequence, annotations: (owner.document.sequences.find(current => current.id === sequence.id)?.annotations ?? sequence.annotations).map(item => annotations.some(current => current.id === item.id) ? { ...item, status: 'open', addressedBy: undefined } : item) })) })
  logger.info('撤销剪辑标注处理', { event: 'video_edit.annotation.undo', context: { projectId, annotationId: id } })
}
export function videoEditAnnotationPrompt(projectId: string, marks: readonly VideoEditAnnotation[], note: string): string {
  return `请处理剪辑标注。整体说明：${note.trim() || '按各条标注处理。'}\n工程引用：video_edit.document:${projectId}\n${marks.map(mark => `- 标注 video_edit.annotation:${projectId}:${mark.id}，帧 ${mark.frame}${mark.endFrame === undefined ? '' : `–${mark.endFrame}`}：${mark.text}`).join('\n')}\n先用 read_application_entity 读取这些标注的 target、clip_id、thread；用 observe_video_edit_frame（target.kind=program，frame为标注帧，overlayAnnotations=true 或 annotationIds 指定标注，cropAnnotationId可局部放大）并用 read_application_media 查看。element 目标用 clip_id 读代码实例固定版本，再读取 video_edit.code_version.source，按 elementId/sourceSpan 定位，创建新的源码版本后更换实例。修改内容、thread append处理回复、status=addressed 必须放在同一个 change_application_entities 事务。回复说明改了什么、怎么改、可撤销步骤。不要写 resolved，只有用户可通过；不要删除标注或覆盖已有讨论。`
}
export async function sendVideoEditAnnotations(projectId: string, sequenceId: string, note: string, external = false): Promise<void> {
  const owner = requireVideoEditInstance(projectId); const marks = owner.document.sequences.find(sequence => sequence.id === sequenceId)?.annotations.filter(mark => mark.status === 'draft') ?? []
  if (!marks.length) throw new Error('没有待发送标注。')
  const prompt = videoEditAnnotationPrompt(projectId, marks, note)
  const publish = (): void => {
    if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭。')
    editVideoSequence(projectId, sequenceId, sequence => {
      if (marks.some(mark => JSON.stringify(sequence.annotations.find(current => current.id === mark.id)) !== JSON.stringify(mark))) throw new Error('待发送标注已改变，请重新发送。')
      return { ...sequence, annotations: sequence.annotations.map(mark => marks.some(pending => pending.id === mark.id) ? { ...mark, status: 'open' } : mark) }
    })
  }
  if (external) { await getPlatform().clipboard.writeText(prompt); publish() }
  else openAssistant(prompt, { autoSend: true, beforeSend: publish, onRejected: () => {
    if (requireVideoEditInstance(projectId) !== owner) return
    editVideoSequence(projectId, sequenceId, sequence => ({ ...sequence, annotations: sequence.annotations.map(mark => marks.some(pending => pending.id === mark.id && pending.text === mark.text) && mark.status === 'open' && !mark.thread.length ? { ...mark, status: 'draft' } : mark) }))
  } })
}
export async function askAssistantAtVideoEditFrame(projectId: string, point?: { x: number; y: number }): Promise<void> {
  const owner = requireVideoEditInstance(projectId)
  if (owner.playing) throw new Error('请先暂停画面，再告诉助手要改哪里。')
  const before = owner.document; const sequenceId = owner.activeSequenceId; const at = owner.frame; const selection = owner.selection; const selectedClips = owner.selectedClipIds
  const chosen = point ? undefined : before.sequences.find(sequence => sequence.id === sequenceId)?.annotations.find(mark => mark.id === selected.get(projectId) && mark.frame === at && mark.status !== 'resolved')
  const frame = await observeVideoEditFrame(projectId, { kind: 'program', sequenceId, frame: at }, 1920, undefined, undefined, { overlayAnnotations: true })
  const attachments = [{ attachment: assetToAgentAttachment(frame.asset), previewSrc: frame.asset.displayUrl }]
  if (chosen && ['region', 'stroke'].includes(chosen.target.kind)) {
    const crop = await observeVideoEditFrame(projectId, { kind: 'program', sequenceId, frame: at }, 1920, undefined, undefined, { annotationIds: [chosen.id], cropAnnotationId: chosen.id }); attachments.push({ attachment: assetToAgentAttachment(crop.asset), previewSrc: crop.asset.displayUrl })
  }
  if (requireVideoEditInstance(projectId) !== owner || owner.document !== before || owner.activeSequenceId !== sequenceId || owner.frame !== at || owner.playing || owner.selection !== selection || owner.selectedClipIds !== selectedClips) throw new Error('原画面已改变，请暂停后重新发送。')
  const id = createVideoEditAnnotation(projectId, sequenceId, { frame: at, ...(chosen?.endFrame !== undefined ? { endFrame: chosen.endFrame } : {}), ...(chosen?.clipId || owner.selection ? { clipId: chosen?.clipId ?? owner.selection! } : {}), target: point ? { kind: 'point', ...point } : chosen?.target ?? { kind: 'point', x: 0.5, y: 0.5 }, text: '请修改这里（等待用户说明）。', status: 'open' })
  const mark = owner.document.sequences.find(sequence => sequence.id === sequenceId)!.annotations.find(mark => mark.id === id)!
  openAssistant('请修改这里：', { attachments, context: JSON.stringify({ ...createHostContextSnapshot(), annotationInstructions: videoEditAnnotationPrompt(projectId, [mark], '按本条消息中用户填写的说明处理。') }), onTextSubmitted: text => updateVideoEditAnnotation(projectId, id, current => ({ ...current, text })) })
}
