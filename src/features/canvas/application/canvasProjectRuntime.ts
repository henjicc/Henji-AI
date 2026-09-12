import { createCanvasStore, useCanvasStore } from '@/stores/canvasStore'
import { holdCanvasProjectBackgroundExecution, pauseCanvasProjectPersistence, persistBackgroundCanvasProject, readUnconfirmedCanvasProject, useProjectStore } from '@/stores/projectStore'
import { readCanvasProjectSnapshot } from './canvasQueryService'
import { CanvasPersistenceError, confirmCanvasPersistence, type CanvasTransactionRuntime } from './canvasPersistenceService'

const operations = new Map<string, Promise<unknown>>()

/** 原工程内串行执行；当前编辑实例不替换，其他工程使用同一 store actions 的独立实例。 */
export async function withCanvasProjectRuntime<T>(projectId: string, execute: (runtime: CanvasTransactionRuntime) => Promise<T>): Promise<T> {
  const previous = operations.get(projectId) ?? Promise.resolve()
  const operation = previous.catch(() => undefined).then(async () => {
    const release = holdCanvasProjectBackgroundExecution(projectId)
    try {
    const project = readUnconfirmedCanvasProject(projectId) ?? await readCanvasProjectSnapshot(projectId)
    const active = useProjectStore.getState().currentProjectId === projectId
    const store = active ? useCanvasStore : createCanvasStore()
    if (!active) store.getState().setCanvasData(project.nodes, project.edges, project.history)
    const isCurrent = (): boolean => active
      ? useProjectStore.getState().currentProjectId === projectId
      : useProjectStore.getState().currentProjectId !== projectId
    const runtime: CanvasTransactionRuntime = {
      store,
      isCurrent,
      pause: () => pauseCanvasProjectPersistence(projectId),
      persist: async () => {
        if (active) { await confirmCanvasPersistence(projectId); return }
        const state = store.getState()
        try {
          await persistBackgroundCanvasProject({ ...project, nodes: state.nodes, edges: state.edges,
            history: state.history, nodeCount: state.nodes.length, updatedAt: Date.now() })
        } catch (error) { throw new CanvasPersistenceError(projectId, error) }
      },
    }
    return await execute(runtime)
    } finally { release() }
  })
  operations.set(projectId, operation)
  try { return await operation }
  finally { if (operations.get(projectId) === operation) operations.delete(projectId) }
}
