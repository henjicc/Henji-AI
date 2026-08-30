import { GenerationService } from '@/core/services/GenerationService'

const activeTaskIds = new Set<string>()
const resumeTaskLeasesByProject = new Map<string, Map<string, symbol>>()

function normalizeLeaseIdentity(value: string): string {
  return value.trim()
}

export function markCanvasGenerationTaskActive(taskId: string): void {
  if (taskId.trim()) activeTaskIds.add(taskId)
}

export function releaseCanvasGenerationTaskActive(taskId: string): void {
  activeTaskIds.delete(taskId)
}

export function isCanvasGenerationTaskActive(taskId: string): boolean {
  return activeTaskIds.has(taskId)
}

/**
 * 为恢复续查获取跨组件实例的独占租约。
 *
 * 租约故意不随 hook 卸载释放：卸载不会取消已经发出的轮询，后续挂载必须继续等待
 * 原持有者结束，避免同一项目的同一任务被重复续查和重复落图。
 */
export function acquireCanvasGenerationResumeLease(
  projectId: string,
  taskId: string,
): symbol | null {
  const normalizedProjectId = normalizeLeaseIdentity(projectId)
  const normalizedTaskId = normalizeLeaseIdentity(taskId)
  if (!normalizedProjectId || !normalizedTaskId) return null

  const projectLeases = resumeTaskLeasesByProject.get(normalizedProjectId) ?? new Map<string, symbol>()
  if (projectLeases.has(normalizedTaskId)) return null

  const lease = Symbol(`${normalizedProjectId}:${normalizedTaskId}`)
  projectLeases.set(normalizedTaskId, lease)
  resumeTaskLeasesByProject.set(normalizedProjectId, projectLeases)
  return lease
}

export function isCanvasGenerationResumeLeaseCurrent(
  projectId: string,
  taskId: string,
  lease: symbol,
): boolean {
  const normalizedProjectId = normalizeLeaseIdentity(projectId)
  const normalizedTaskId = normalizeLeaseIdentity(taskId)
  return resumeTaskLeasesByProject.get(normalizedProjectId)?.get(normalizedTaskId) === lease
}

export function releaseCanvasGenerationResumeLease(
  projectId: string,
  taskId: string,
  lease: symbol,
): void {
  const normalizedProjectId = normalizeLeaseIdentity(projectId)
  const normalizedTaskId = normalizeLeaseIdentity(taskId)
  const projectLeases = resumeTaskLeasesByProject.get(normalizedProjectId)
  if (projectLeases?.get(normalizedTaskId) !== lease) return

  projectLeases.delete(normalizedTaskId)
  if (projectLeases.size === 0) resumeTaskLeasesByProject.delete(normalizedProjectId)
}

/** 项目切换会让旧回调失去写入资格，并允许用户返回后重新接管任务。 */
export function releaseCanvasGenerationResumeLeasesForProject(projectId: string): void {
  const normalizedProjectId = normalizeLeaseIdentity(projectId)
  if (normalizedProjectId) resumeTaskLeasesByProject.delete(normalizedProjectId)
}

/** 统一管理运行中任务的持久化、项目切换取消与恢复续查互斥。 */
export function createCanvasGenerationTaskLifecycle(
  isContextCurrent: () => boolean,
  persistTask: (taskId: string) => void,
) {
  let latestTaskId: string | null = null
  const ownedTaskIds = new Set<string>()
  return {
    onTaskId: (taskId: string): void => {
      latestTaskId = taskId
      if (!isContextCurrent()) {
        void GenerationService.getInstance().cancelTask(taskId).catch(() => undefined)
        return
      }
      markCanvasGenerationTaskActive(taskId)
      ownedTaskIds.add(taskId)
      persistTask(taskId)
    },
    cancelLatest: async (): Promise<void> => {
      if (!latestTaskId) return
      await GenerationService.getInstance().cancelTask(latestTaskId).catch(() => undefined)
    },
    release: (): void => {
      ownedTaskIds.forEach(releaseCanvasGenerationTaskActive)
      ownedTaskIds.clear()
    },
  }
}

/** 仅供隔离测试状态，生产代码不应批量清空正在执行的任务。 */
export function clearActiveCanvasGenerationTasksForTest(): void {
  activeTaskIds.clear()
  resumeTaskLeasesByProject.clear()
}
