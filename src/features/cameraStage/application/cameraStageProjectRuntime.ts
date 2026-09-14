import { createCameraStageStore, useCameraStageStore } from '../store/cameraStageStore'
import { readProjectSnapshot, saveCurrentProject, saveProjectDraft } from '../projects/cameraStageProjectService'
import { serializeScene } from '../domain/sceneSerialization'
import { holdCameraStageProjectExecution } from './cameraStageProjectExecution'

type ProjectStore = typeof useCameraStageStore
interface Runtime { store: ProjectStore; updatedAt: number; dirty: boolean; unsubscribe: () => void }
const backgroundProjects = new Map<string, Runtime>()
const leases = new Map<string, { store: ProjectStore; count: number; release: () => void }>()

/** 当前工程始终使用真实编辑实例，后台工程复用同一 actions 工厂。 */
export function cameraStageProjectStore(projectId: string): ProjectStore {
  const leased = leases.get(projectId)
  if (leased) {
    const activeId = useCameraStageStore.getState().currentProjectId
    if ((leased.store === useCameraStageStore && activeId !== projectId)
      || (leased.store !== useCameraStageStore && activeId === projectId)) {
      throw new Error('PROJECT_SESSION_CHANGED:原三维执行实例已被界面接管，请核对原工程；未保存内容仍保留。')
    }
    return leased.store
  }
  if (useCameraStageStore.getState().currentProjectId === projectId && backgroundProjects.get(projectId)?.dirty) {
    throw new Error('PROJECT_RECOVERY_REQUIRED:原后台工程还有未保存内容，不能用新界面快照覆盖。')
  }
  if (useCameraStageStore.getState().currentProjectId === projectId) return useCameraStageStore
  const runtime = backgroundProjects.get(projectId)
  if (!runtime) throw new Error('PROJECT_NOT_READY:请先读取原三维工程')
  return runtime.store
}

export async function ensureCameraStageProjectRuntime(projectId: string): Promise<void> {
  if (leases.has(projectId)) { cameraStageProjectStore(projectId); return }
  if (useCameraStageStore.getState().currentProjectId === projectId) { cameraStageProjectStore(projectId); return }
  const snapshot = await readProjectSnapshot(projectId)
  if (!snapshot) throw new Error('NOT_FOUND')
  const previous = backgroundProjects.get(projectId)
  if (previous && (previous.dirty || previous.updatedAt === snapshot.updatedAt)) return
  previous?.unsubscribe()
  const store = createCameraStageStore(true)
  store.getState().loadSnapshot(snapshot, { id: snapshot.id, name: snapshot.name })
  const runtime: Runtime = { store, updatedAt: snapshot.updatedAt, dirty: false, unsubscribe: () => undefined }
  runtime.unsubscribe = store.subscribe(() => { runtime.dirty = true })
  backgroundProjects.set(projectId, runtime)
  // 只释放已保存且非本次目标的实例；失败内存不能靠缓存清理丢弃。
  for (const [id, candidate] of backgroundProjects) {
    if (backgroundProjects.size <= 32) break
    if (id !== projectId && !candidate.dirty) { candidate.unsubscribe(); backgroundProjects.delete(id) }
  }
}

export async function leaseCameraStageProjectRuntime(projectId: string): Promise<() => void> {
  await ensureCameraStageProjectRuntime(projectId)
  const current = leases.get(projectId) ?? { store: cameraStageProjectStore(projectId), count: 0, release: holdCameraStageProjectExecution(projectId) }
  current.count++
  leases.set(projectId, current)
  return () => { if (--current.count === 0) { leases.delete(projectId); current.release() } }
}

export function bindCameraStageProjectOperation<Args extends unknown[], Result>(execute: (...args: Args) => Promise<Result>, projectId: (...args: Args) => string): (...args: Args) => Promise<Result> {
  return async (...args) => {
    const release = await leaseCameraStageProjectRuntime(projectId(...args))
    try { return await execute(...args) } finally { release() }
  }
}

export async function saveCameraStageProjectRuntime(projectId: string): Promise<void> {
  const store = cameraStageProjectStore(projectId)
  if (store === useCameraStageStore) { await saveCurrentProject(); cameraStageProjectStore(projectId); return }
  const state = store.getState()
  const now = Date.now()
  const sceneJson = serializeScene(state)
  await saveProjectDraft({ id: projectId, name: state.currentProjectName, fingerprint: `${projectId}\u0000${state.currentProjectName}\u0000${sceneJson}`,
    record: { id: projectId, name: state.currentProjectName, sceneJson, objectCount: state.objects.length, createdAt: now, updatedAt: now } }, false)
  const runtime = backgroundProjects.get(projectId)
  if (runtime && store.getState() === state) { runtime.dirty = false; runtime.updatedAt = now }
  cameraStageProjectStore(projectId)
}
