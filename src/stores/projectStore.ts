import { create } from 'zustand'

import { createLogger } from '@/core/logging'
import type { DocumentContainerRef, DocumentTarget } from '@/core/documents/types'
import type { DocumentLeaveOutcome } from '@/features/documents/documentSessionTypes'
import {
  attachCanvasProject,
  createCanvasDraftInstance,
  findCanvasProjectInstance,
  getCanvasProjectInstance,
  leaveCanvasProject,
  onCanvasProjectInstanceChanged,
  releaseCanvasProjectInstance,
  type CanvasProjectInstance,
} from '@/features/canvas/application/canvasProjectInstances'
import type { Project } from '@/features/canvas/application/canvasDocumentContent'

export type { Project, ProjectSummary } from '@/features/canvas/application/canvasDocumentContent'

/*
 * 画布页的界面状态（3.4 起画布是 `.henji-canvas` 文档）：当前显示哪份画布、正在打开、打开失败与保存失败提示。
 *
 * 画布列表、新建、改名、移动、副本、删除都由通用文档页（DocumentLibraryPage kind="canvas"）与通用文档操作负责；
 * 内容、撤销与保存由画布实例（canvasProjectInstances，接在文档会话上）负责。这里只是界面投影。
 * 历史命名：“Project”指一份画布文档，currentProjectId 即文档 ID。
 */

const logger = createLogger('stores.projectStore')
const PERSISTENCE_FAILED = 'project.persistenceFailed'
const OPEN_FAILED = 'project.openFailed'

interface ProjectState {
  /** 画布页当前显示的画布文档 ID。 */
  currentProjectId: string | null
  /** 当前画布的内存快照（内容变化时刷新）。 */
  currentProject: Project | null
  isOpeningProject: boolean
  openError: string | null
  /** 当前画布的保存失败提示（自动重试中或等待处理冲突）。 */
  persistenceError: string | null
  persistenceErrors: Record<string, string>

  /** 打开并显示一份画布（不等待结果；界面正显示另一份时先走离开流程，取消则留在原画布）。 */
  openProject: (id: string, path?: string) => void
  /** 打开并显示一份画布；离开当前画布被取消时返回 false。 */
  openCanvasDocument: (target: DocumentTarget) => Promise<boolean>
  /** 新建画布草稿并显示；离开当前画布被取消时返回 null。 */
  createCanvasDraft: (container?: DocumentContainerRef) => Promise<string | null>
  /** 离开当前画布（返回列表）：已保存的写完关闭，草稿按“保存 / 不保存 / 取消”处理。 */
  closeProject: () => Promise<DocumentLeaveOutcome>
  clearPersistenceError: () => void
  getCurrentProject: () => Project | null
}

let openRequestSeq = 0

/** 让打开状态先完成一帧呈现，再开始解码和挂载；后台窗口不依赖可能暂停的 RAF。 */
function yieldForProjectLoadingPaint(): Promise<void> {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible'
    || typeof requestAnimationFrame === 'undefined') return Promise.resolve()
  return new Promise((resolve) => {
    let afterFrame: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      clearTimeout(fallback)
      clearTimeout(afterFrame)
      cancelAnimationFrame(frame)
      resolve()
    }
    const fallback = setTimeout(finish, 100)
    const frame = requestAnimationFrame(() => { afterFrame = setTimeout(finish, 0) })
  })
}

function persistenceErrorOf(instance: CanvasProjectInstance): string | null {
  if (instance.session.isEnded) return null
  const status = instance.session.getState().status
  return status === 'failed' || status === 'conflict' ? PERSISTENCE_FAILED : null
}

function show(instance: CanvasProjectInstance): void {
  attachCanvasProject(instance)
  const error = persistenceErrorOf(instance)
  useProjectStore.setState((state) => ({
    currentProjectId: instance.id,
    currentProject: instance.snapshot(),
    isOpeningProject: false,
    openError: null,
    persistenceError: error,
    persistenceErrors: withError(state.persistenceErrors, instance.id, error),
  }))
}

function withError(errors: Record<string, string>, id: string, error: string | null): Record<string, string> {
  if ((errors[id] ?? null) === error) return errors
  const next = { ...errors }
  if (error) next[id] = error
  else delete next[id]
  return next
}

/** 离开当前画布（不动打开请求序号）；没有当前画布时视为已关闭。 */
async function leaveCurrent(keepOpening: boolean): Promise<DocumentLeaveOutcome> {
  const id = useProjectStore.getState().currentProjectId
  if (!id) return 'closed'
  let outcome: DocumentLeaveOutcome
  try {
    outcome = await leaveCanvasProject(id)
  } catch (error) {
    logger.error('离开画布前保存失败，留在画布上', error, { event: 'project.close.failed', context: { projectId: id } })
    useProjectStore.setState((state) => ({ isOpeningProject: false, persistenceError: PERSISTENCE_FAILED,
      persistenceErrors: withError(state.persistenceErrors, id, PERSISTENCE_FAILED) }))
    throw error
  }
  if (outcome === 'cancelled') return outcome
  if (useProjectStore.getState().currentProjectId === id) {
    useProjectStore.setState((state) => ({
      currentProjectId: null,
      currentProject: null,
      ...(keepOpening ? {} : { isOpeningProject: false }),
      openError: null,
      persistenceError: null,
      persistenceErrors: withError(state.persistenceErrors, id, null),
    }))
  }
  return outcome
}

/** 界面正显示另一份画布时先离开它；取消返回 false。 */
async function leaveCurrentFor(nextId: string | null): Promise<boolean> {
  const current = useProjectStore.getState().currentProjectId
  if (!current || current === nextId) return true
  return await leaveCurrent(true) !== 'cancelled'
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProjectId: null,
  currentProject: null,
  isOpeningProject: false,
  openError: null,
  persistenceError: null,
  persistenceErrors: {},

  openProject: (id, path) => {
    void get().openCanvasDocument(path ? { id, path } : { id }).catch(() => undefined)
  },

  openCanvasDocument: async (target) => {
    const seq = ++openRequestSeq
    if (get().currentProjectId === target.id && findCanvasProjectInstance(target.id)) return true
    set({ isOpeningProject: true, openError: null })
    logger.debug('开始打开画布', { event: 'project.open.start', context: { projectId: target.id } })
    let instance: CanvasProjectInstance
    try {
      await yieldForProjectLoadingPaint()
      // 等呈现期间又有新的打开或返回：不再读取
      if (seq !== openRequestSeq) return false
      // 先载入目标：读不懂的画布不会把用户从当前画布里赶出来
      instance = await getCanvasProjectInstance(target.id, target.path)
    } catch (error) {
      if (seq === openRequestSeq) {
        logger.error('画布无法打开，保留当前画布与原文件', error, { event: 'project.open.failed', context: { projectId: target.id } })
        set({ isOpeningProject: false, openError: OPEN_FAILED })
      }
      throw error
    }
    // 载入期间又有新的打开或返回：这次打开作废，不去动当前画布；刚载入的没人用就放掉
    if (seq !== openRequestSeq) {
      if (get().currentProjectId !== target.id) void releaseCanvasProjectInstance(target.id).catch(() => undefined)
      return false
    }
    if (!await leaveCurrentFor(target.id)) {
      // 用户取消离开当前画布：留在原处，刚载入的目标没人用就放掉
      void releaseCanvasProjectInstance(target.id).catch(() => undefined)
      if (seq === openRequestSeq) set({ isOpeningProject: false })
      return false
    }
    if (seq !== openRequestSeq) return true
    show(instance)
    logger.debug('完成打开画布', { event: 'project.open.completed', context: { projectId: target.id } })
    return true
  },

  createCanvasDraft: async (container) => {
    const seq = ++openRequestSeq
    set({ isOpeningProject: true, openError: null })
    try {
      if (!await leaveCurrentFor(null)) {
        if (seq === openRequestSeq) set({ isOpeningProject: false })
        return null
      }
      const instance = await createCanvasDraftInstance(container)
      if (seq === openRequestSeq) show(instance)
      return instance.id
    } catch (error) {
      if (seq === openRequestSeq) {
        logger.error('新建画布失败', error, { event: 'project.create.failed' })
        set({ isOpeningProject: false, openError: PERSISTENCE_FAILED })
      }
      throw error
    }
  },

  closeProject: async () => {
    // 取消还没完成的打开请求（打开中点“返回”）
    openRequestSeq += 1
    if (!get().currentProjectId) {
      set({ isOpeningProject: false, openError: null })
      return 'closed'
    }
    return await leaveCurrent(false)
  },

  clearPersistenceError: () => set({ persistenceError: null }),

  getCurrentProject: () => {
    const { currentProjectId, currentProject } = get()
    if (!currentProjectId || !currentProject || currentProject.id !== currentProjectId) return null
    return currentProject
  },
}))

// 实例内容、名称、保存状态变化：刷新当前画布投影与保存错误（后台画布只记错误）
onCanvasProjectInstanceChanged((instance) => {
  const ended = instance.session.isEnded
  const error = ended ? null : persistenceErrorOf(instance)
  useProjectStore.setState((state) => {
    const isCurrent = state.currentProjectId === instance.id
    // 正在显示的画布的会话结束了（离开、被释放）：界面回到列表
    if (isCurrent && ended) {
      return { currentProjectId: null, currentProject: null, persistenceError: null,
        persistenceErrors: withError(state.persistenceErrors, instance.id, null) }
    }
    return {
      persistenceErrors: withError(state.persistenceErrors, instance.id, error),
      ...(isCurrent ? { persistenceError: error, currentProject: instance.snapshot() } : {}),
    }
  })
})
