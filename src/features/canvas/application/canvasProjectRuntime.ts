import { findCanvasProjectInstance, getCanvasProjectInstance, leaseCanvasProject } from './canvasProjectInstances'
import { CanvasPersistenceError, type CanvasTransactionRuntime } from './canvasPersistenceService'

/** The lease protects ownership; transaction checkpoints arbitrate edits without holding a network lock. */
export async function withCanvasProjectRuntime<T>(projectId: string, execute: (runtime: CanvasTransactionRuntime) => Promise<T>): Promise<T> {
  const owned = await acquireCanvasProjectRuntime(projectId)
  try { return await execute(owned.runtime) } finally { owned.release() }
}

export async function acquireCanvasProjectRuntime(projectId: string): Promise<{ runtime: CanvasTransactionRuntime; release: () => void }> {
  const instance = findCanvasProjectInstance(projectId) ?? await getCanvasProjectInstance(projectId)
  const release = leaseCanvasProject(instance)
  return {
    release,
    runtime: {
      store: instance.store,
      isCurrent: () => findCanvasProjectInstance(projectId) === instance,
      pause: () => instance.pausePersistence(),
      // 后台操作与界面编辑共用同一个文档会话：保存确认 = 会话写完当前全部修改
      persist: async () => {
        try { await instance.session.flush() }
        catch (error) { throw new CanvasPersistenceError(projectId, error) }
      },
    },
  }
}
