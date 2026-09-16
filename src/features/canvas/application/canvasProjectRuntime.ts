import { pauseCanvasProjectPersistence, persistBackgroundCanvasProject } from '@/stores/projectStore'
import { findCanvasProjectInstance, getCanvasProjectInstance, leaseCanvasProject } from './canvasProjectInstances'
import { CanvasPersistenceError, type CanvasTransactionRuntime } from './canvasPersistenceService'

/** The lease protects ownership; transaction checkpoints arbitrate edits without holding a network lock. */
export async function withCanvasProjectRuntime<T>(projectId: string, execute: (runtime: CanvasTransactionRuntime) => Promise<T>): Promise<T> {
  const instance = findCanvasProjectInstance(projectId) ?? await getCanvasProjectInstance(projectId)
  const release = leaseCanvasProject(instance)
  try {
    return await execute({
      store: instance.store,
      isCurrent: () => findCanvasProjectInstance(projectId) === instance,
      pause: () => pauseCanvasProjectPersistence(projectId),
      persist: async () => {
        try { await persistBackgroundCanvasProject(instance.snapshot()) }
        catch (error) { throw new CanvasPersistenceError(projectId, error) }
      },
    })
  } finally { release() }
}
