interface ProjectPersistenceQueueOptions<TProject> {
  getProjectId: (project: TProject) => string
  upsertProject: (project: TProject) => Promise<void>
  updateViewport: (projectId: string, viewportJson: string) => Promise<void>
  deleteProject: (projectId: string) => Promise<void>
  onBackgroundError: (operation: 'save' | 'viewport', error: unknown) => void
}

interface QueueOptions {
  immediate?: boolean
  debounceMs?: number
}

export interface ProjectPersistenceQueue<TProject> {
  queueProject: (project: TProject, options?: QueueOptions) => void
  flushProject: (project: TProject) => Promise<void>
  queueViewport: (projectId: string, viewportJson: string, options?: QueueOptions) => void
  clearViewport: (projectId: string) => void
  deleteProject: (projectId: string) => Promise<void>
}

const PROJECT_DEBOUNCE_MS = 260
const VIEWPORT_DEBOUNCE_MS = 280
const IDLE_TIMEOUT_MS = 1200
const FALLBACK_IDLE_DELAY_MS = 64

function scheduleIdle(task: () => void): void {
  const host = globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  }
  if (typeof host.requestIdleCallback === 'function') {
    host.requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS })
    return
  }
  setTimeout(task, FALLBACK_IDLE_DELAY_MS)
}

/**
 * 画布项目写入协调器。
 *
 * 自动保存可以合并，但显式的新建、改名、关闭和删除必须能等待 SQLite 的真实结果。
 * 所有同项目写入在这里串行化，避免“旧的自动保存晚到，覆盖刚完成的改名/关闭”。
 */
export function createProjectPersistenceQueue<TProject>(
  options: ProjectPersistenceQueueOptions<TProject>
): ProjectPersistenceQueue<TProject> {
  const queuedProjects = new Map<string, TProject>()
  const projectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const projectInFlight = new Map<string, Promise<void>>()
  const queuedViewports = new Map<string, string>()
  const viewportTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const viewportInFlight = new Map<string, Promise<void>>()
  const deleting = new Set<string>()
  const flushing = new Set<string>()

  const clearProject = (projectId: string): void => {
    const timer = projectTimers.get(projectId)
    if (timer) clearTimeout(timer)
    projectTimers.delete(projectId)
    queuedProjects.delete(projectId)
  }

  const clearViewport = (projectId: string): void => {
    const timer = viewportTimers.get(projectId)
    if (timer) clearTimeout(timer)
    viewportTimers.delete(projectId)
    queuedViewports.delete(projectId)
  }

  const startProjectWrite = (projectId: string): void => {
    if (deleting.has(projectId) || flushing.has(projectId) || projectInFlight.has(projectId)) return
    const project = queuedProjects.get(projectId)
    if (!project) return
    queuedProjects.delete(projectId)

    const write = options.upsertProject(project)
      .catch((error) => { options.onBackgroundError('save', error) })
      .finally(() => {
        projectInFlight.delete(projectId)
        if (!deleting.has(projectId) && !flushing.has(projectId) && queuedProjects.has(projectId)) {
          startProjectWrite(projectId)
        }
      })
    projectInFlight.set(projectId, write)
  }

  const startViewportWrite = (projectId: string): void => {
    if (deleting.has(projectId) || flushing.has(projectId) || viewportInFlight.has(projectId)) return
    const viewportJson = queuedViewports.get(projectId)
    if (viewportJson === undefined) return
    queuedViewports.delete(projectId)

    const write = options.updateViewport(projectId, viewportJson)
      .catch((error) => { options.onBackgroundError('viewport', error) })
      .finally(() => {
        viewportInFlight.delete(projectId)
        if (!deleting.has(projectId) && queuedViewports.has(projectId)) startViewportWrite(projectId)
      })
    viewportInFlight.set(projectId, write)
  }

  const queueProject = (project: TProject, queueOptions?: QueueOptions): void => {
    const projectId = options.getProjectId(project)
    deleting.delete(projectId)
    queuedProjects.set(projectId, project)
    const timer = projectTimers.get(projectId)
    if (timer) clearTimeout(timer)
    projectTimers.delete(projectId)

    const delay = queueOptions?.immediate ? 0 : (queueOptions?.debounceMs ?? PROJECT_DEBOUNCE_MS)
    if (delay <= 0) {
      startProjectWrite(projectId)
      return
    }
    projectTimers.set(projectId, setTimeout(() => {
      projectTimers.delete(projectId)
      scheduleIdle(() => startProjectWrite(projectId))
    }, delay))
  }

  const flushProject = async (project: TProject): Promise<void> => {
    const projectId = options.getProjectId(project)
    deleting.delete(projectId)
    flushing.add(projectId)
    clearProject(projectId)
    clearViewport(projectId)
    try {
      await Promise.all([projectInFlight.get(projectId), viewportInFlight.get(projectId)])

      const write = async (snapshot: TProject): Promise<void> => {
        const pending = options.upsertProject(snapshot)
        projectInFlight.set(projectId, pending)
        try {
          await pending
        } finally {
          if (projectInFlight.get(projectId) === pending) projectInFlight.delete(projectId)
        }
      }

      await write(project)
      // flush 期间产生的是更晚的用户编辑，必须排在显式快照之后继续写，不能静默丢弃。
      while (queuedProjects.has(projectId)) {
        const latest = queuedProjects.get(projectId)
        clearProject(projectId)
        if (latest) await write(latest)
      }
    } finally {
      flushing.delete(projectId)
      if (!deleting.has(projectId) && queuedProjects.has(projectId)) startProjectWrite(projectId)
      if (!deleting.has(projectId) && queuedViewports.has(projectId)) startViewportWrite(projectId)
    }
  }

  const queueViewport = (projectId: string, viewportJson: string, queueOptions?: QueueOptions): void => {
    deleting.delete(projectId)
    queuedViewports.set(projectId, viewportJson)
    const timer = viewportTimers.get(projectId)
    if (timer) clearTimeout(timer)
    viewportTimers.delete(projectId)

    const delay = queueOptions?.immediate ? 0 : (queueOptions?.debounceMs ?? VIEWPORT_DEBOUNCE_MS)
    if (delay <= 0) {
      startViewportWrite(projectId)
      return
    }
    viewportTimers.set(projectId, setTimeout(() => {
      viewportTimers.delete(projectId)
      startViewportWrite(projectId)
    }, delay))
  }

  const deleteProject = async (projectId: string): Promise<void> => {
    deleting.add(projectId)
    clearProject(projectId)
    clearViewport(projectId)
    try {
      await Promise.all([projectInFlight.get(projectId), viewportInFlight.get(projectId)])
      await options.deleteProject(projectId)
    } finally {
      deleting.delete(projectId)
    }
  }

  return { queueProject, flushProject, queueViewport, clearViewport, deleteProject }
}
