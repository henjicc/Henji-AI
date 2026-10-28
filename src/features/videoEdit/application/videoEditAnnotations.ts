import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { createLogger } from '@/core/logging'
import { VIDEO_EDIT_ANNOTATION_COLOR_NAMES, videoEditAnnotationSchema, type VideoEditAnnotation, type VideoEditAnnotationColor, type VideoEditAnnotationTarget, type VideoEditAnnotationWeight } from '@/core/videoEdit/annotations'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import { openAssistant } from '@/features/assistant/store/assistantUiStore'
import { assetToAgentAttachment } from '@/features/assistant/conversation/assistantAttachments'
import { getPlatform } from '@/platform/runtime'
import { createHostContextSnapshot } from '@/features/application-control/hostContext/hostContext'
import { observeVideoEditFrame } from './videoEditFrameObservation'
import { settleVideoEditAnnotationChange, updateVideoEditAnnotationStatuses, VIDEO_EDIT_ANNOTATION_USER } from './videoEditAnnotationBatch'
import { editVideoSequence, focusVideoEditPanel, requireVideoEditInstance, restoreVideoEditSnapshot, setVideoEditTimelineView, setVideoEditView, switchVideoEditSequence } from './videoEditService'

const logger = createLogger('features.videoEdit.annotations')
const selected = new Map<string, string>()

/** 批注工具的子形状（工具栏弹出菜单与 1–7 的顺序）。 */
export const VIDEO_EDIT_ANNOTATION_SHAPES = ['arrow', 'ellipse', 'region', 'stroke', 'text', 'marker', 'point'] as const
export type VideoEditAnnotationShape = typeof VIDEO_EDIT_ANNOTATION_SHAPES[number]
export const VIDEO_EDIT_ANNOTATION_SHAPE_COMMANDS = { arrow: 'annotation_arrow', ellipse: 'annotation_ellipse', region: 'annotation_region', stroke: 'annotation_stroke', text: 'annotation_text', marker: 'annotation_marker', point: 'annotation_point' } as const satisfies Record<VideoEditAnnotationShape, VideoEditCommandId>
export interface VideoEditAnnotationBrush { shape: VideoEditAnnotationShape; color: VideoEditAnnotationColor; weight: VideoEditAnnotationWeight }
/** 当前画什么、用什么颜色：只是界面状态，不进文档；每个剪辑各记一份，默认红色箭头。 */
const brushes = new Map<string, VideoEditAnnotationBrush>()
const brushListeners = new Set<() => void>()
let brushRevision = 0
export function subscribeVideoEditAnnotationBrush(listener: () => void): () => void { brushListeners.add(listener); return () => { brushListeners.delete(listener) } }
export function videoEditAnnotationBrushRevision(): number { return brushRevision }
export function videoEditAnnotationBrush(projectId: string): VideoEditAnnotationBrush { return brushes.get(projectId) ?? { shape: 'arrow', color: VIDEO_EDIT_ANNOTATION_COLOR_NAMES[0], weight: 'regular' } }
export function setVideoEditAnnotationBrush(projectId: string, patch: Partial<VideoEditAnnotationBrush>): void {
  const current = videoEditAnnotationBrush(projectId); const next = { ...current, ...patch }
  if (next.shape === current.shape && next.color === current.color && next.weight === current.weight) return
  brushes.set(projectId, next); brushRevision++
  for (const listener of brushListeners) listener()
}
/** 选一个形状即进入批注工具（工具栏弹出菜单）；画画时先暂停播放。 */
export function chooseVideoEditAnnotationShape(projectId: string, shape: VideoEditAnnotationShape): void {
  setVideoEditAnnotationBrush(projectId, { shape })
  if (requireVideoEditInstance(projectId).tool !== 'annotate') setVideoEditTimelineView(projectId, { tool: 'annotate' })
}
export function selectedVideoEditAnnotation(id: string): string | undefined { return selected.get(id) }
/** 选中哪条批注是会话状态：批注面板据它展开那一条、画面上据它高亮编号，改了要通知它们（播放头没动时没有别的刷新）。 */
const selectionListeners = new Set<() => void>()
let selectionRevision = 0
export function subscribeVideoEditAnnotationSelection(listener: () => void): () => void { selectionListeners.add(listener); return () => { selectionListeners.delete(listener) } }
export function videoEditAnnotationSelectionRevision(): number { return selectionRevision }
function setSelectedAnnotation(projectId: string, id: string): void {
  if (selected.get(projectId) === id) return
  selected.set(projectId, id); selectionRevision++
  for (const listener of selectionListeners) listener()
}
/** 在节目画面上点选一条标注（不跳转、不切面板）；“让助手改这里”会带上它。 */
export function selectVideoEditAnnotation(projectId: string, id: string): void { setSelectedAnnotation(projectId, id) }
export function createVideoEditAnnotation(projectId: string, sequenceId: string, input: { frame: number; endFrame?: number; clipId?: string; target: VideoEditAnnotationTarget; text: string; status?: 'draft' | 'open'; style?: VideoEditAnnotation['style'] }): string {
  const id = crypto.randomUUID()
  const mark = videoEditAnnotationSchema.parse({ id, ...input, status: input.status ?? 'draft', space: 'composition-normalized', author: { kind: 'user', name: '我' }, createdAt: new Date().toISOString(), thread: [] })
  editVideoSequence(projectId, sequenceId, sequence => ({ ...sequence, annotations: [...sequence.annotations, mark] }))
  setSelectedAnnotation(projectId, id)
  logger.info('创建剪辑标注', { event: 'video_edit.annotation.created', context: { projectId, sequenceId, annotationId: id, target: mark.target.kind } })
  return id
}
export function updateVideoEditAnnotation(projectId: string, id: string, update: (mark: VideoEditAnnotation) => VideoEditAnnotation): void {
  const owner = requireVideoEditInstance(projectId)
  const sequence = owner.document.sequences.find(sequence => sequence.annotations.some(mark => mark.id === id))
  if (!sequence) throw new Error('标注已删除，请重新选择。')
  const association = { transactionId: crypto.randomUUID(), revision: owner.document.revision + 1 }
  editVideoSequence(projectId, sequence.id, sequence => ({ ...sequence, annotations: sequence.annotations.map(mark => mark.id === id ? settleVideoEditAnnotationChange(mark, update(mark), VIDEO_EDIT_ANNOTATION_USER, association) : mark) }))
}
export function deleteVideoEditAnnotation(projectId: string, id: string): void {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(sequence => sequence.annotations.some(mark => mark.id === id))
  if (!sequence) throw new Error('标注已删除。')
  editVideoSequence(projectId, sequence.id, sequence => ({ ...sequence, annotations: sequence.annotations.filter(mark => mark.id !== id) }))
}
export function reviewVideoEditAnnotation(projectId: string, id: string, pass: boolean, opinion = ''): void {
  updateVideoEditAnnotationStatuses(projectId, [{ id, status: pass ? 'resolved' : 'open', reply: pass ? '确认改好了。' : opinion.trim() || '请重新处理。' }], VIDEO_EDIT_ANNOTATION_USER)
  logger.info('审查剪辑标注', { event: 'video_edit.annotation.reviewed', context: { projectId, annotationId: id, passed: pass } })
}
export function jumpToVideoEditAnnotation(projectId: string, id: string): void {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(sequence => sequence.annotations.some(mark => mark.id === id)); const mark = sequence?.annotations.find(mark => mark.id === id)
  if (!sequence || !mark) throw new Error('标注已删除。')
  setSelectedAnnotation(projectId, id); switchVideoEditSequence(projectId, sequence.id); setVideoEditView(projectId, { playing: false, frame: mark.frame, ...(mark.clipId ? { selection: mark.clipId } : {}) }); focusVideoEditPanel(projectId, 'annotations')
}
/**
 * The normal transaction participant coalesces content edits and addressed into one history boundary.
 * 处理前的快照是最近一份还没被这次处理关联的快照；批注当时可能是待处理，也可能是直接改完的待发送草稿。
 */
export function undoVideoEditAnnotationChange(projectId: string, id: string): void {
  const owner = requireVideoEditInstance(projectId)
  const mark = owner.document.sequences.flatMap(sequence => sequence.annotations).find(mark => mark.id === id)
  if (!mark?.addressedBy) throw new Error('此标注没有可撤销的处理记录。')
  const association = mark.addressedBy
  let index = -1
  for (let candidate = owner.past.length - 1; candidate >= 0; candidate--) { const snapshot = owner.past[candidate]; if (snapshot.revision < association.revision && snapshot.sequences.some(sequence => sequence.annotations.some(prior => prior.id === id && prior.addressedBy?.transactionId !== association.transactionId))) { index = candidate; break } }
  const before = owner.past[index]; const after = owner.past[index + 1] ?? owner.document
  const content = (document: typeof owner.document): string => JSON.stringify({ ...document, revision: 0, sequences: document.sequences.map(sequence => ({ ...sequence, annotations: [] })) })
  if (!before || content(after) !== content(owner.document)) throw new Error('此次处理之后已有其他内容修改，请先用剪辑撤销回到该步骤。')
  const annotations = owner.document.sequences.flatMap(sequence => sequence.annotations).filter(item => item.addressedBy?.transactionId === association.transactionId)
  const priorStatus = new Map(before.sequences.flatMap(sequence => sequence.annotations.map(item => [item.id, item.status] as const)))
  restoreVideoEditSnapshot(projectId, owner.document, { ...before, sequences: before.sequences.map(sequence => ({ ...sequence, annotations: (owner.document.sequences.find(current => current.id === sequence.id)?.annotations ?? sequence.annotations).map(item => annotations.some(current => current.id === item.id) ? { ...item, status: priorStatus.get(item.id) === 'draft' ? 'draft' : 'open', addressedBy: undefined } : item) })) })
  logger.info('撤销剪辑标注处理', { event: 'video_edit.annotation.undo', context: { projectId, annotationId: id } })
}
export function videoEditAnnotationPrompt(projectId: string, marks: readonly VideoEditAnnotation[], note: string): string {
  return `请处理剪辑标注。整体说明：${note.trim() || '按各条标注处理。'}\n工程引用：video_edit.document:${projectId}\n${marks.map(mark => `- 标注 video_edit.annotation:${projectId}:${mark.id}，帧 ${mark.frame}${mark.endFrame === undefined ? '' : `–${mark.endFrame}`}：${mark.text}`).join('\n')}\n先用 read_application_entity 读取这些标注的 target、clip_id、thread；优先使用附带的当前帧截图，缺少或需要局部放大时才用 observe_video_edit_frame（target.kind=program，frame为标注帧，overlayAnnotations=true 或 annotationIds 指定标注，cropAnnotationId可局部放大）并用 read_application_media 查看。element 目标优先使用上下文中的 elementId/sourceSpan、局部源码、工厂和数据项定位；用 clip_id 核对代码实例固定版本，仅上下文不足时读取 video_edit.code_version.source。已声明内容直接改参数或对应数据项；需要改源码时创建新版本并验证后更换实例。覆盖在写回完成前保持有效，只删除已验证合并的覆盖。修改内容、thread append处理回复、status=addressed 必须放在同一个 change_application_entities 事务。回复说明改了什么、怎么改、可撤销步骤。不要写 resolved，只有用户可通过；不要删除标注或覆盖已有讨论。`
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
  const before = owner.document; const contentVersion = owner.contentVersion; const sequenceId = owner.activeSequenceId; const at = owner.frame; const selection = owner.selection; const selectedClips = owner.selectedClipIds
  const chosen = point ? undefined : before.sequences.find(sequence => sequence.id === sequenceId)?.annotations.find(mark => mark.id === selected.get(projectId) && mark.frame === at && mark.status !== 'resolved')
  const frame = await observeVideoEditFrame(projectId, { kind: 'program', sequenceId, frame: at }, 1920, undefined, undefined, { overlayAnnotations: true })
  const attachments = [{ attachment: assetToAgentAttachment(frame.asset), previewSrc: frame.asset.displayUrl }]
  if (chosen && ['region', 'ellipse', 'arrow', 'stroke'].includes(chosen.target.kind)) {
    const crop = await observeVideoEditFrame(projectId, { kind: 'program', sequenceId, frame: at }, 1920, undefined, undefined, { annotationIds: [chosen.id], cropAnnotationId: chosen.id }); attachments.push({ attachment: assetToAgentAttachment(crop.asset), previewSrc: crop.asset.displayUrl })
  }
  if (!isVideoEditContentCurrent(owner, contentVersion) || owner.activeSequenceId !== sequenceId || owner.frame !== at || owner.playing || owner.selection !== selection || owner.selectedClipIds !== selectedClips) throw new Error('原画面已改变，请暂停后重新发送。')
  const id = createVideoEditAnnotation(projectId, sequenceId, { frame: at, ...(chosen?.endFrame !== undefined ? { endFrame: chosen.endFrame } : {}), ...(chosen?.clipId || owner.selection ? { clipId: chosen?.clipId ?? owner.selection! } : {}), target: point ? { kind: 'point', ...point } : chosen?.target ?? { kind: 'point', x: 0.5, y: 0.5 }, text: '请修改这里（等待用户说明）。', status: 'open' })
  const mark = owner.document.sequences.find(sequence => sequence.id === sequenceId)!.annotations.find(mark => mark.id === id)!
  openAssistant('请修改这里：', { attachments, context: JSON.stringify({ ...createHostContextSnapshot(), annotationInstructions: videoEditAnnotationPrompt(projectId, [mark], '按本条消息中用户填写的说明处理。') }), onTextSubmitted: text => updateVideoEditAnnotation(projectId, id, current => ({ ...current, text })) })
}
