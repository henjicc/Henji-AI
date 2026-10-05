import { assertAudioEditLocks } from '@/core/audioEdit/edits'
import { restoreAudioEditBaseline } from '@/core/audioEdit/baseline'
import {
  AudioEditSourceMissingError,
  audioEditProjectFromDocument,
  audioEditProjectToDocumentContent,
  createAudioEditDocumentContent,
} from '@/core/audioEdit/documentContent'
import { audioEditProjectSchema } from '@/core/audioEdit/schema'
import type { AudioEditProjectDocument, AudioEditSourceMetadata } from '@/core/audioEdit/types'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { ApplicationPersistenceFailure, type ApplicationPersistenceParticipant, type ApplicationPersistenceResolver } from '@/core/application-control/execution/persistence'
import type { DocumentContainerRef, DocumentTarget } from '@/core/documents/types'
import { createLogger } from '@/core/logging'
import { isDocumentServiceError, toError } from '@/features/documents/documentErrors'
import type { DocumentSession } from '@/features/documents/documentSession'
import { getDocumentSessionRegistry, type DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import type { DocumentContentAdapter, DocumentLeaveOutcome } from '@/features/documents/documentSessionTypes'

/*
 * 口播文档实例（3.3 口播接入，按 3.2 镜头参考的样板接入通用文档会话）。
 *
 * 一份打开的 `.henji-audio` 文档 = 一个通用文档会话（存储底座 2.4）+ 一个本工具的实例：
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
  contentListeners: Set<() => void>
  dispose: () => void
}

const logger = createLogger('features.audioEdit.documentInstances')
let catalogRevision = 0
export function getAudioEditRevision(): number { return catalogRevision }
const participants = new Map<string, ApplicationPersistenceParticipant>()
const records = new Map<string, InstanceRecord>()
const loads = new Map<string, Promise<AudioEditProjectInstance>>()
const leaving = new Map<string, Promise<DocumentLeaveOutcome>>()
const listeners = new Set<(instance: AudioEditProjectInstance) => void>()
let shownDocumentId: string | null = null
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

/** 界面正在显示哪份口播（由界面状态登记）；正在显示的不会被后台释放。 */
export function markAudioEditDocumentShown(id: string | null): void {
  shownDocumentId = id
}

/** 有正在打开、离开或处理中的口播（应用关闭前检查）。 */
export function hasActiveAudioEditProjectWork(): boolean {
  return loads.size > 0 || leaving.size > 0 || [...records.values()].some((record) => record.instance.busy > 0)
}

function notifyContent(record: InstanceRecord): void {
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
export function bindAudioEditSession(session: DocumentSession): AudioEditProjectInstance {
  const existing = records.get(session.id)
  if (existing && existing.instance.session === session && !session.isEnded) return existing.instance
  existing?.dispose()
  const meta = session.documentMeta
  const { project, extras } = audioEditProjectFromDocument(meta, session.getContent())
  const instance: AudioEditProjectInstance = {
    document: project, past: [], future: [], dirty: session.dirty, error: null, version: 0,
    persistedRevision: meta.revision, batchDepth: 0, busy: 0, session, extras,
  }
  const record: InstanceRecord = { instance, contentListeners: new Set(), dispose: () => undefined }
  const adapter: DocumentContentAdapter = {
    getContent: () => audioEditProjectToDocumentContent(instance.document, instance.extras),
    receiveContent: (content) => {
      // 冲突后“重新载入”、换位置后引用被改写：按新内容重建，撤销历史不跨版本
      const next = audioEditProjectFromDocument(session.documentMeta, content)
      instance.document = { ...next.project, revision: instance.document.revision + 1 }
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
    catalogRevision += 1
    publish(instance)
  }
  records.set(session.id, record)
  catalogRevision = Math.max(catalogRevision + 1, meta.revision)
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
export async function createAudioEditDraft(source: AudioEditSourceMetadata, container: DocumentContainerRef = { kind: 'user' }): Promise<AudioEditProjectInstance> {
  assertApplicationWritesAllowed()
  const session = await documentRegistry().create({ kind: 'audio_edit', container, content: createAudioEditDocumentContent(source) })
  const instance = await bindOrDiscard(session)
  logger.info('新建口播草稿', { event: 'audio_edit.document.create_draft.completed', context: { docId: session.id, mediaType: source.mediaType } })
  return instance
}

/** 给还没有素材的口播（如助手 create_document 新建的空文档）导入素材，然后接成实例。 */
export async function assignAudioEditSource(id: string, source: AudioEditSourceMetadata): Promise<AudioEditProjectInstance> {
  assertApplicationWritesAllowed()
  const existing = getAudioEditProjectInstance(id)
  if (existing) throw new Error('这份口播已经有素材，请用“重新定位原素材”。')
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

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function hasUndoableChanges(before: AudioEditProjectDocument, after: AudioEditProjectDocument): boolean {
  const content = (document: AudioEditProjectDocument) => JSON.stringify({ ...document, viewSettings: undefined, revision: 0, updatedAt: 0 })
  return content(before) !== content(after)
}

function requireRecord(id: string): InstanceRecord {
  const record = records.get(id)
  if (!record || record.instance.session.isEnded) throw new Error('口播尚未载入。')
  return record
}

export function editAudioEditProject(id: string, update: (document: AudioEditProjectDocument) => AudioEditProjectDocument): AudioEditProjectDocument {
  assertApplicationWritesAllowed()
  const record = requireRecord(id)
  const { instance } = record
  if (instance.busy) throw new Error('请等待当前处理完成或取消后再修改。')
  const next = update(instance.document)
  if (next === instance.document || sameJson(next, instance.document)) return instance.document
  if (!sameJson(next.source, instance.document.source)) throw new Error('IMMUTABLE_SOURCE：原素材不能通过编辑修改，请用“重新定位原素材”。')
  // 名称就是文件名，改名走通用文档改名（documents.document.name）
  const normalized = { ...next, id: instance.document.id, name: instance.document.name, editBaseline: instance.document.editBaseline }
  audioEditProjectSchema.parse(normalized)
  assertAudioEditLocks(instance.document, normalized)
  return commitEdit(record, normalized)
}

function commitEdit(record: InstanceRecord, next: AudioEditProjectDocument): AudioEditProjectDocument {
  const { instance } = record
  if (hasUndoableChanges(instance.document, next)) {
    if (!instance.batchDepth) instance.past = [...instance.past.slice(-49), instance.document]
    instance.future = []
  }
  instance.document = { ...next, revision: instance.document.revision + 1 }
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
  const next = restoreAudioEditBaseline(instance.document)
  audioEditProjectSchema.parse(next)
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
  if (redo) { instance.future = from.slice(1); instance.past = [...instance.past.slice(-49), instance.document] }
  else { instance.past = from.slice(0, -1); instance.future = [instance.document, ...instance.future.slice(0, 49)] }
  const current = instance.document
  instance.document = { ...previous, id: current.id, name: current.name, source: current.source, editBaseline: current.editBaseline, viewSettings: current.viewSettings, revision: current.revision + 1 }
  catalogRevision += 1
  instance.version += 1
  publish(instance)
  notifyContent(record)
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
  instance.past = [...instance.past.slice(-49), instance.document]
  instance.future = []
  instance.document = { ...document, id: instance.document.id, name: instance.document.name, revision: instance.document.revision + 1 }
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
 * 释放只为后台读写持有的实例（通用文档操作移到回收站前调用，见 registerDocumentReleaser）：
 * 界面正在显示、正在处理、正在打开或离开时拒绝；其余写完并关闭会话。
 */
export async function releaseAudioEditProject(id: string): Promise<boolean> {
  const record = records.get(id)
  if (!record || record.instance.session.isEnded) {
    // 没有实例附着的会话（还没导入素材的空文档）也一并结束
    const session = documentRegistry().get(id)
    if (session && !session.isEnded) await session.close()
    return true
  }
  if (record.instance.busy || loads.has(id) || leaving.has(id) || shownDocumentId === id) return false
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
  shownDocumentId = null
  for (const record of all) {
    record.dispose()
    await record.instance.session.discard()
  }
}

export const resolveAudioEditPersistenceParticipants: ApplicationPersistenceResolver = (steps) => {
  const ids = new Set(steps.flatMap((step) => step.kind === 'mutation' && step.target.kind.startsWith('audio_edit.') ? [step.target.id.split(':')[0]] : []))
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
          throw new ApplicationPersistenceFailure('口播修改已保留，但保存失败。请重试保存，不要重复剪辑。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'retry_audio_edit_save', target: { kind: 'audio_edit.project', id }, replayMutation: false } }, error)
        } },
        release() {
          instance.batchDepth -= 1
          if (instance.version !== initialVersion && !instance.batchDepth && hasUndoableChanges(initial, instance.document)) { instance.past = [...instance.past.slice(-49), initial]; publish(instance) }
        },
      }
    } }
    participants.set(id, participant)
    return participant
  })
}
