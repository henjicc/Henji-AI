import { createStore, type StoreApi } from 'zustand/vanilla'
import { createLogger } from '@/core/logging'
import { attachCameraStageStore, cameraStageStoreAttachment, createCameraStageStore, type CameraStageOwnedStore } from '../store/cameraStageStore'
import { readProjectSnapshot, writeCameraStageProject, type CameraStageProjectSnapshot } from '../projects/cameraStageProjectPersistence'
import { serializeScene } from '../domain/sceneSerialization'

export type CameraStageSaveState = 'idle' | 'saving' | 'saved' | 'error'
export interface CameraStageProjectInstance {
  id: string
  store: CameraStageOwnedStore
  createdAt: number
  updatedAt: number
  revision: number
  dirty: boolean
  leases: number
  closing: boolean
  status: StoreApi<{ state: CameraStageSaveState; error: string | null }>
  timer: ReturnType<typeof setTimeout> | null
  saving: Promise<void> | null
  unsubscribe: () => void
  idle: Set<() => void>
}

const logger = createLogger('cameraStage.projectInstances')
const instances = new Map<string, CameraStageProjectInstance>()
const loading = new Map<string, Promise<void>>()
const closing = new Map<string, Promise<void>>()

export function findCameraStageProjectInstance(projectId: string): CameraStageProjectInstance | undefined {
  return instances.get(projectId)
}

export function registerCameraStageProjectInstance(snapshot: CameraStageProjectSnapshot): CameraStageProjectInstance {
  const previous = instances.get(snapshot.id)
  if (previous) return previous
  const store = createCameraStageStore()
  store.getState().loadSnapshot(snapshot, { id: snapshot.id, name: snapshot.name })
  store.temporal.getState().clear()
  const instance: CameraStageProjectInstance = {
    id: snapshot.id, store, createdAt: snapshot.createdAt, updatedAt: snapshot.updatedAt,
    revision: 0, dirty: false, leases: 0, closing: false, timer: null, saving: null,
    status: createStore(() => ({ state: 'idle' as CameraStageSaveState, error: null as string | null })),
    unsubscribe: () => undefined, idle: new Set(),
  }
  instance.unsubscribe = store.subscribe((state, previousState) => {
    if (state.objects === previousState.objects && state.stateKeyframes === previousState.stateKeyframes
      && state.sceneSettings === previousState.sceneSettings && state.activeCameraId === previousState.activeCameraId
      && state.currentProjectName === previousState.currentProjectName) return
    instance.dirty = true
    instance.revision++
    if (instance.timer) clearTimeout(instance.timer)
    if (!instance.closing) instance.timer = setTimeout(() => {
      instance.timer = null
      void saveCameraStageProjectRuntime(instance.id).catch(() => { /* 保存入口已记录错误，脏实例保留供恢复。 */ })
    }, 700)
  })
  instances.set(snapshot.id, instance)
  return instance
}

export function cameraStageProjectStore(projectId: string): CameraStageOwnedStore {
  const instance = instances.get(projectId)
  if (!instance) throw new Error('PROJECT_NOT_READY:请先读取原三维工程')
  return instance.store
}

export async function ensureCameraStageProjectRuntime(projectId: string): Promise<void> {
  if (instances.has(projectId)) return
  if (closing.has(projectId)) throw new Error('PROJECT_CLOSING')
  let pending = loading.get(projectId)
  if (!pending) {
    pending = (async () => {
      const snapshot = await readProjectSnapshot(projectId)
      if (!snapshot) throw new Error('NOT_FOUND')
      registerCameraStageProjectInstance(snapshot)
    })()
    loading.set(projectId, pending)
  }
  try { await pending } finally { if (loading.get(projectId) === pending) loading.delete(projectId) }
}

export async function attachCameraStageProject(projectId: string): Promise<void> {
  await ensureCameraStageProjectRuntime(projectId)
  const instance = instances.get(projectId)!
  if (instance.closing) throw new Error('PROJECT_CLOSING')
  attachCameraStageStore(instance.store)
}

export async function leaseCameraStageProjectRuntime(projectId: string): Promise<() => void> {
  if (!instances.has(projectId)) await ensureCameraStageProjectRuntime(projectId)
  const instance = instances.get(projectId)!
  if (instance.closing || closing.has(projectId)) throw new Error('PROJECT_CLOSING')
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
  const instance = instances.get(projectId)
  if (!instance) throw new Error('PROJECT_NOT_READY')
  const state = instance.store.getState()
  return {
    id: projectId, name: state.currentProjectName, createdAt: instance.createdAt, updatedAt: instance.updatedAt,
    objects: state.objects, activeCameraId: state.activeCameraId, animation: state.animation,
    sceneSettings: state.sceneSettings, stateKeyframes: state.stateKeyframes,
  }
}

export async function saveCameraStageProjectRuntime(projectId: string): Promise<void> {
  const instance = instances.get(projectId)
  if (!instance) throw new Error('PROJECT_NOT_READY')
  if (instance.timer) { clearTimeout(instance.timer); instance.timer = null }
  if (instance.saving) return instance.saving
  if (!instance.dirty) return
  const saving = (async () => {
    instance.status.setState({ state: 'saving', error: null })
    try {
      while (instance.dirty) {
        const revision = instance.revision
        const state = instance.store.getState()
        const updatedAt = Math.max(Date.now(), instance.updatedAt + 1)
        await writeCameraStageProject({ id: projectId, name: state.currentProjectName, sceneJson: serializeScene(state),
          objectCount: state.objects.length, createdAt: instance.createdAt, updatedAt })
        instance.updatedAt = updatedAt
        if (revision === instance.revision) instance.dirty = false
      }
      instance.status.setState({ state: 'saved', error: null })
    } catch (error) {
      instance.status.setState({ state: 'error', error: error instanceof Error ? error.message : String(error) })
      logger.error('三维工程保存失败，保留未保存内容', error, { event: 'camera_stage.project.save.failed', projectId })
      throw error
    }
  })()
  instance.saving = saving
  try { await saving } finally { if (instance.saving === saving) instance.saving = null }
}

export async function closeCameraStageProjectInstance(projectId: string, remove: () => Promise<void>): Promise<void> {
  const previous = closing.get(projectId)
  if (previous) return previous
  const instance = instances.get(projectId)
  if (instance) instance.closing = true
  const operation = (async () => {
    await loading.get(projectId)
    const current = instances.get(projectId)
    if (current) {
      current.closing = true
      if (current.leases) await new Promise<void>(resolve => current.idle.add(resolve))
      await saveCameraStageProjectRuntime(projectId)
    }
    await remove()
    if (current) {
      if (cameraStageStoreAttachment.getStore() === current.store) attachCameraStageStore(createCameraStageStore())
      current.unsubscribe()
      if (current.timer) clearTimeout(current.timer)
      instances.delete(projectId)
    }
  })()
  closing.set(projectId, operation)
  try { await operation } finally {
    closing.delete(projectId)
    const current = instances.get(projectId)
    if (current) { current.closing = false; current.idle.clear() }
  }
}

export function releaseCameraStageProjectInstance(projectId: string): boolean {
  const instance = instances.get(projectId)
  if (!instance) return true
  if (instance.dirty || instance.leases || instance.saving || instance.closing || cameraStageStoreAttachment.getStore() === instance.store) return false
  instance.unsubscribe()
  if (instance.timer) clearTimeout(instance.timer)
  instances.delete(projectId)
  return true
}

export function resetCameraStageProjectInstancesForTests(): void {
  for (const instance of instances.values()) { instance.unsubscribe(); if (instance.timer) clearTimeout(instance.timer) }
  instances.clear()
  loading.clear()
  closing.clear()
  attachCameraStageStore(createCameraStageStore())
}
