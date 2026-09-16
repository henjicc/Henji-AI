import { canvasStoreAttachment, createCanvasStore } from '@/stores/canvasStore'
import { fromProjectRecord, type Project } from '@/stores/projectStoreSerialization'
import { getProjectRecord } from '@/commands/projectState'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'

export interface CanvasProjectInstance {
  readonly id: string
  readonly store: ReturnType<typeof createCanvasStore>
  revision: number
  dirty: boolean
  leases: number
  closing: boolean
  snapshot(): Project
  updateMetadata(patch: Partial<Pick<Project, 'name' | 'coverPath'>>): void
  markSaved(snapshot: Project): void
  dispose(): void
}

const instances = new Map<string, CanvasProjectInstance>()
const loading = new Map<string, Promise<CanvasProjectInstance>>()
const closing = new Set<string>()
const idleListeners = new Map<string, Set<() => void>>()
let onChange: (project: Project) => void = () => undefined

export function configureCanvasInstancePersistence(listener: (project: Project) => void): void { onChange = listener }
export function findCanvasProjectInstance(id: string): CanvasProjectInstance | undefined { return instances.get(id) }
export function listCanvasProjectInstances(): CanvasProjectInstance[] { return [...instances.values()] }
export function hasActiveCanvasProjectWork(): boolean {
  return loading.size > 0 || closing.size > 0 || [...instances.values()].some((instance) => instance.leases > 0)
}
export function requireCanvasProjectInstance(id: string): CanvasProjectInstance {
  const instance = instances.get(id)
  if (!instance) throw new Error('PROJECT_NOT_LOADED')
  return instance
}

export function registerCanvasProjectInstance(project: Project): CanvasProjectInstance {
  assertApplicationWritesAllowed()
  const existing = instances.get(project.id)
  if (existing) return existing
  if (closing.has(project.id)) throw new Error('PROJECT_CLOSING')
  const store = createCanvasStore()
  store.getState().setCanvasData(project.nodes, project.edges, project.history)
  store.getState().setViewportState(project.viewport)
  let metadata = project
  const snapshot = (): Project => {
    const state = store.getState()
    return { ...metadata, nodes: state.nodes, edges: state.edges, history: state.history,
      viewport: state.currentViewport, nodeCount: state.nodes.length }
  }
  const changed = () => {
    instance.dirty = true
    metadata = { ...metadata, updatedAt: Math.max(Date.now(), metadata.updatedAt + 1) }
    instance.revision = metadata.updatedAt
    onChange(snapshot())
  }
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.nodes !== previous.nodes || state.edges !== previous.edges || state.history !== previous.history
      || state.currentViewport !== previous.currentViewport) changed()
  })
  const instance: CanvasProjectInstance = {
    id: project.id, store, revision: project.updatedAt, dirty: false, leases: 0, closing: false, snapshot,
    updateMetadata(patch) { metadata = { ...metadata, ...patch }; changed() },
    markSaved(saved) {
      const current = snapshot()
      if (saved.nodes === current.nodes && saved.edges === current.edges && saved.history === current.history
        && saved.viewport === current.viewport && saved.updatedAt === current.updatedAt) instance.dirty = false
    },
    dispose: unsubscribe,
  }
  instances.set(project.id, instance)
  return instance
}

export async function getCanvasProjectInstance(id: string): Promise<CanvasProjectInstance> {
  assertApplicationWritesAllowed()
  if (closing.has(id)) throw new Error('PROJECT_CLOSING')
  const existing = instances.get(id)
  if (existing) return existing
  let pending = loading.get(id)
  if (!pending) {
    pending = (async () => {
      const record = await getProjectRecord(id)
      if (!record) throw new Error('PROJECT_NOT_FOUND')
      return registerCanvasProjectInstance(fromProjectRecord(record))
    })()
    loading.set(id, pending)
  }
  try { return await pending }
  finally { if (loading.get(id) === pending) loading.delete(id) }
}

export function attachCanvasProject(instance: CanvasProjectInstance): void {
  if (instance.closing) throw new Error('PROJECT_CLOSING')
  canvasStoreAttachment.attach(instance.store)
}

export function detachCanvasProject(): void { canvasStoreAttachment.attach(createCanvasStore()) }

export function leaseCanvasProject(instance: CanvasProjectInstance): () => void {
  assertApplicationWritesAllowed()
  if (instance.closing || closing.has(instance.id)) throw new Error('PROJECT_CLOSING')
  instance.leases += 1
  let released = false
  return () => {
    if (released) return
    released = true
    instance.leases -= 1
    if (!instance.leases) for (const listener of idleListeners.get(instance.id) ?? []) listener()
  }
}

/** Deletion blocks new work and waits for already submitted work before touching storage. */
export async function closeCanvasProjectInstance(id: string, remove: () => Promise<void>): Promise<void> {
  assertApplicationWritesAllowed()
  if (closing.has(id)) throw new Error('PROJECT_CLOSING')
  closing.add(id)
  const instance = instances.get(id)
  if (instance) instance.closing = true
  try {
    await loading.get(id)?.catch(() => undefined)
    if (instance?.leases) await new Promise<void>(resolve => {
      const listeners = idleListeners.get(id) ?? new Set()
      listeners.add(resolve); idleListeners.set(id, listeners)
    })
    await remove()
    instance?.dispose()
    instances.delete(id)
  } finally {
    if (instance) instance.closing = false
    closing.delete(id)
    idleListeners.delete(id)
  }
}

export function releaseCanvasProjectInstance(id: string): boolean {
  const instance = instances.get(id)
  if (!instance) return true
  if (instance.dirty || instance.leases || instance.closing || canvasStoreAttachment.getStore() === instance.store) return false
  instance.dispose(); instances.delete(id)
  return true
}

export function resetCanvasProjectInstancesForTests(): void {
  for (const instance of instances.values()) instance.dispose()
  instances.clear()
  loading.clear()
  closing.clear()
  idleListeners.clear()
  detachCanvasProject()
}
