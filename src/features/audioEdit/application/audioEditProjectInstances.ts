import { assertAudioEditLocks } from '@/core/audioEdit/edits'
import { isAgentWritingDocument, markAgentAuthoredStep } from '@/features/application-control'
import { restoreAudioEditBaseline } from '@/core/audioEdit/baseline'
import {
  AudioEditSourceMissingError, isEmptyAudioEditSource,
  audioEditProjectFromDocument,
  audioEditProjectToDocumentContent,
  createAudioEditDocumentContent,
} from '@/core/audioEdit/documentContent'
import { audioEditProjectSchema } from '@/core/audioEdit/schema'
import { createIncrementalSchemaParser } from '@/core/incrementalSchemaParse'
import { jsonEqual } from '@/core/jsonEqual'
import type { AudioEditProjectDocument, AudioEditSourceMetadata } from '@/core/audioEdit/types'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { ApplicationPersistenceFailure, type ApplicationPersistenceParticipant, type ApplicationPersistenceResolver } from '@/core/application-control/execution/persistence'
import type { DocumentContainerRef, DocumentTarget } from '@/core/documents/types'
import { createLogger } from '@/core/logging'
import { notifyUser } from '@/contexts/NotificationContext'
import { isDocumentServiceError, toError } from '@/features/documents/documentErrors'
import type { DocumentSession } from '@/features/documents/documentSession'
import { getDocumentSessionRegistry, type DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import type { DocumentContentAdapter, DocumentLeaveOutcome } from '@/features/documents/documentSessionTypes'

/*
 * 口播文档实例（3.3 口播接入，按 3.2 镜头参考的样板接入通用文档会话）。
 *
 * 一份打开的 `.hjaud` 文档 = 一个通用文档会话（存储底座 2.4）+ 一个本工具的实例：
 * - 实例是内容、撤销与处理状态（busy）的唯一持有者；会话只持有元信息与保存状态，经适配接口取内容。
 * - 自动保存、草稿、离开提示、冲突、退出屏障全部由会话负责，本文件不再有计时器、保存队列或关闭守卫。
 * - 文档名就是文件名：会话元信息里的名称一变（改名、草稿转正）就同步进 document.name，不进撤销。
 * - 素材（source）只能由导入与“重新定位原素材”设置，普通编辑不能改。
 * - 会话结束（离开、移到回收站、被释放）时实例自动拆掉；之后再访问会重新打开。
 * - 同一份文档全局只有一个实例：界面、助手后台读写、剪辑取用口播结果都用同一个实例。
 *
 * 历史命名：函数与类型里的 “Project” 指一份口播文档（ID 即文档 ID），保留旧名以免全工具大面积改名。
 */

export interface AudioEditProjectInstance {
  document: AudioEditProjectDocument
  past: AudioEditProjectDocument[]
  future: AudioEditProjectDocument[]
  /** 内存里有尚未写入文件的修改（来自会话）。 */
  dirty: boolean
  /** 最近一次保存失败或冲突（来自会话），成功后清空。 */
  error: string | null
  /** 每次内容变化加一（处理结果只覆盖提交时的版本）。 */
  version: number
  /** 文件里的版本（会话元信息 revision）；主进程读文件得到的就是这个版本。 */
  persistedRevision: number
  batchDepth: number
  busy: number
  session: DocumentSession
  /** 本版本不认识的顶层字段，保存时原样写回。 */
  extras: Record<string, unknown>
}

interface InstanceRecord {
  instance: AudioEditProjectInstance
  /**
   * 进行中的连续拖动数。拖动中的中间状态只校验改到的字段、不通知会话（不落盘、主进程读不到），
   * 界面与试听照常经 publish 跟着变；松手整份校验通过后通知会话一次。
   */
  gestures: number
  /** 拖动期间会话保存时看到的内容：拖动开始前的作品。 */
  persisted: AudioEditProjectDocument | null
  /** 拖动期间有内容变化还没通知会话。 */
  contentPending: boolean
  contentListeners: Set<() => void>
  dispose: () => void
}

const logger = createLogger('features.audioEdit.documentInstances')
/**
 * 一小时口播上万个词块、上千条剪切，每改一个词整份校验要几十毫秒。编辑都是不可变更新，作品发布前经它校验并冻结：
 * 没换引用的词块、剪切直接沿用上次的校验结果，结果仍与整份校验相同（做法见 createIncrementalSchemaParser）。
 */
const projectParser = createIncrementalSchemaParser<AudioEditProjectDocument>(audioEditProjectSchema)
function parseProject(value: AudioEditProjectDocument, base?: AudioEditProjectDocument): AudioEditProjectDocument {
  return projectParser.parse(value, base, error => logger.warn('口播增量校验意外退回整份校验', { event: 'audio_edit.document.validation_fallback', error: toError(error) }))
}
/** 助手 `audio_edit` 作用域的修订：只随口播内容（含改名、重新载入）推进；打开、关闭某份口播不推进，否则读一下别的口播就会让手里的撤销引用失效。 */
let catalogRevision = 0
export function getAudioEditRevision(): number { return catalogRevision }
const participants = new Map<string, ApplicationPersistenceParticipant>()
const records = new Map<string, InstanceRecord>()
const loads = new Map<string, Promise<AudioEditProjectInstance>>()
const leaving = new Map<string, Promise<DocumentLeaveOutcome>>()
const listeners = new Set<(instance: AudioEditProjectInstance) => void>()
const disposalListeners = new Set<(id: string) => void>()
export function subscribeAudioEditProjectDisposal(listener: (id: string) => void): () => void {
  disposalListeners.add(listener)
  return () => { disposalListeners.delete(listener) }
}
let registryOverride: DocumentSessionRegistry | null = null

/** 仅供测试：换成内存替身的会话登记表；传 null 恢复应用唯一的那一个。 */
export function setAudioEditDocumentRegistryForTests(registry: DocumentSessionRegistry | null): void {
  registryOverride = registry
}

function documentRegistry(): DocumentSessionRegistry {
  return registryOverride ?? getDocumentSessionRegistry()
}

function publish(instance: AudioEditProjectInstance): void { for (const listener of listeners) listener(instance) }
export function subscribeAudioEditInstances(listener: (instance: AudioEditProjectInstance) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getAudioEditProjectInstance(id: string): AudioEditProjectInstance | undefined {
  const record = records.get(id)
  return record && !record.instance.session.isEnded ? record.instance : undefined
}

/** 原生录音和拼接持有同一实例锁；暂停提交后释放，所有 UI/助手写入口共同受保护。 */
export function lockAudioEditRecording(id: string, expectedRevision?: number): () => void {
  const { instance } = requireRecord(id)
  if (instance.busy) throw new Error('请等待当前处理完成')
  if (expectedRevision !== undefined && (instance.dirty || instance.persistedRevision !== expectedRevision)) throw new Error('作品已改变，请重新选择录音位置')
  instance.busy += 1
  publish(instance)
  let released = false
  return () => { if (!released) { released = true; instance.busy -= 1; publish(instance) } }
}

/** 有正在打开、离开或处理中的口播（应用关闭前检查）。 */
export function hasActiveAudioEditProjectWork(): boolean {
  return loads.size > 0 || leaving.size > 0 || [...records.values()].some((record) => record.instance.busy > 0)
}

function notifyContent(record: InstanceRecord): void {
  if (record.gestures > 0) { record.contentPending = true; return }
  record.contentPending = false
  for (const listener of record.contentListeners) listener()
}

function syncFromSession(record: InstanceRecord): void {
  const { instance } = record
  const { session } = instance
  const state = session.getState()
  const meta = session.documentMeta
  const error = state.status === 'failed' || state.status === 'conflict' ? state.error?.message ?? '口播保存失败' : null
  const changed = instance.document.name !== meta.name || instance.dirty !== session.dirty
    || instance.error !== error || instance.persistedRevision !== meta.revision
  if (!changed) return
  if (instance.document.name !== meta.name) {
    instance.document = { ...instance.document, name: meta.name }
    catalogRevision += 1
  }
  instance.dirty = session.dirty
  instance.error = error
  instance.persistedRevision = meta.revision
  publish(instance)
}

/** 把一个已打开的文档会话接成实例（同步）：读内容、附着到会话、同步名称与保存状态、会话结束时自动拆掉。 */
function bindAudioEditSession(session: DocumentSession): AudioEditProjectInstance {
  const existing = records.get(session.id)
  if (existing && existing.instance.session === session && !session.isEnded) return existing.instance
  existing?.dispose()
  const meta = session.documentMeta
  const { project, extras } = audioEditProjectFromDocument(meta, session.getContent(), true)
  const instance: AudioEditProjectInstance = {
    // 打开时登记一次校验结果，之后的编辑只校验换掉的部分
    document: parseProject(project), past: [], future: [], dirty: session.dirty, error: null, version: 0,
    persistedRevision: meta.revision, batchDepth: 0, busy: 0, session, extras,
  }
  const record: InstanceRecord = { instance, gestures: 0, persisted: null, contentPending: false, contentListeners: new Set(), dispose: () => undefined }
  const adapter: DocumentContentAdapter = {
    getContent: () => audioEditProjectToDocumentContent(record.persisted ?? instance.document, instance.extras),
    receiveContent: (content) => {
      // 冲突后“重新载入”、换位置后引用被改写：按新内容重建，撤销历史不跨版本
      const next = audioEditProjectFromDocument(session.documentMeta, content, true)
      instance.document = { ...parseProject(next.project), revision: instance.document.revision + 1 }
      instance.extras = next.extras
      instance.past = []
      instance.future = []
      instance.version += 1
      catalogRevision += 1
      publish(instance)
    },
    subscribe: (onChange) => {
      record.contentListeners.add(onChange)
      return () => { record.contentListeners.delete(onChange) }
    },
  }
  const detach = session.attach(adapter)
  const unsubscribeSession = session.subscribe(() => {
    if (session.isEnded) { record.dispose(); return }
    syncFromSession(record)
  })
  let disposed = false
  record.dispose = () => {
    if (disposed) return
    disposed = true
    unsubscribeSession()
    detach()
    if (records.get(session.id) === record) records.delete(session.id)
    participants.delete(session.id)
    for (const listener of disposalListeners) listener(session.id)
    publish(instance)
  }
  records.set(session.id, record)
  publish(instance)
  return instance
}

/** 绑定失败时不留没有实例附着的会话（素材缺失除外：界面要接着请用户导入）。 */
async function bindOrDiscard(session: DocumentSession): Promise<AudioEditProjectInstance> {
  try {
    return bindAudioEditSession(session)
  } catch (error) {
    if (error instanceof AudioEditSourceMissingError) throw error
    logger.warn('口播文档内容无法载入', { event: 'audio_edit.document.bind.failed', error: toError(error), context: { docId: session.id } })
    if (!session.isEnded) await session.discard()
    throw error
  }
}

/**
 * 打开（或复用）口播实例。找不到文档时报 NOT_FOUND；文档还没有素材时报 AudioEditSourceMissingError
 * （会话保持打开，界面接着用 assignAudioEditSource 导入或用 abandonAudioEditDocument 放弃）。
 */
export async function loadAudioEditProject(id: string, path?: string): Promise<AudioEditProjectInstance> {
  const existing = getAudioEditProjectInstance(id)
  if (existing) return existing
  if (leaving.has(id)) throw new Error('口播正在关闭，请稍后再试。')
  const pending = loads.get(id)
  if (pending) return pending
  const target: DocumentTarget = path ? { id, path } : { id }
  const loading = (async () => {
    let session: DocumentSession
    try {
      session = await documentRegistry().open(target)
    } catch (error) {
      if (isDocumentServiceError(error, 'DocumentNotFoundError')) throw new Error('找不到口播。')
      throw error
    }
    return await bindOrDiscard(session)
  })()
  loads.set(id, loading)
  try { return await loading } finally { if (loads.get(id) === loading) loads.delete(id) }
}

/** 导入音频或视频即新建草稿（以草稿标记立即写进“口播”文件夹或所在项目），并接成实例。 */
export async function createAudioEditDraft(source: AudioEditSourceMetadata | null, container: DocumentContainerRef = { kind: 'user' }): Promise<AudioEditProjectInstance> {
  assertApplicationWritesAllowed()
  const session = await documentRegistry().create({ kind: 'audio_edit', container, content: createAudioEditDocumentContent(source) })
  const instance = await bindOrDiscard(session)
  logger.info('新建口播草稿', { event: 'audio_edit.document.create_draft.completed', context: { docId: session.id, mediaType: source?.mediaType } })
  return instance
}

/** 给还没有素材的口播（如助手 create_document 新建的空文档）导入素材，然后接成实例。 */
export async function assignAudioEditSource(id: string, source: AudioEditSourceMetadata): Promise<AudioEditProjectInstance> {
  assertApplicationWritesAllowed()
  const existing = getAudioEditProjectInstance(id)
  if (existing) {
    if (!isEmptyAudioEditSource(existing.document.source)) throw new Error('这份口播已经有素材，请用“重新定位原素材”。')
    acceptAudioEditNativeResult(id, { ...existing.document, source }, existing.version)
    await flushAudioEditProject(id)
    return existing
  }
  const session = await documentRegistry().open({ id })
  const content = session.getContent()
  const current = content && typeof content === 'object' ? content as Record<string, unknown> : {}
  if (current.source) return await bindOrDiscard(session)
  session.update({ ...createAudioEditDocumentContent(source), ...current, source })
  const instance = await bindOrDiscard(session)
  await session.flush()
  return instance
}

/** 放弃一份没有素材、也没有导入的口播（用户取消了导入）：按离开流程处理，空草稿直接删除。 */
export async function abandonAudioEditDocument(id: string): Promise<void> {
  if (getAudioEditProjectInstance(id)) return
  await documentRegistry().leave(id)
}

/**
 * 两份作品哪些顶层字段内容不同。编辑都是不可变更新，比较按引用短路：改一个词只展开换掉的那个词块，
 * 其余上万个词块、剪切同一引用直接跳过。
 */
function changedFields(before: AudioEditProjectDocument, after: AudioEditProjectDocument, ignored?: ReadonlySet<string>): string[] {
  const left = before as unknown as Record<string, unknown>, right = after as unknown as Record<string, unknown>
  const changed: string[] = []
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (ignored?.has(key) || jsonEqual(left[key], right[key])) continue
    changed.push(key)
  }
  return changed
}

/**
 * 撤销步数。一小时口播校对动辄几百次删词、恢复，50 步撤不回 AI 粗剪那一步。历史里的作品共享没改动的子树，
 * 每步只多出换掉的数组与节点（改一个词约是一份词块指针数组，上万词块约 0.1 MB），500 步约几十 MB。
 */
const UNDO_LIMIT = 500

/** 显示设置、修订号与更新时间不进撤销。 */
const NOT_UNDOABLE = new Set(['viewSettings', 'revision', 'updatedAt'])
function hasUndoableChanges(before: AudioEditProjectDocument, after: AudioEditProjectDocument): boolean {
  return changedFields(before, after, NOT_UNDOABLE).length > 0
}

/** 只校验改到的顶层字段（跨字段的范围与引用检查留给整份校验）。 */
function validateChangedFields(document: AudioEditProjectDocument, fields: readonly string[]): void {
  const shape = audioEditProjectSchema.shape as Record<string, { parse(value: unknown): unknown } | undefined>
  for (const field of fields) {
    const schema = shape[field]
    if (!schema) { audioEditProjectSchema.parse(document); return }
    schema.parse((document as unknown as Record<string, unknown>)[field])
  }
}

function requireRecord(id: string): InstanceRecord {
  const record = records.get(id)
  if (!record || record.instance.session.isEnded) throw new Error('口播尚未载入。')
  return record
}

export function editAudioEditProject(id: string, update: (document: AudioEditProjectDocument) => AudioEditProjectDocument): AudioEditProjectDocument {
  return updateAudioEditProject(id, update, {})
}

/** 读到写回之间作品又变了：最多重算几次，仍在变就请调用方稍后再试。 */
const MAX_REBASE_ATTEMPTS = 4
class StaleRead extends Error {}

/**
 * 需要异步计算的编辑（助手写入要先等检测结果等）：在读到的作品上算出新作品再提交；提交时作品已不是读到的那份
 * （用户同时在改）就重新读、重新算，只提交基于最新内容的结果，不拿旧快照把别人刚做的修改覆盖掉。
 * compute 必须是作品的纯函数（不可变更新），重算不会重复产生副作用。
 */
export async function editAudioEditProjectAsync(id: string, compute: (current: AudioEditProjectDocument) => Promise<AudioEditProjectDocument>): Promise<{ previous: AudioEditProjectDocument; saved: AudioEditProjectDocument }> {
  for (let attempt = 1; ; attempt++) {
    const current = (await loadAudioEditProject(id)).document
    const next = await compute(current)
    try {
      // 助手写入不是用户手里的拖动：即使用户正拖着滑杆，也整份校验，不合规的内容当场退回，不等到用户松手。
      const saved = updateAudioEditProject(id, latest => { if (latest !== current) throw new StaleRead(); return next }, { complete: true })
      return { previous: current, saved }
    } catch (error) {
      if (!(error instanceof StaleRead)) throw error
      if (attempt >= MAX_REBASE_ATTEMPTS) throw new Error('CONFLICT:口播正在连续变化，请稍后重试。')
    }
  }
}

/**
 * 连续拖动（效果参数、滑杆）：期间每次修改照常生效、试听实时跟着变，结束时合成一步撤销；取消则回到拖动前。
 * 返回的 finish / cancel 只生效一次。
 */
export function beginAudioEditGesture(id: string): { finish: () => void; cancel: () => void } {
  const record = requireRecord(id)
  const { instance } = record
  const initial = instance.document, initialVersion = instance.version
  instance.batchDepth += 1
  if (record.gestures++ === 0) record.persisted = instance.document
  let ended = false
  const end = (cancelled: boolean): void => {
    if (ended) return
    ended = true
    if (records.get(id) !== record) return
    let restore = cancelled
    if (!restore && instance.version !== initialVersion) {
      // 拖动中只校验了改到的字段，松手时整份校验一次；通过就换成校验结果（冻结、可供下次增量沿用），
      // 不通过就回到拖动前并提示（不把错误抛进指针事件）
      try { instance.document = { ...parseProject(instance.document, initial), revision: instance.document.revision } } catch (error) {
        restore = true
        logger.error('拖动后的口播设置没有通过检查，已回到拖动前', { event: 'audio_edit.gesture.validation.failed', error: toError(error), context: { docId: id } })
        notifyUser('拖动后的设置没有通过检查，已回到拖动前的状态，请换个数值再试。', 'error')
      }
    }
    if (--record.gestures === 0) record.persisted = null
    if (restore && instance.version !== initialVersion) commitEdit(record, { ...initial, revision: instance.document.revision })
    instance.batchDepth -= 1
    if (!restore && instance.version !== initialVersion && !instance.batchDepth && hasUndoableChanges(initial, instance.document)) { instance.past = [...instance.past.slice(1 - UNDO_LIMIT), initial]; instance.future = []; publish(instance) }
    if (!record.gestures && record.contentPending) notifyContent(record)
  }
  return { finish: () => end(false), cancel: () => end(true) }
}

/** 撤销/补偿恢复内容和锁；其余写屏障、来源不变、schema、批次和历史语义与编辑一致。 */
export function restoreAudioEditProjectSnapshot(id: string, snapshot: AudioEditProjectDocument, expected: AudioEditProjectDocument): AudioEditProjectDocument {
  return updateAudioEditProject(id, current => {
    if (!sameAudioEditProjectContent(current, expected)) throw new Error('口播已有后续修改，请使用口播撤销逐步恢复。')
    return { ...snapshot, source: current.source }
  }, { restoring: true, complete: true })
}

/** 内容是否相同（修订号与更新时间不算内容）；共享子树按引用短路，不整份序列化。 */
export function sameAudioEditProjectContent(left: AudioEditProjectDocument, right: AudioEditProjectDocument): boolean {
  return jsonEqual({ ...left, revision: 0, updatedAt: 0 }, { ...right, revision: 0, updatedAt: 0 })
}

/**
 * restoring：撤销与补偿，连锁定一起恢复。complete：不论是否在拖动中都整份校验（助手写入与补偿用）；
 * 否则拖动进行中只校验改到的字段，跨字段检查留到松手。
 */
function updateAudioEditProject(id: string, update: (document: AudioEditProjectDocument) => AudioEditProjectDocument, { restoring = false, complete = false }: { restoring?: boolean; complete?: boolean }): AudioEditProjectDocument {
  assertApplicationWritesAllowed()
  const record = requireRecord(id)
  const { instance } = record
  if (instance.busy) throw new Error('请等待当前处理完成或取消后再修改。')
  const next = update(instance.document)
  if (next === instance.document) return instance.document
  // 名称就是文件名，改名走通用文档改名（documents.document.name）
  const normalized = { ...next, id: instance.document.id, name: instance.document.name, editBaseline: instance.document.editBaseline }
  const changed = changedFields(instance.document, normalized)
  if (!changed.length) return instance.document
  if (changed.includes('source')) throw new Error('IMMUTABLE_SOURCE：原素材不能通过编辑修改，请用“重新定位原素材”。')
  // 拖动中只校验改到的字段（跨字段检查留到松手）；其余编辑整份校验，没换引用的部分沿用上次结果
  const validated = record.gestures > 0 && !complete ? (validateChangedFields(normalized, changed), normalized) : parseProject(normalized, instance.document)
  if (!restoring) assertAudioEditLocks(instance.document, validated)
  return commitEdit(record, validated)
}

function commitEdit(record: InstanceRecord, next: AudioEditProjectDocument): AudioEditProjectDocument {
  const { instance } = record
  if (hasUndoableChanges(instance.document, next)) {
    if (!instance.batchDepth) instance.past = [...instance.past.slice(1 - UNDO_LIMIT), instance.document]
    instance.future = []
  }
  instance.document = { ...next, revision: instance.document.revision + 1 }
  if (isAgentWritingDocument(instance.document.id)) markAgentAuthoredStep(instance.document)
  catalogRevision += 1
  instance.version += 1
  publish(instance)
  notifyContent(record)
  return instance.document
}

/** Explicit undo restores locks too, just like ordinary undo; normal edits still enforce them. */
export function resetAudioEditProject(id: string, expectedVersion: number): AudioEditProjectDocument {
  assertApplicationWritesAllowed()
  const record = records.get(id)
  if (!record || record.instance.busy) throw new Error('请等待当前处理完成或取消后再撤销。')
  const { instance } = record
  if (instance.version !== expectedVersion) throw new Error('确认期间口播已修改，请重新确认撤销范围。')
  const next = parseProject(restoreAudioEditBaseline(instance.document), instance.document)
  if (!hasUndoableChanges(instance.document, next)) return instance.document
  return commitEdit(record, next)
}

export function undoAudioEditProject(id: string, redo = false): void {
  assertApplicationWritesAllowed()
  const record = records.get(id)
  if (!record || record.instance.busy) return
  const { instance } = record
  const from = redo ? instance.future : instance.past
  const previous = redo ? from[0] : from.at(-1)
  if (!previous) return
  if (redo) { instance.future = from.slice(1); instance.past = [...instance.past.slice(1 - UNDO_LIMIT), instance.document] }
  else { instance.past = from.slice(0, -1); instance.future = [instance.document, ...instance.future.slice(0, UNDO_LIMIT - 1)] }
  const current = instance.document
  instance.document = { ...previous, id: current.id, name: current.name, viewSettings: current.viewSettings, revision: current.revision + 1 }
  catalogRevision += 1
  instance.version += 1
  publish(instance)
  notifyContent(record)
  // 撤销、重做换了素材（撤掉或重做一段补录拼接）时立即保存，崩溃后不能重新出现已撤销的录音；
  // 其余撤销与普通编辑一样交给会话的防抖保存，连按撤销不再每步整份写一遍，离开时会话照常写完。
  if (previous.source !== current.source) void flushAudioEditProject(id).catch(error => logger.warn('撤销保存失败，修改仍保留', { event: 'audio_edit.undo.save.failed', error }))
}

/** 保存屏障：写完当前全部修改（会话的 flush）。失败时修改保留在实例里，会话按退避自动重试。 */
export async function flushAudioEditProject(id: string): Promise<void> {
  const record = records.get(id)
  if (!record || record.instance.session.isEnded) return
  try {
    await record.instance.session.flush()
  } finally {
    syncFromSession(record)
  }
}

/** A native result replaces only the version it was submitted against; the session then saves it. */
export function acceptAudioEditNativeResult(id: string, document: AudioEditProjectDocument, version: number): void {
  const record = records.get(id)
  if (!record || record.instance.version !== version) throw new Error('口播已改变，处理结果没有覆盖当前编辑。')
  const { instance } = record
  // 主进程送回的处理结果与编辑一样先校验再发布，并登记、冻结，之后的编辑可在它上面增量校验
  const validated = parseProject({ ...document, id: instance.document.id, name: instance.document.name }, instance.document)
  instance.past = [...instance.past.slice(1 - UNDO_LIMIT), instance.document]
  instance.future = []
  instance.document = { ...validated, revision: instance.document.revision + 1 }
  if (isAgentWritingDocument(instance.document.id)) markAgentAuthoredStep(instance.document)
  catalogRevision += 1
  instance.version += 1
  publish(instance)
  notifyContent(record)
}

export async function withAudioEditProjectOperation<T>(id: string, operation: (instance: AudioEditProjectInstance, commit: (update: (document: AudioEditProjectDocument) => AudioEditProjectDocument) => AudioEditProjectDocument) => Promise<T>): Promise<T> {
  assertApplicationWritesAllowed()
  const instance = await loadAudioEditProject(id)
  if (instance.busy) throw new Error('该口播已有处理任务。')
  instance.busy += 1
  publish(instance)
  try {
    // 主进程按文档 ID 读文件处理：先把修改写完
    await flushAudioEditProject(id)
    return await operation(instance, (update) => {
      instance.busy -= 1
      try { return editAudioEditProject(id, update) } finally { instance.busy += 1; publish(instance) }
    })
  }
  finally { instance.busy -= 1; publish(instance) }
}

/**
 * 离开口播（返回列表、切换到另一份）：等处理结束后走通用离开流程
 * （已保存的直接关闭；空草稿删除；有内容的草稿询问“保存 / 不保存 / 取消”）。
 * 除了 cancelled，会话都已结束，实例随之拆掉。失败时抛错，会话与修改保留。
 */
export async function leaveAudioEditProject(id: string): Promise<DocumentLeaveOutcome> {
  const record = records.get(id)
  if (!record || record.instance.session.isEnded) return 'closed'
  if (record.instance.busy) throw new Error('口播正在处理，请等待完成或取消后再离开。')
  const previous = leaving.get(id)
  if (previous) return await previous
  const operation = (async () => {
    const outcome = await documentRegistry().leave(id)
    if (outcome !== 'cancelled') record.dispose()
    logger.info('离开口播文档', { event: 'audio_edit.document.leave.completed', context: { docId: id, outcome } })
    return outcome
  })()
  leaving.set(id, operation)
  try {
    return await operation
  } catch (error) {
    logger.warn('离开口播文档失败，修改已保留', { event: 'audio_edit.document.leave.failed', error: toError(error), context: { docId: id } })
    throw error
  } finally {
    if (leaving.get(id) === operation) leaving.delete(id)
  }
}

/**
 * 释放后台持有的实例（通用文档操作移到回收站前调用，见 registerDocumentReleaser）：
 * 正在处理、正在打开或离开时拒绝；其余写完并关闭会话。前台编辑由通用层先拒绝；编辑器状态里还记着
 * 这份（页面已切走）时照样释放，界面状态随会话结束回到列表。
 */
export async function releaseAudioEditProject(id: string): Promise<boolean> {
  const record = records.get(id)
  if (!record || record.instance.session.isEnded) {
    // 没有实例附着的会话（还没导入素材的空文档）也一并结束
    const session = documentRegistry().get(id)
    if (session && !session.isEnded) await session.close()
    return true
  }
  if (record.instance.busy || loads.has(id) || leaving.has(id)) return false
  await record.instance.session.close()
  record.dispose()
  return true
}

/** 仅供测试：拆掉全部实例并结束会话（不写盘）。 */
export async function resetAudioEditProjectInstancesForTests(): Promise<void> {
  const all = [...records.values()]
  records.clear()
  loads.clear()
  leaving.clear()
  participants.clear()
  for (const record of all) {
    record.dispose()
    await record.instance.session.discard()
  }
}

export const resolveAudioEditPersistenceParticipants: ApplicationPersistenceResolver = (steps) => {
  // 逐条增删剪切与属性写入同属一次修改：同一事务合成一步撤销、最后保存一次
  const ids = new Set(steps.flatMap((step) => step.kind === 'mutation' && step.target.kind.startsWith('audio_edit.') ? [step.target.id.split(':')[0]]
    : step.kind === 'collection' && step.parent.kind.startsWith('audio_edit.') ? [step.parent.id.split(':')[0]] : []))
  return [...ids].map((id) => {
    const existing = participants.get(id)
    if (existing) return existing
    const participant: ApplicationPersistenceParticipant = { key: `audio_edit:${id}`, begin() {
      const record = records.get(id)
      if (!record) throw new Error('口播尚未载入')
      const { instance } = record
      const initial = instance.document
      const initialVersion = instance.version
      instance.batchDepth += 1
      return {
        async confirm() { try { await flushAudioEditProject(id) } catch (error) {
          throw new ApplicationPersistenceFailure('口播修改已保留，但保存失败。请重试保存，不要重复剪辑。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'retry_audio_edit_save', target: { kind: 'audio_edit.document', id }, replayMutation: false } }, error)
        } },
        release() {
          instance.batchDepth -= 1
          if (instance.version !== initialVersion && !instance.batchDepth && hasUndoableChanges(initial, instance.document)) { instance.past = [...instance.past.slice(1 - UNDO_LIMIT), initial]; publish(instance) }
        },
      }
    } }
    participants.set(id, participant)
    return participant
  })
}
