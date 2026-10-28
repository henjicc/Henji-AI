import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { createLogger } from '@/core/logging'
import { assertVideoEditAnnotationTransition, VIDEO_EDIT_ANNOTATION_COLOR_NAMES, videoEditAnnotationSchema, type VideoEditAnnotation, type VideoEditAnnotationColor, type VideoEditAnnotationTarget, type VideoEditAnnotationWeight } from '@/core/videoEdit/annotations'
import { matchesVideoEditAnnotationFilter, VIDEO_EDIT_ANNOTATION_HANDLED_STATUSES, type VideoEditAnnotationStatus } from '@/core/videoEdit/annotationQuery'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import { videoEditDuration } from '@/core/videoEdit/document'
import { videoEditFps } from '@/core/videoEdit/time'
import { requestAlertConfirmation } from '@/stores/alertDialogStore'
import { openAssistant } from '@/features/assistant/store/assistantUiStore'
import { assetToAgentAttachment } from '@/features/assistant/conversation/assistantAttachments'
import { getPlatform } from '@/platform/runtime'
import { createHostContextSnapshot } from '@/features/application-control/hostContext/hostContext'
import { observeVideoEditFrame } from './videoEditFrameObservation'
import { clearHandledVideoEditAnnotations, findVideoEditAnnotations, removeVideoEditAnnotations, settleVideoEditAnnotationChange, updateVideoEditAnnotationStatuses, VIDEO_EDIT_ANNOTATION_USER } from './videoEditAnnotationBatch'
import { editVideoSequence, focusVideoEditPanel, requireVideoEditInstance, restoreVideoEditSnapshot, setVideoEditTimelineView, setVideoEditView, switchVideoEditSequence, type VideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.annotations')
const selected = new Map<string, { ids: readonly string[]; primary?: string }>()

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
/** 主选中项：画面高亮、面板展开与“让助手改这里”只看这一条。 */
export function selectedVideoEditAnnotation(id: string): string | undefined { return selected.get(id)?.primary }
/**
 * 选中哪些批注、列表按什么筛选都是会话状态：批注面板据它展开与高亮、画面上据它高亮编号、全选与批量命令据它取范围，
 * 改了要通知它们（播放头没动时没有别的刷新）。
 */
const selectionListeners = new Set<() => void>()
let selectionRevision = 0
export function subscribeVideoEditAnnotationSelection(listener: () => void): () => void { selectionListeners.add(listener); return () => { selectionListeners.delete(listener) } }
export function videoEditAnnotationSelectionRevision(): number { return selectionRevision }
function notifySelection(): void { selectionRevision++; for (const listener of selectionListeners) listener() }
/** 多选集合加一条主选中项；主选中项默认是最后加进来的那条。 */
export function setVideoEditAnnotationSelection(projectId: string, ids: readonly string[], primary: string | undefined = ids.at(-1)): void {
  const next = { ids: [...new Set(ids)], primary }
  const current = selected.get(projectId)
  if (current && current.primary === next.primary && current.ids.length === next.ids.length && current.ids.every((id, index) => id === next.ids[index])) return
  selected.set(projectId, next); notifySelection()
}
function setSelectedAnnotation(projectId: string, id: string): void { setVideoEditAnnotationSelection(projectId, [id], id) }
/** 在节目画面上点选一条标注（不跳转、不切面板）；“让助手改这里”会带上它。 */
export function selectVideoEditAnnotation(projectId: string, id: string): void { setSelectedAnnotation(projectId, id) }

/** 批注列表的筛选：默认只列还没确认的，已确认的收进“已确认”筛选，算是清掉了。 */
export const VIDEO_EDIT_ANNOTATION_LIST_FILTERS = [{ value: 'active', label: '未确认' }, { value: 'all', label: '全部' }, { value: 'draft', label: '待发送' }, { value: 'open', label: '待处理' }, { value: 'addressed', label: '已改完' }, { value: 'resolved', label: '已确认' }] as const
export type VideoEditAnnotationListFilter = typeof VIDEO_EDIT_ANNOTATION_LIST_FILTERS[number]['value']
/** 跟着打开的这份剪辑走：关掉再打开回到默认筛选。 */
const listFilters = new WeakMap<VideoEditInstance, VideoEditAnnotationListFilter>()
export function videoEditAnnotationListFilter(owner: VideoEditInstance): VideoEditAnnotationListFilter { return listFilters.get(owner) ?? 'active' }
export function setVideoEditAnnotationListFilter(projectId: string, filter: VideoEditAnnotationListFilter): void {
  const owner = requireVideoEditInstance(projectId)
  if (videoEditAnnotationListFilter(owner) === filter) return
  listFilters.set(owner, filter); notifySelection()
}
function listStatuses(filter: VideoEditAnnotationListFilter): VideoEditAnnotationStatus[] | undefined {
  return filter === 'all' ? undefined : filter === 'active' ? ['draft', 'open', 'addressed'] : [filter]
}
export interface VideoEditAnnotationListEntry { mark: VideoEditAnnotation; sequenceId: string; number: number; fps: number }
/** 面板列出的那些批注（各序列依次排列，编号是在本序列里的序号）；全选与批量命令都只作用于这份列表。 */
export function videoEditAnnotationList(owner: VideoEditInstance): VideoEditAnnotationListEntry[] {
  const filter = { statuses: listStatuses(videoEditAnnotationListFilter(owner)) }
  return owner.document.sequences.flatMap(sequence => sequence.annotations.map((mark, index) => ({ mark, sequenceId: sequence.id, number: index + 1, fps: videoEditFps(sequence.frameRate) })).filter(entry => matchesVideoEditAnnotationFilter(entry.mark, filter)))
}
/** 选中且仍在列表里的批注（删掉的、被筛选藏起来的不算），按列表顺序。批量操作只动这些，免得改到看不见的批注。 */
export function selectedVideoEditAnnotations(owner: VideoEditInstance): VideoEditAnnotationListEntry[] {
  const ids = new Set(selected.get(owner.document.id)?.ids)
  return videoEditAnnotationList(owner).filter(entry => ids.has(entry.mark.id))
}
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
/** 已改完必须带一条处理回复（schema 约束）：用户手动标的写明是手动标的，免得读成助手的处理说明。 */
const REVIEW_REPLIES = { pass: '确认改好了。', reject: '请重新处理。', addressed: '手动标为已改完。' } as const
/** 确认（通过）或驳回（回到待处理）一批批注，每条下面追加同一条回复；一次提交、一步撤销。 */
function reviewVideoEditAnnotations(projectId: string, ids: readonly string[], pass: boolean, opinion = ''): void {
  updateVideoEditAnnotationStatuses(projectId, ids.map(id => ({ id, status: pass ? 'resolved' : 'open', reply: pass ? REVIEW_REPLIES.pass : opinion.trim() || REVIEW_REPLIES.reject })), VIDEO_EDIT_ANNOTATION_USER)
  logger.info('审查剪辑标注', { event: 'video_edit.annotation.reviewed', context: { projectId, count: ids.length, passed: pass } })
}
export function reviewVideoEditAnnotation(projectId: string, id: string, pass: boolean, opinion = ''): void { reviewVideoEditAnnotations(projectId, [id], pass, opinion) }

/** 批注面板的批量命令：快捷键、菜单栏与面板按钮都走这里，只在批注作用域生效。 */
export const VIDEO_EDIT_ANNOTATION_BATCH_COMMANDS = ['select_all', 'delete', 'annotations_resolve', 'annotations_reject', 'annotations_mark_addressed', 'annotations_select_in_out', 'annotations_select_clips', 'annotations_clear_handled', 'annotations_clear_all'] as const satisfies readonly VideoEditCommandId[]
export type VideoEditAnnotationBatchCommand = typeof VIDEO_EDIT_ANNOTATION_BATCH_COMMANDS[number]
export function isVideoEditAnnotationBatchCommand(id: VideoEditCommandId): id is VideoEditAnnotationBatchCommand { return (VIDEO_EDIT_ANNOTATION_BATCH_COMMANDS as readonly string[]).includes(id) }
const BATCH_STATUS = { annotations_resolve: 'resolved', annotations_reject: 'open', annotations_mark_addressed: 'addressed' } as const
/**
 * 选中的里能改成这个状态的那些：转换是否允许只由 assertVideoEditAnnotationTransition 判定。
 * 待发送的不算：它要经“发送”交给助手才进入处理，批量改状态不替用户发送。
 */
function eligibleFor(entries: readonly VideoEditAnnotationListEntry[], status: Exclude<VideoEditAnnotationStatus, 'draft'>): string[] {
  return entries.filter(({ mark }) => {
    if (mark.status === 'draft' || mark.status === status) return false
    try { assertVideoEditAnnotationTransition(mark, { ...mark, status }, 'user'); return true } catch { return false }
  }).map(entry => entry.mark.id)
}
/** 按入出点或时间线上选中的片段，从当前列表里挑出活动序列上的批注。 */
function matchedByTimeline(owner: VideoEditInstance, by: 'in_out' | 'clips'): { ids: string[]; reason?: string } {
  const sequence = owner.document.sequences.find(sequence => sequence.id === owner.activeSequenceId)
  if (!sequence) return { ids: [], reason: '没有序列，请先新建序列。' }
  if (by === 'in_out' && owner.inFrame === null && owner.outFrame === null) return { ids: [], reason: '请先设置入点或出点。' }
  if (by === 'clips' && !owner.selectedClipIds.length) return { ids: [], reason: '请先在时间线上选中片段。' }
  const filter = by === 'in_out' ? { range: { fromFrame: owner.inFrame ?? 0, toFrame: Math.max(owner.inFrame ?? 0, (owner.outFrame ?? videoEditDuration(sequence)) - 1) } } : { clipIds: owner.selectedClipIds }
  const visible = new Set(videoEditAnnotationList(owner).map(entry => entry.mark.id))
  const ids = findVideoEditAnnotations(owner.document.id, { sequenceId: sequence.id, filter }).map(item => item.mark.id).filter(id => visible.has(id))
  return { ids, reason: ids.length ? undefined : by === 'in_out' ? '入出点之间没有批注。' : '选中的片段上没有批注。' }
}
function handledCount(owner: VideoEditInstance): number {
  return owner.document.sequences.reduce((sum, sequence) => sum + sequence.annotations.filter(mark => (VIDEO_EDIT_ANNOTATION_HANDLED_STATUSES as readonly string[]).includes(mark.status)).length, 0)
}
export function videoEditAnnotationCommandState(owner: VideoEditInstance, id: VideoEditAnnotationBatchCommand): { enabled: boolean; reason?: string } {
  const chosen = selectedVideoEditAnnotations(owner)
  const ready = (count: number, reason: string) => count ? { enabled: true } : { enabled: false, reason }
  switch (id) {
    case 'select_all': return ready(videoEditAnnotationList(owner).length, '当前筛选下没有批注。')
    case 'delete': return ready(chosen.length, '请先选中批注。')
    case 'annotations_resolve': case 'annotations_reject': case 'annotations_mark_addressed':
      return ready(eligibleFor(chosen, BATCH_STATUS[id]).length, !chosen.length ? '请先选中批注。' : id === 'annotations_resolve' ? '选中的批注里没有已改完的。' : id === 'annotations_reject' ? '选中的批注里没有已改完或已确认的。' : chosen.every(entry => entry.mark.status === 'draft') ? '选中的都是待发送批注，先发送后才能标为已改完。' : '选中的批注里没有待处理的。')
    case 'annotations_select_in_out': case 'annotations_select_clips': { const { ids, reason } = matchedByTimeline(owner, id === 'annotations_select_in_out' ? 'in_out' : 'clips'); return ready(ids.length, reason ?? '') }
    case 'annotations_clear_handled': return ready(handledCount(owner), '没有已改完或已确认的批注。')
    case 'annotations_clear_all': return ready(owner.document.sequences.some(sequence => sequence.annotations.length) ? 1 : 0, '没有批注。')
  }
}
/** 删除与清除先确认；确认弹窗的危险按钮写明删几条。 */
async function confirmRemoval(title: string, count: number): Promise<boolean> {
  return requestAlertConfirmation({ title, message: `将删除 ${count} 条批注，可以撤销。`, type: 'warning', confirmLabel: '删除', confirmTone: 'danger' })
}
export async function executeVideoEditAnnotationCommand(owner: VideoEditInstance, id: VideoEditAnnotationBatchCommand): Promise<void> {
  const projectId = owner.document.id; const chosen = selectedVideoEditAnnotations(owner)
  switch (id) {
    case 'select_all': { const ids = videoEditAnnotationList(owner).map(entry => entry.mark.id); const primary = selectedVideoEditAnnotation(projectId); setVideoEditAnnotationSelection(projectId, ids, primary && ids.includes(primary) ? primary : ids[0]); return }
    case 'delete': if (await confirmRemoval('删除选中的批注', chosen.length)) removeVideoEditAnnotations(projectId, { ids: chosen.map(entry => entry.mark.id) }, VIDEO_EDIT_ANNOTATION_USER); return
    case 'annotations_resolve': case 'annotations_reject': reviewVideoEditAnnotations(projectId, eligibleFor(chosen, BATCH_STATUS[id]), id === 'annotations_resolve'); return
    case 'annotations_mark_addressed': updateVideoEditAnnotationStatuses(projectId, eligibleFor(chosen, 'addressed').map(id => ({ id, status: 'addressed', reply: REVIEW_REPLIES.addressed })), VIDEO_EDIT_ANNOTATION_USER, { linkChange: false }); return
    case 'annotations_select_in_out': case 'annotations_select_clips': setVideoEditAnnotationSelection(projectId, matchedByTimeline(owner, id === 'annotations_select_in_out' ? 'in_out' : 'clips').ids); return
    case 'annotations_clear_handled': if (await confirmRemoval('清除已处理的批注', handledCount(owner))) clearHandledVideoEditAnnotations(projectId); return
    case 'annotations_clear_all': if (await confirmRemoval('清除全部批注', owner.document.sequences.reduce((sum, sequence) => sum + sequence.annotations.length, 0))) removeVideoEditAnnotations(projectId, { filter: {} }, VIDEO_EDIT_ANNOTATION_USER); return
  }
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
  if (!mark?.addressedBy?.transactionId) throw new Error('此标注没有可撤销的处理记录。')
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
  const chosen = point ? undefined : before.sequences.find(sequence => sequence.id === sequenceId)?.annotations.find(mark => mark.id === selectedVideoEditAnnotation(projectId) && mark.frame === at && mark.status !== 'resolved')
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
