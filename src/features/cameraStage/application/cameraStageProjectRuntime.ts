import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { notifyApplicationDomainChanged } from '@/core/application-control/domainChangeSignal'
import type { DocumentContainerRef, DocumentTarget } from '@/core/documents/types'
import { createLogger } from '@/core/logging'
import { isDocumentServiceError, toError } from '@/features/documents/documentErrors'
import type { DocumentSession } from '@/features/documents/documentSession'
import { getDocumentSessionRegistry, type DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import type { DocumentContentAdapter, DocumentLeaveOutcome } from '@/features/documents/documentSessionTypes'

import { createDefaultCameraStageSceneSnapshot } from '../domain/defaultSceneSnapshot'
import {
  isBlankSceneContent,
  sceneFromDocumentContent,
  sceneToDocumentContent,
  type CameraStageSceneContent,
  type StageSceneRuntimeSnapshot,
} from '../domain/sceneSerialization'
import { compileStateKeyframesToAnimation } from '../domain/stateKeyframeCompiler'
import {
  attachCameraStageStore,
  cameraStageStoreAttachment,
  createCameraStageStore,
  type CameraStageOwnedStore,
} from '../store/cameraStageStore'

/*
 * 镜头参考文档实例（3.2 镜头参考接入，工具接入通用文档会话的样板）。
 *
 * 一份打开的 `.henji-stage` 文档 = 一个通用文档会话（存储底座 2.4）+ 一个本工具的场景 store：
 * - store 是场景内容、撤销与界面状态的唯一持有者；会话只持有元信息与保存状态，经适配接口取内容。
 * - 自动保存、草稿、离开提示、冲突、退出屏障全部由会话负责，本文件不再有计时器、脏标记或保存队列。
 * - 文档名就是文件名：会话元信息里的名称一变（改名、草稿转正）就同步进 store 的 currentProjectName。
 * - 会话结束（离开、移到回收站、被释放）时实例自动拆掉；之后再访问会重新打开。
 * - 同一份文档全局只有一个实例：界面、助手后台读写、画布节点渲染都租用同一个实例（lease），
 *   离开或释放前等待租约归零。
 *
 * 历史命名：函数与类型里的 “Project” 指一份镜头参考文档（ID 即文档 ID），保留旧名以免全工具大面积改名。
 */

export interface CameraStageProjectSnapshot extends StageSceneRuntimeSnapshot {
  /** 镜头参考文档 ID。 */
  id: string
  /** 文档名（文件名去扩展名）。 */
  name: string
}

export interface CameraStageProjectInstance {
  id: string
  store: CameraStageOwnedStore
  session: DocumentSession
  leases: number
  idle: Set<() => void>
  dispose: () => void
}

const logger = createLogger('features.cameraStage.documentInstances')
const instances = new Map<string, CameraStageProjectInstance>()
const loading = new Map<string, Promise<CameraStageProjectInstance>>()
const leaving = new Map<string, Promise<DocumentLeaveOutcome>>()
let registryOverride: DocumentSessionRegistry | null = null

/** 仅供测试：换成内存替身的会话登记表；传 null 恢复应用唯一的那一个。 */
export function setCameraStageDocumentRegistryForTests(registry: DocumentSessionRegistry | null): void {
  registryOverride = registry
}

/** 本工具用的会话登记表（正式运行是应用唯一的那一个）。 */
export function cameraStageDocumentRegistry(): DocumentSessionRegistry {
  return registryOverride ?? getDocumentSessionRegistry()
}

const documentRegistry = cameraStageDocumentRegistry

export function listCameraStageProjectInstances(): CameraStageProjectInstance[] { return [...instances.values()] }

export function hasActiveCameraStageProjectWork(): boolean {
  return loading.size > 0 || leaving.size > 0 || [...instances.values()].some((instance) => instance.leases > 0)
}

export function findCameraStageProjectInstance(projectId: string): CameraStageProjectInstance | undefined {
  const instance = instances.get(projectId)
  return instance && !instance.session.isEnded ? instance : undefined
}

function contentChanged(state: ReturnType<CameraStageOwnedStore['getState']>, previous: ReturnType<CameraStageOwnedStore['getState']>): boolean {
  return state.objects !== previous.objects || state.stateKeyframes !== previous.stateKeyframes
    || state.sceneSettings !== previous.sceneSettings || state.activeCameraId !== previous.activeCameraId
}

/** 空白场景（新建文档的空内容）补上默认摄像机与第一张状态关键帧；其余内容原样。 */
function initialSnapshot(content: unknown): { snapshot: StageSceneRuntimeSnapshot; filledDefaults: boolean } {
  const snapshot = sceneFromDocumentContent(content)
  if (!isBlankSceneContent(snapshot)) return { snapshot, filledDefaults: false }
  const defaults = createDefaultCameraStageSceneSnapshot()
  return {
    snapshot: {
      objects: defaults.objects,
      activeCameraId: defaults.activeCameraId,
      sceneSettings: defaults.sceneSettings,
      stateKeyframes: defaults.stateKeyframes,
      animation: compileStateKeyframesToAnimation(defaults.stateKeyframes, defaults.objects),
    },
    filledDefaults: true,
  }
}

/** 把一个已打开的文档会话接成实例（同步）：建 store、附着到会话、同步名称、会话结束时自动拆掉。 */
export function bindCameraStageSession(session: DocumentSession): CameraStageProjectInstance {
  assertApplicationWritesAllowed()
  const existing = instances.get(session.id)
  if (existing && existing.session === session && !session.isEnded) return existing
  existing?.dispose()
  const id = session.id
  const { snapshot, filledDefaults } = initialSnapshot(session.getContent())
  const store = createCameraStageStore()
  store.getState().loadSnapshot(snapshot, { id, name: session.documentMeta.name })
  store.temporal.getState().clear()

  const adapter: DocumentContentAdapter<CameraStageSceneContent> = {
    getContent: () => sceneToDocumentContent(store.getState()),
    receiveContent: (content) => {
      // 冲突后“重新载入”、换位置后引用被改写：按新内容重建场景，撤销历史不跨版本
      store.getState().loadSnapshot(sceneFromDocumentContent(content), { id, name: session.documentMeta.name })
      store.temporal.getState().clear()
      notifyApplicationDomainChanged('camera_stage')
    },
    subscribe: (onChange) => store.subscribe((state, previous) => {
      if (!contentChanged(state, previous)) return
      onChange()
      notifyApplicationDomainChanged('camera_stage')
    }),
  }
  const detach = session.attach(adapter as DocumentContentAdapter)
  const instance: CameraStageProjectInstance = {
    id, store, session, leases: 0, idle: new Set(),
    dispose: () => undefined,
  }
  const unsubscribeSession = session.subscribe(() => {
    if (session.isEnded) {
      instance.dispose()
      return
    }
    const name = session.documentMeta.name
    if (store.getState().currentProjectName !== name) {
      store.getState().bindProject(id, name)
      notifyApplicationDomainChanged('camera_stage')
    }
  })
  let disposed = false
  instance.dispose = () => {
    if (disposed) return
    disposed = true
    unsubscribeSession()
    detach()
    if (instances.get(id) === instance) instances.delete(id)
    if (cameraStageStoreAttachment.getStore() === store) attachCameraStageStore(createCameraStageStore())
    for (const listener of instance.idle) listener()
    instance.idle.clear()
    notifyApplicationDomainChanged('camera_stage')
  }
  instances.set(id, instance)
  // 补上的默认摄像机要落盘，ID 才稳定（助手按引用读写）；草稿里只有它时仍算空内容。
  if (filledDefaults) session.markChanged()
  notifyApplicationDomainChanged('camera_stage')
  return instance
}

export function cameraStageProjectStore(projectId: string): CameraStageOwnedStore {
  const instance = findCameraStageProjectInstance(projectId)
  if (!instance) throw new Error('PROJECT_NOT_READY:请先读取原镜头参考')
  return instance.store
}

/** 打开（或复用）文档实例；找不到文档时报 NOT_FOUND。 */
export async function ensureCameraStageProjectRuntime(projectId: string, path?: string): Promise<CameraStageProjectInstance> {
  assertApplicationWritesAllowed()
  const existing = findCameraStageProjectInstance(projectId)
  if (existing) return existing
  if (leaving.has(projectId)) throw new Error('PROJECT_CLOSING')
  let pending = loading.get(projectId)
  if (!pending) {
    const target: DocumentTarget = path ? { id: projectId, path } : { id: projectId }
    pending = (async () => {
      let session: DocumentSession
      try {
        session = await documentRegistry().open(target)
      } catch (error) {
        if (isDocumentServiceError(error, 'DocumentNotFoundError')) throw new Error('NOT_FOUND')
        throw error
      }
      try {
        return bindCameraStageSession(session)
      } catch (error) {
        // 内容读不懂（文件被手工改坏）：不留一个没有实例附着的会话
        logger.warn('镜头参考文档内容无法载入', { event: 'camera_stage.document.bind.failed', error: toError(error), context: { docId: projectId } })
        if (!session.isEnded) await session.discard()
        throw error
      }
    })()
    loading.set(projectId, pending)
  }
  try { return await pending } finally { if (loading.get(projectId) === pending) loading.delete(projectId) }
}

/** 新建镜头参考草稿（以草稿标记立即写进“镜头参考”文件夹）并接成实例。 */
export async function createCameraStageDraftRuntime(container: DocumentContainerRef = { kind: 'user' }): Promise<CameraStageProjectInstance> {
  assertApplicationWritesAllowed()
  const session = await documentRegistry().create({ kind: 'camera_stage', container })
  return bindCameraStageSession(session)
}

export async function attachCameraStageProject(projectId: string, path?: string): Promise<void> {
  const instance = await ensureCameraStageProjectRuntime(projectId, path)
  attachCameraStageStore(instance.store)
}

export async function leaseCameraStageProjectRuntime(projectId: string): Promise<() => void> {
  const instance = await ensureCameraStageProjectRuntime(projectId)
  if (leaving.has(projectId)) throw new Error('PROJECT_CLOSING')
  instance.leases++
  let released = false
  return () => {
    if (released) return
    released = true
    instance.leases--
    if (!instance.leases) for (const listener of instance.idle) listener()
  }
}

export function bindCameraStageProjectOperation<Args extends unknown[], Result>(execute: (...args: Args) => Promise<Result>, projectId: (...args: Args) => string): (...args: Args) => Promise<Result> {
  return async (...args) => {
    const release = await leaseCameraStageProjectRuntime(projectId(...args))
    try { return await execute(...args) } finally { release() }
  }
}

export function readCameraStageProjectInstance(projectId: string): CameraStageProjectSnapshot {
  const instance = findCameraStageProjectInstance(projectId)
  if (!instance) throw new Error('PROJECT_NOT_READY')
  const state = instance.store.getState()
  return {
    id: projectId, name: state.currentProjectName,
    objects: state.objects, activeCameraId: state.activeCameraId, animation: state.animation,
    sceneSettings: state.sceneSettings, stateKeyframes: state.stateKeyframes,
  }
}

/** 保存屏障：写完当前全部修改（会话的 flush）。失败时修改保留在实例里，会话按退避自动重试。 */
export async function saveCameraStageProjectRuntime(projectId: string): Promise<void> {
  const instance = findCameraStageProjectInstance(projectId)
  if (!instance) throw new Error('PROJECT_NOT_READY')
  await instance.session.flush()
}

function waitForIdle(instance: CameraStageProjectInstance): Promise<void> {
  if (!instance.leases) return Promise.resolve()
  return new Promise<void>((resolve) => instance.idle.add(resolve))
}

/**
 * 离开文档（返回列表、切换到另一份文档）：等进行中的后台操作结束，再走通用离开流程
 * （已保存的直接关闭；空草稿删除；有内容的草稿询问“保存 / 不保存 / 取消”）。
 * 除了 cancelled，会话都已结束，实例随之拆掉。失败时抛错，会话与修改保留。
 */
export async function leaveCameraStageProject(projectId: string): Promise<DocumentLeaveOutcome> {
  const instance = findCameraStageProjectInstance(projectId)
  if (!instance) return 'closed'
  const previous = leaving.get(projectId)
  if (previous) return await previous
  const operation = (async () => {
    await waitForIdle(instance)
    const state = instance.store.getState()
    if (state.playback.playing) state.pause()
    instance.store.endHistorySession()
    const outcome = await documentRegistry().leave(projectId)
    if (outcome !== 'cancelled') instance.dispose()
    logger.info('离开镜头参考文档', { event: 'camera_stage.document.leave.completed', context: { docId: projectId, outcome } })
    return outcome
  })()
  leaving.set(projectId, operation)
  try {
    return await operation
  } catch (error) {
    logger.warn('离开镜头参考文档失败，修改已保留', { event: 'camera_stage.document.leave.failed', error: toError(error), context: { docId: projectId } })
    throw error
  } finally {
    if (leaving.get(projectId) === operation) leaving.delete(projectId)
  }
}

/**
 * 释放只为后台读写持有的实例（通用文档操作移到回收站前调用，见 registerDocumentReleaser）：
 * 界面正在显示、有进行中的操作、正在打开或离开时拒绝；其余写完并关闭会话。
 */
export async function releaseCameraStageProjectInstance(projectId: string): Promise<boolean> {
  const instance = instances.get(projectId)
  if (!instance || instance.session.isEnded) return true
  if (instance.leases || loading.has(projectId) || leaving.has(projectId)) return false
  if (cameraStageStoreAttachment.getStore() === instance.store) return false
  await instance.session.close()
  instance.dispose()
  return true
}

/** 仅供测试：拆掉全部实例并结束会话（不写盘）。 */
export async function resetCameraStageProjectInstancesForTests(): Promise<void> {
  const all = [...instances.values()]
  instances.clear()
  loading.clear()
  leaving.clear()
  for (const instance of all) {
    instance.dispose()
    await instance.session.discard()
  }
  attachCameraStageStore(createCameraStageStore())
}
