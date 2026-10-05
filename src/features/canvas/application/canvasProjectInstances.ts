import type { Viewport } from '@xyflow/react'

import { canvasStoreAttachment, createCanvasStore } from '@/stores/canvasStore'
import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { notifyApplicationDomainChanged } from '@/core/application-control/domainChangeSignal'
import type { DocumentContainerRef, DocumentTarget } from '@/core/documents/types'
import { createLogger } from '@/core/logging'
import { isDocumentServiceError, toError } from '@/features/documents/documentErrors'
import type { DocumentSession } from '@/features/documents/documentSession'
import type { DocumentContentAdapter, DocumentLeaveOutcome } from '@/features/documents/documentSessionTypes'

import { migrateCanvasGenerationPrompts } from './canvasGenerationPromptMigration'
import {
  canvasFromDocumentContent,
  canvasToDocumentContent,
  DEFAULT_CANVAS_VIEWPORT,
  type CanvasGraphContent,
  type Project,
} from './canvasDocumentContent'
import { canvasDocumentRegistry } from './canvasDocumentEnvironment'
import { createCanvasSessionStatePersister, readCanvasSessionState, type CanvasSessionStatePersister } from './canvasSessionState'

/*
 * 画布文档实例（3.4 画布接入，按 3.2 镜头参考样板接到通用文档会话）。
 *
 * 一份打开的 `.henji-canvas` = 一个通用文档会话（存储底座 2.4）+ 一个画布 store：
 * - store 是节点、连线、撤销与界面状态的唯一持有者；会话只持有元信息与保存状态，经适配接口取内容。
 * - 自动保存（防抖、只在有变化时写）、草稿、离开提示、冲突、退出屏障全部由会话负责；
 *   拖动节点期间不通知会话，松手后才标脏，避免每一帧都排一次保存。
 * - 撤销记录与视口不写进文档，按文档 ID 存程序目录（canvasSessionState.ts）。
 * - 同一份画布全局只有一个实例：界面、助手后台读写、生成任务回写都租用同一个实例（lease），
 *   离开或释放前等租约归零。会话结束（离开、移到回收站、被释放）时实例自动拆掉，之后再访问会重新打开。
 *
 * 历史命名：函数与类型里的 “Project” 指一份画布文档（ID 即文档 ID），保留旧名以免全画布大面积改名。
 */

export interface CanvasProjectInstance {
  readonly id: string
  readonly store: ReturnType<typeof createCanvasStore>
  readonly session: DocumentSession
  /** 本地内容版本：每次内容变化加一（取毫秒时间且严格递增），助手并发基线与 snapshot().updatedAt 共用。 */
  revision: number
  leases: number
  closing: boolean
  snapshot(): Project
  /** 暂停自动保存（批量事务期间不写中间结果）；返回恢复函数，可嵌套。 */
  pausePersistence(): () => void
  /** 多图层内嵌包位置（canvasLayers 写回后更新，进下一次保存）。 */
  setLayerPackages(packages: Record<string, string>): void
  readonly sessionState: CanvasSessionStatePersister
  dispose(): void
}

const logger = createLogger('features.canvas.documentInstances')
const instances = new Map<string, CanvasProjectInstance>()
const loading = new Map<string, Promise<CanvasProjectInstance>>()
const leaving = new Map<string, Promise<DocumentLeaveOutcome>>()
const idleListeners = new Map<string, Set<() => void>>()
const changeListeners = new Set<(instance: CanvasProjectInstance) => void>()
let closeGuardRegistered = false

/** 应用退出前把每份打开画布的视口与撤销记录写进会话状态（文档本身由会话登记表的退出屏障写完）。 */
function ensureCloseGuard(): void {
  if (closeGuardRegistered) return
  closeGuardRegistered = true
  registerApplicationCloseGuard(async () => {
    for (const instance of [...instances.values()]) {
      // 写完画布本身（失败会阻止关闭，修改保留），再记下视口与撤销记录
      if (!instance.session.isEnded) await instance.session.flush()
      await instance.sessionState.flush()
    }
  })
}

/** 实例内容、名称或保存状态变化时通知（项目 store 据此刷新当前画布投影与保存错误）。 */
export function onCanvasProjectInstanceChanged(listener: (instance: CanvasProjectInstance) => void): () => void {
  changeListeners.add(listener)
  return () => { changeListeners.delete(listener) }
}

function emitChanged(instance: CanvasProjectInstance): void {
  for (const listener of [...changeListeners]) listener(instance)
}

export function findCanvasProjectInstance(id: string): CanvasProjectInstance | undefined {
  const instance = instances.get(id)
  return instance && !instance.session.isEnded ? instance : undefined
}
export function listCanvasProjectInstances(): CanvasProjectInstance[] { return [...instances.values()] }
export function hasActiveCanvasProjectWork(): boolean {
  return loading.size > 0 || leaving.size > 0 || [...instances.values()].some((instance) => instance.leases > 0)
}
/**
 * 画布所在的容器（项目或作品目录）：画布里生成的结果、新建的内嵌镜头参考都放进这里（3.4）。
 * 画布没有打开时返回 undefined（调用方按作品目录处理）。
 */
export function canvasDocumentContainer(id: string): DocumentContainerRef | undefined {
  return findCanvasProjectInstance(id)?.session.documentMeta.container
}

export function requireCanvasProjectInstance(id: string): CanvasProjectInstance {
  const instance = findCanvasProjectInstance(id)
  if (!instance) throw new Error('PROJECT_NOT_LOADED')
  return instance
}

export interface CanvasSessionInitialState {
  history?: Project['history'] | null
  viewport?: Viewport | null
}

/** 把一个已打开的文档会话接成实例（同步）：建 store、附着到会话、会话结束时自动拆掉。 */
export function bindCanvasSession(session: DocumentSession, initial: CanvasSessionInitialState = {}): CanvasProjectInstance {
  assertApplicationWritesAllowed()
  const existing = instances.get(session.id)
  if (existing && existing.session === session && !session.isEnded) return existing
  existing?.dispose()
  const id = session.id
  let graph: CanvasGraphContent = canvasFromDocumentContent(session.getContent())
  const store = createCanvasStore()
  store.getState().setCanvasData(graph.nodes, graph.edges, initial.history ?? { past: [], future: [] })
  store.getState().setViewportState(initial.viewport ?? DEFAULT_CANVAS_VIEWPORT)

  let revision = Math.max(Date.now(), session.documentMeta.updatedAt)
  let pauses = 0
  const bump = (): void => { revision = Math.max(Date.now(), revision + 1) }
  const snapshot = (): Project => {
    const state = store.getState()
    const meta = session.documentMeta
    return {
      id, name: meta.name, createdAt: meta.createdAt, updatedAt: revision, nodeCount: state.nodes.length, coverPath: null,
      nodes: state.nodes, edges: state.edges, history: state.history, viewport: state.currentViewport,
      ...(graph.imagePool ? { imagePool: graph.imagePool } : {}),
      ...(graph.layerPackages ? { layerPackages: graph.layerPackages } : {}),
    }
  }
  const sessionState = createCanvasSessionStatePersister({ id, store, session })

  let notifySession: () => void = () => undefined
  const adapter: DocumentContentAdapter = {
    getContent: () => {
      const state = store.getState()
      return canvasToDocumentContent({ ...graph, nodes: state.nodes, edges: state.edges })
    },
    receiveContent: (content) => {
      // 冲突后“重新载入”、换位置后引用被改写：按新内容重建画布，撤销记录不跨版本
      graph = canvasFromDocumentContent(content)
      store.getState().setCanvasData(graph.nodes, graph.edges, { past: [], future: [] })
      bump()
      emitChanged(instance)
      notifyApplicationDomainChanged('canvas')
    },
    subscribe: (onChange) => {
      notifySession = onChange
      return store.subscribe((state, previous) => {
        const contentChanged = state.nodes !== previous.nodes || state.edges !== previous.edges
        const dragEnded = previous.dragHistorySnapshot !== null && state.dragHistorySnapshot === null
        if (!contentChanged && !dragEnded && state.history === previous.history) return
        if (contentChanged || state.history !== previous.history) {
          bump()
          emitChanged(instance)
          notifyApplicationDomainChanged('canvas')
        }
        // 拖动期间每一帧都在改节点位置：只在松手后标脏一次，避免反复排保存
        if (state.dragHistorySnapshot !== null) return
        if (contentChanged || dragEnded) onChange()
      })
    },
  }
  const detach = session.attach(adapter)
  const instance: CanvasProjectInstance = {
    id, store, session, leases: 0, closing: false, sessionState,
    get revision() { return revision },
    set revision(value: number) { revision = value },
    snapshot,
    pausePersistence: () => {
      pauses += 1
      if (pauses === 1) void session.suspend()
      let released = false
      return () => {
        if (released) return
        released = true
        pauses -= 1
        if (pauses === 0 && !session.isEnded) session.resume()
      }
    },
    setLayerPackages: (packages) => {
      const next = Object.keys(packages).length ? { ...packages } : undefined
      if (JSON.stringify(next ?? null) === JSON.stringify(graph.layerPackages ?? null)) return
      graph = { ...graph, layerPackages: next }
      notifySession()
    },
    dispose: () => undefined,
  }
  // 名称变化、进入或离开保存失败 / 冲突时通知（项目 store 据此刷新标题与保存错误）；普通的“待保存 / 保存中”不通知
  const hasError = (status: string): boolean => status === 'failed' || status === 'conflict'
  let lastName = session.documentMeta.name
  let lastError = hasError(session.getState().status)
  const unsubscribeSession = session.subscribe(() => {
    if (session.isEnded) {
      instance.dispose()
      return
    }
    const state = session.getState()
    if (state.meta.name !== lastName || hasError(state.status) !== lastError) {
      lastName = state.meta.name
      lastError = hasError(state.status)
      emitChanged(instance)
      notifyApplicationDomainChanged('canvas')
    }
  })
  let disposed = false
  instance.dispose = () => {
    if (disposed) return
    disposed = true
    unsubscribeSession()
    sessionState.dispose()
    detach()
    if (instances.get(id) === instance) instances.delete(id)
    if (canvasStoreAttachment.getStore() === store) detachCanvasProject()
    for (const listener of idleListeners.get(id) ?? []) listener()
    idleListeners.delete(id)
    emitChanged(instance)
    notifyApplicationDomainChanged('canvas')
  }
  instances.set(id, instance)
  ensureCloseGuard()
  notifyApplicationDomainChanged('canvas')
  return instance
}

async function openBound(target: DocumentTarget): Promise<CanvasProjectInstance> {
  let session: DocumentSession
  try {
    session = await canvasDocumentRegistry().open(target)
  } catch (error) {
    if (isDocumentServiceError(error, 'DocumentNotFoundError')) throw new Error('PROJECT_NOT_FOUND')
    throw error
  }
  const existing = instances.get(session.id)
  if (existing && existing.session === session && !session.isEnded) return existing
  try {
    const graph = canvasFromDocumentContent(session.getContent())
    const initial = await readCanvasSessionState(session, graph.imagePool)
    return bindCanvasSession(session, initial)
  } catch (error) {
    // 内容读不懂（文件被手工改坏）：不留一个没有实例附着的会话
    logger.warn('画布内容无法载入', { event: 'canvas.document.bind.failed', error: toError(error), context: { docId: target.id } })
    if (!session.isEnded) await session.discard()
    throw error
  }
}

/** 打开（或复用）画布实例；找不到文档时报 PROJECT_NOT_FOUND。 */
export async function getCanvasProjectInstance(id: string, path?: string): Promise<CanvasProjectInstance> {
  assertApplicationWritesAllowed()
  const existing = findCanvasProjectInstance(id)
  if (existing) return existing
  if (leaving.has(id)) throw new Error('PROJECT_CLOSING')
  let pending = loading.get(id)
  if (!pending) {
    pending = openBound(path ? { id, path } : { id })
    loading.set(id, pending)
  }
  try { return await pending } finally { if (loading.get(id) === pending) loading.delete(id) }
}

/** 新建画布草稿（以草稿标记立即写进最终所在的文件夹：独立 = 作品目录“画布/”，项目 = 项目文件夹）并接成实例。 */
export async function createCanvasDraftInstance(container: DocumentContainerRef = { kind: 'user' }): Promise<CanvasProjectInstance> {
  assertApplicationWritesAllowed()
  const session = await canvasDocumentRegistry().create({ kind: 'canvas', container })
  return bindCanvasSession(session)
}

export function attachCanvasProject(instance: CanvasProjectInstance): void {
  if (instance.closing) throw new Error('PROJECT_CLOSING')
  const state = instance.store.getState()
  const nodes = migrateCanvasGenerationPrompts(state.nodes, state.edges)
  // 仍通过所属画布的写屏障和保存订阅提交，不新增撤销步骤，也不写当前页面的其他画布。
  if (nodes !== state.nodes) instance.store.setState({ nodes })
  closeWhenIdle.delete(instance.id)
  canvasStoreAttachment.attach(instance.store)
}

export function detachCanvasProject(): void { canvasStoreAttachment.attach(createCanvasStore()) }

export function leaseCanvasProject(instance: CanvasProjectInstance): () => void {
  assertApplicationWritesAllowed()
  if (instance.closing || leaving.has(instance.id)) throw new Error('PROJECT_CLOSING')
  instance.leases += 1
  let released = false
  return () => {
    if (released) return
    released = true
    instance.leases -= 1
    if (!instance.leases) {
      for (const listener of idleListeners.get(instance.id) ?? []) listener()
      void closeIdleInstance(instance)
    }
  }
}

/** 后台任务结束（租约归零）后关闭：界面不再显示、离开时还有任务在跑的画布。 */
const closeWhenIdle = new Set<string>()

async function closeIdleInstance(instance: CanvasProjectInstance): Promise<void> {
  if (!closeWhenIdle.has(instance.id) || instance.leases || instance.session.isEnded) return
  if (canvasStoreAttachment.getStore() === instance.store) {
    closeWhenIdle.delete(instance.id)
    return
  }
  closeWhenIdle.delete(instance.id)
  try {
    await instance.session.close()
    await instance.sessionState.flush()
    instance.dispose()
    logger.info('后台任务结束，画布已关闭', { event: 'canvas.document.idle_close.completed', context: { docId: instance.id } })
  } catch (error) {
    logger.warn('后台任务结束后关闭画布失败，修改已保留', { event: 'canvas.document.idle_close.failed', error: toError(error), context: { docId: instance.id } })
  }
}

/**
 * 离开画布（返回列表、切换到另一份画布）：走通用离开流程
 * （已保存的直接关闭；空草稿删除；有内容的草稿询问“保存 / 不保存 / 取消”）。
 * 画布上还有后台任务（生成、渲染等持有租约）时不等它们：照常处理草稿、写完当前修改，
 * 但会话留到任务结束后再关闭，任务结果照常写回这份画布。除了 cancelled，界面都已离开。
 * 失败时抛错，会话与修改保留。
 */
export async function leaveCanvasProject(id: string): Promise<DocumentLeaveOutcome> {
  const instance = findCanvasProjectInstance(id)
  if (!instance) return 'closed'
  const previous = leaving.get(id)
  if (previous) return await previous
  const operation = (async () => {
    instance.closing = true
    try {
      const busy = instance.leases > 0
      const outcome = await canvasDocumentRegistry().leave(id, { keepOpen: busy })
      if (outcome === 'cancelled') return outcome
      if (busy && !instance.session.isEnded) {
        if (canvasStoreAttachment.getStore() === instance.store) detachCanvasProject()
        closeWhenIdle.add(id)
        await instance.sessionState.flush()
      } else {
        // 写完关闭（含草稿保存）后按最后的文件版本记下撤销记录与视口；不保存 / 空草稿已移走，不再写。
        if (outcome === 'closed' || outcome === 'saved') await instance.sessionState.flush()
        instance.dispose()
      }
      logger.info('离开画布', { event: 'canvas.document.leave.completed', context: { docId: id, outcome, busy } })
      return outcome
    } finally {
      instance.closing = false
    }
  })()
  leaving.set(id, operation)
  try {
    return await operation
  } catch (error) {
    logger.warn('离开画布失败，修改已保留', { event: 'canvas.document.leave.failed', error: toError(error), context: { docId: id } })
    throw error
  } finally {
    if (leaving.get(id) === operation) leaving.delete(id)
  }
}

/**
 * 释放只为后台读写持有的实例（通用文档操作移到回收站前调用，见 registerDocumentReleaser）：
 * 界面正在显示、有进行中的操作、正在打开或离开时拒绝；其余写完并关闭会话。
 */
export async function releaseCanvasProjectInstance(id: string): Promise<boolean> {
  const instance = instances.get(id)
  if (!instance || instance.session.isEnded) return true
  if (instance.leases || instance.closing || loading.has(id) || leaving.has(id)) return false
  if (canvasStoreAttachment.getStore() === instance.store) return false
  await instance.session.close()
  await instance.sessionState.flush()
  instance.dispose()
  return true
}

/** 仅供测试：拆掉全部实例并结束会话（不写盘）。 */
export function resetCanvasProjectInstancesForTests(): void {
  const all = [...instances.values()]
  instances.clear()
  loading.clear()
  leaving.clear()
  idleListeners.clear()
  closeWhenIdle.clear()
  for (const instance of all) {
    instance.dispose()
    void instance.session.discard()
  }
  detachCanvasProject()
}
