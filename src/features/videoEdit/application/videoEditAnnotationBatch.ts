import { createLogger } from '@/core/logging'
import type { ApplicationRef } from '@/core/application-control'
import { assertVideoEditAnnotationTransition, videoEditAnnotationSchema, type VideoEditAnnotation } from '@/core/videoEdit/annotations'
import { filterVideoEditAnnotations, VIDEO_EDIT_ANNOTATION_HANDLED_STATUSES, type VideoEditAnnotationFilter, type VideoEditAnnotationStatus } from '@/core/videoEdit/annotationQuery'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { queryVideoEditAnnotationsCapability, removeVideoEditAnnotationsCapability, updateVideoEditAnnotationsCapability } from '@/core/application-control/domains/videoEdit/videoEditAnnotationCapabilities'
import { editVideoProject, requireVideoEditInstance, videoEditDomainRevision } from './videoEditService'
import { splitVideoEditRef } from './videoEditReflection'

const logger = createLogger('features.videoEdit.annotationBatch')

/** 谁在改：界面是用户本人，能力调用方一律按助手对待（只能追加自己的回复、不能代用户确认未改完的批注）。 */
export interface VideoEditAnnotationActor { source: 'user' | 'agent'; author: VideoEditAnnotation['author'] }
export const VIDEO_EDIT_ANNOTATION_USER: VideoEditAnnotationActor = { source: 'user', author: { kind: 'user', name: '我' } }
export const VIDEO_EDIT_ANNOTATION_ASSISTANT: VideoEditAnnotationActor = { source: 'agent', author: { kind: 'assistant', name: '助手' } }

/** 选中一批批注：显式给 id，或按条件（可限定序列）筛选。 */
export type VideoEditAnnotationSelection = { ids: readonly string[] } | { sequenceId?: string; filter: VideoEditAnnotationFilter }
export interface VideoEditAnnotationStatusChange { id: string; status?: Exclude<VideoEditAnnotationStatus, 'draft'>; reply?: string }

interface Located { sequenceId: string; mark: VideoEditAnnotation }

/**
 * 单条批注修改的唯一规则：通用属性写入与批量服务都经这里。
 * 写成已改完时由宿主补上处理关联（撤销边界），重开时清掉；状态转换与回复只能追加由 assertVideoEditAnnotationTransition 判定。
 */
export function settleVideoEditAnnotationChange(prior: VideoEditAnnotation, candidate: unknown, actor: Pick<VideoEditAnnotationActor, 'source'>, association: { transactionId: string; revision: number }): VideoEditAnnotation {
  const draft = { ...(candidate as Record<string, unknown>) }
  if (draft.status === 'addressed' && prior.status !== 'addressed') draft.addressedBy = association
  if (draft.status === 'open') delete draft.addressedBy
  const next = videoEditAnnotationSchema.parse(draft)
  assertVideoEditAnnotationTransition(prior, next, actor.source)
  if (actor.source === 'agent' && next.thread.slice(prior.thread.length).some(message => message.author.kind === 'user')) throw new Error('Agent回复不能冒充用户。')
  return next
}

function locate(document: VideoEditDocument, selection: VideoEditAnnotationSelection): Located[] {
  if ('ids' in selection) {
    const all = new Map(document.sequences.flatMap(sequence => sequence.annotations.map(mark => [mark.id, { sequenceId: sequence.id, mark }] as const)))
    const missing = selection.ids.filter(id => !all.has(id))
    if (missing.length) throw new Error(`这些批注已删除或不属于此剪辑：${missing.join('、')}。请重新查询。`)
    return [...new Set(selection.ids)].map(id => all.get(id)!)
  }
  if (selection.sequenceId && !document.sequences.some(sequence => sequence.id === selection.sequenceId)) throw new Error('序列不属于此剪辑或已删除。')
  return document.sequences.filter(sequence => !selection.sequenceId || sequence.id === selection.sequenceId)
    .flatMap(sequence => filterVideoEditAnnotations(sequence.annotations, selection.filter).map(mark => ({ sequenceId: sequence.id, mark })))
}

/** 只读：按选择返回批注及所属序列，顺序为序列内原顺序。 */
export function findVideoEditAnnotations(projectId: string, selection: VideoEditAnnotationSelection): Located[] {
  return locate(requireVideoEditInstance(projectId).document, selection)
}

/** N 条修改合成一次文档写入：只有一次校验、一次发布、撤销栈只多一步。 */
function commit(projectId: string, replace: ReadonlyMap<string, VideoEditAnnotation | null>): void {
  editVideoProject(projectId, document => ({ ...document, sequences: document.sequences.map(sequence => sequence.annotations.some(mark => replace.has(mark.id)) ? { ...sequence, annotations: sequence.annotations.flatMap(mark => { const next = replace.has(mark.id) ? replace.get(mark.id) : mark; return next ? [next] : [] }) } : sequence) }))
}

function message(actor: VideoEditAnnotationActor, text: string): VideoEditAnnotation['thread'][number] {
  return { id: crypto.randomUUID(), author: actor.author, createdAt: new Date().toISOString(), text }
}

/** 某一条批注不合规则让整批被拒：带上那一条的 id，能力适配层据此给出完整引用，界面只显示正文摘要。 */
export class VideoEditAnnotationRejection extends Error {
  constructor(message: string, readonly annotationId: string) { super(message); this.name = 'VideoEditAnnotationRejection' }
}

/** 逐条改状态并可附回复；任一条不合规则整批不写。返回实际改动的批注 id。 */
export function updateVideoEditAnnotationStatuses(projectId: string, changes: readonly VideoEditAnnotationStatusChange[], actor: VideoEditAnnotationActor): string[] {
  logger.info('批量处理批注开始', { event: 'video_edit.annotation.batch_update.start', context: { projectId, count: changes.length, source: actor.source } })
  try {
    const owner = requireVideoEditInstance(projectId); const before = owner.document
    const located = new Map(locate(before, { ids: changes.map(change => change.id) }).map(item => [item.mark.id, item.mark]))
    const association = { transactionId: crypto.randomUUID(), revision: before.revision + 1 }
    const next = new Map<string, VideoEditAnnotation>()
    for (const change of changes) {
      const prior = next.get(change.id) ?? located.get(change.id)!
      const candidate = { ...prior, ...(change.status ? { status: change.status } : {}), thread: change.reply ? [...prior.thread, message(actor, change.reply)] : prior.thread }
      if (JSON.stringify(candidate) === JSON.stringify(prior)) continue
      try { next.set(change.id, settleVideoEditAnnotationChange(located.get(change.id)!, candidate, actor, association)) }
      catch (error) { throw new VideoEditAnnotationRejection(`批注“${prior.text.slice(0, 20)}”：${error instanceof Error ? error.message : String(error)}`, change.id) }
    }
    if (next.size) commit(projectId, next)
    logger.info('批量处理批注完成', { event: 'video_edit.annotation.batch_update.completed', context: { projectId, changed: next.size } })
    return [...next.keys()]
  } catch (error) { logger.error('批量处理批注失败', error, { event: 'video_edit.annotation.batch_update.failed', context: { projectId } }); throw error }
}

/** 按选择把一批批注改成同一状态，回复追加到每一条；已经是这个状态的不动，免得重复追加回复。 */
export function setVideoEditAnnotationsStatus(projectId: string, selection: VideoEditAnnotationSelection, status: Exclude<VideoEditAnnotationStatus, 'draft'>, actor: VideoEditAnnotationActor, reply?: string): string[] {
  const found = findVideoEditAnnotations(projectId, selection)
  if (!found.length) throw new Error('没有符合条件的批注。')
  return updateVideoEditAnnotationStatuses(projectId, found.filter(item => item.mark.status !== status).map(item => ({ id: item.mark.id, status, reply })), actor)
}

/**
 * 删除一批批注；给了 mergeInto 时按“合并重复”处理：保留那一条，下面追加一条说明列出并掉的正文。
 * 返回删除的 id。
 */
export function removeVideoEditAnnotations(projectId: string, selection: VideoEditAnnotationSelection, actor: VideoEditAnnotationActor, merge?: { into: string; note?: string }): string[] {
  logger.info('批量删除批注开始', { event: 'video_edit.annotation.batch_remove.start', context: { projectId, merge: Boolean(merge), source: actor.source } })
  try {
    const owner = requireVideoEditInstance(projectId); const before = owner.document
    const removed = locate(before, selection).map(item => item.mark)
    if (!removed.length) throw new Error('没有符合条件的批注。')
    const replace = new Map<string, VideoEditAnnotation | null>(removed.map(mark => [mark.id, null]))
    if (merge) {
      if (replace.has(merge.into)) throw new Error('保留的那一条不能同时被删除。')
      const [keep] = locate(before, { ids: [merge.into] })
      const listing = removed.map(mark => `「${mark.text.length > 60 ? `${mark.text.slice(0, 60)}…` : mark.text}」`).join('；')
      const text = `${merge.note?.trim() || '已合并重复批注'}（并掉 ${removed.length} 条：${listing}）`
      const next = settleVideoEditAnnotationChange(keep.mark, { ...keep.mark, thread: [...keep.mark.thread, message(actor, text)] }, actor, { transactionId: crypto.randomUUID(), revision: before.revision + 1 })
      replace.set(keep.mark.id, next)
    }
    commit(projectId, replace)
    logger.info('批量删除批注完成', { event: 'video_edit.annotation.batch_remove.completed', context: { projectId, removed: removed.length } })
    return removed.map(mark => mark.id)
  } catch (error) { logger.error('批量删除批注失败', error, { event: 'video_edit.annotation.batch_remove.failed', context: { projectId } }); throw error }
}

/** 清除已处理：删掉已改完、已确认的批注，待发送与待处理的不动。 */
export function clearHandledVideoEditAnnotations(projectId: string, sequenceId?: string, actor: VideoEditAnnotationActor = VIDEO_EDIT_ANNOTATION_USER): string[] {
  return removeVideoEditAnnotations(projectId, { sequenceId, filter: { statuses: VIDEO_EDIT_ANNOTATION_HANDLED_STATUSES } }, actor)
}

// ---- 助手能力适配：引用换成 id 后调用上面的同一组操作 ----

const SUMMARY_LENGTH = 200
function childId(documentId: string, ref: ApplicationRef, kind: string): string {
  const value = splitVideoEditRef(ref)
  if (ref.kind !== kind || value.projectId !== documentId || !value.childId) throw new Error(`${kind} 引用必须属于目标剪辑：${ref.id}。请使用查询返回的完整引用。`)
  return value.childId
}
function filterFromInput(documentId: string, where: ReturnType<typeof queryVideoEditAnnotationsCapability.inputSchema.parse>['where'] | ReturnType<typeof updateVideoEditAnnotationsCapability.inputSchema.parse>['where']): VideoEditAnnotationSelection {
  return { sequenceId: where.sequenceRef ? childId(documentId, where.sequenceRef, 'video_edit.sequence') : undefined,
    filter: { statuses: where.statuses, authorKinds: where.authorKinds, range: where.range, clipIds: where.clipRefs?.map(item => childId(documentId, item, 'video_edit.clip')) } }
}
const annotationRef = (documentId: string, id: string) => ({ kind: 'video_edit.annotation' as const, id: `${documentId}:${id}` })
/** 分页游标绑定查询时的文档修订：批注增删改后旧游标指向的位置已不可信，必须重查而不是悄悄错位。 */
function pageOffset(cursor: string | undefined, revision: number): number {
  if (cursor === undefined) return 0
  const match = /^(\d+):(\d+)$/.exec(cursor)
  if (!match) throw new Error('cursor 无效，请使用上一页返回的 nextCursor，或不带 cursor 从第一页查询。')
  if (Number(match[1]) !== revision) throw new Error('剪辑内容已变化，请不带 cursor 重新调用 query_video_edit_annotations。')
  return Number(match[2])
}

export function handleVideoEditAnnotationCapability(id: string, raw: unknown): Record<string, unknown> | undefined {
  if (id === queryVideoEditAnnotationsCapability.id) {
    const input = queryVideoEditAnnotationsCapability.inputSchema.parse(raw); const documentId = input.documentRef.id
    const revision = requireVideoEditInstance(documentId).document.revision
    const all = findVideoEditAnnotations(documentId, filterFromInput(documentId, input.where))
    const offset = pageOffset(input.cursor, revision); const page = all.slice(offset, offset + input.limit)
    const items = page.map(({ sequenceId, mark }) => ({ ref: annotationRef(documentId, mark.id), sequenceRef: { kind: 'video_edit.sequence' as const, id: `${documentId}:${sequenceId}` }, status: mark.status, author: mark.author, frame: mark.frame, endFrame: mark.endFrame ?? null,
      clipRef: mark.clipId ? { kind: 'video_edit.clip' as const, id: `${documentId}:${mark.clipId}` } : null, targetKind: mark.target.kind, text: mark.text.slice(0, SUMMARY_LENGTH), textTruncated: mark.text.length > SUMMARY_LENGTH,
      replyCount: mark.thread.length, lastReply: mark.thread.at(-1)?.text.slice(0, SUMMARY_LENGTH) ?? null }))
    const nextCursor = offset + input.limit < all.length ? `${revision}:${offset + input.limit}` : null
    return { documentRef: input.documentRef, refs: items.map(item => item.ref), revisions: { video_edit: videoEditDomainRevision() }, items, total: all.length, nextCursor, message: `找到 ${all.length} 条批注${nextCursor ? `，本页 ${items.length} 条` : ''}。` }
  }
  if (id === updateVideoEditAnnotationsCapability.id) {
    const input = updateVideoEditAnnotationsCapability.inputSchema.parse(raw); const documentId = input.documentRef.id
    let changed: string[]
    try { changed = setVideoEditAnnotationsStatus(documentId, filterFromInput(documentId, input.where), input.status, VIDEO_EDIT_ANNOTATION_ASSISTANT, input.reply) }
    catch (error) { throw error instanceof VideoEditAnnotationRejection ? new Error(`${error.message}整批未改动。被拒的批注：${JSON.stringify(annotationRef(documentId, error.annotationId))}`) : error }
    const current = new Set(requireVideoEditInstance(documentId).document.sequences.flatMap(sequence => sequence.annotations.map(mark => mark.id)))
    return { documentRef: input.documentRef, resultRefs: changed.map(value => annotationRef(documentId, value)), message: changed.length ? `已在一次提交里处理 ${changed.length} 条批注，可一步撤销。` : '批注已是目标状态，没有改动。', verification: { verified: changed.every(value => current.has(value)), condition: '处理后的批注已从剪辑文档回读。' } }
  }
  if (id === removeVideoEditAnnotationsCapability.id) {
    const input = removeVideoEditAnnotationsCapability.inputSchema.parse(raw); const documentId = input.documentRef.id
    const into = input.mergeInto ? childId(documentId, input.mergeInto, 'video_edit.annotation') : undefined
    const removed = removeVideoEditAnnotations(documentId, { ids: input.annotationRefs.map(item => childId(documentId, item, 'video_edit.annotation')) }, VIDEO_EDIT_ANNOTATION_ASSISTANT, into ? { into, note: input.mergeNote } : undefined)
    const remaining = new Set(requireVideoEditInstance(documentId).document.sequences.flatMap(sequence => sequence.annotations.map(mark => mark.id)))
    return { documentRef: input.documentRef, removedRefs: removed.map(value => annotationRef(documentId, value)), resultRefs: into ? [annotationRef(documentId, into)] : [], message: `已在一次提交里删除 ${removed.length} 条批注${into ? '并合并到保留的那一条' : ''}，可一步撤销。`, verification: { verified: removed.every(value => !remaining.has(value)) && (!into || remaining.has(into)), condition: '删除的批注已不在剪辑文档中，保留的批注仍在。' } }
  }
  return undefined
}
