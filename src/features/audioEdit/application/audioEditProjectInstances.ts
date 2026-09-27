import { assertAudioEditLocks } from '@/core/audioEdit/edits'
import { audioEditProjectSchema } from '@/core/audioEdit/schema'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { ApplicationPersistenceFailure, type ApplicationPersistenceParticipant, type ApplicationPersistenceResolver } from '@/core/application-control/execution/persistence'
import { getPlatform } from '@/platform/runtime'

export interface AudioEditProjectInstance {
  document: AudioEditProjectDocument
  past: AudioEditProjectDocument[]
  future: AudioEditProjectDocument[]
  dirty: boolean
  error: string | null
  version: number
  persistedRevision: number
  saving?: Promise<void>
  timer?: ReturnType<typeof setTimeout>
  batchDepth: number
  busy: number
}
let catalogRevision = 0
export function getAudioEditRevision(): number { return catalogRevision }
const participants = new Map<string, ApplicationPersistenceParticipant>()
const instances = new Map<string, AudioEditProjectInstance>()
const loads = new Map<string, Promise<AudioEditProjectInstance>>()
const listeners = new Set<(instance: AudioEditProjectInstance) => void>()
function publish(instance: AudioEditProjectInstance): void { for (const listener of listeners) listener(instance) }
export function subscribeAudioEditInstances(listener: (instance: AudioEditProjectInstance) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function getAudioEditProjectInstance(id: string): AudioEditProjectInstance | undefined { return instances.get(id) }
export function attachAudioEditProject(document: AudioEditProjectDocument): AudioEditProjectInstance {
  const current = instances.get(document.id)
  if (current) return current
  const instance: AudioEditProjectInstance = { document, past: [], future: [], dirty: false, error: null, version: 0, persistedRevision: document.revision, busy: 0, batchDepth: 0 }
  instances.set(document.id, instance)
  catalogRevision = Math.max(catalogRevision + 1, document.revision)
  return instance
}
export async function loadAudioEditProject(id: string): Promise<AudioEditProjectInstance> {
  const existing = instances.get(id)
  if (existing) return existing
  const pending = loads.get(id)
  if (pending) return pending
  const loading = getPlatform().audioEdit.getProject(id).then((document) => {
    if (!document) throw new Error('找不到口播工程。')
    return attachAudioEditProject(document)
  })
  loads.set(id, loading)
  try { return await loading } finally { loads.delete(id) }
}

function schedule(instance: AudioEditProjectInstance): void {
  clearTimeout(instance.timer)
  if (instance.batchDepth) return
  instance.timer = setTimeout(() => { void flushAudioEditProject(instance.document.id).catch(() => undefined) }, 350)
}
export function editAudioEditProject(id: string, update: (document: AudioEditProjectDocument) => AudioEditProjectDocument): AudioEditProjectDocument {
  assertApplicationWritesAllowed()
  const instance = instances.get(id)
  if (!instance) throw new Error('工程尚未载入。')
  if (instance.busy) throw new Error('请等待当前处理完成或取消后再修改。')
  const next = update(instance.document)
  if (next === instance.document || JSON.stringify(next) === JSON.stringify(instance.document)) return instance.document
  audioEditProjectSchema.parse(next)
  assertAudioEditLocks(instance.document, next)
  if (!instance.batchDepth) instance.past = [...instance.past.slice(-49), instance.document]
  instance.future = []
  instance.document = { ...next, revision: instance.document.revision + 1 }
  catalogRevision += 1
  instance.version += 1
  instance.dirty = true
  instance.error = null
  publish(instance)
  schedule(instance)
  return instance.document
}
export function undoAudioEditProject(id: string, redo = false): void {
  assertApplicationWritesAllowed()
  const instance = instances.get(id)
  if (!instance || instance.busy) return
  const from = redo ? instance.future : instance.past
  const previous = redo ? from[0] : from.at(-1)
  if (!previous) return
  if (redo) { instance.future = from.slice(1); instance.past = [...instance.past.slice(-49), instance.document] }
  else { instance.past = from.slice(0, -1); instance.future = [instance.document, ...instance.future.slice(0, 49)] }
  instance.document = { ...previous, source: instance.document.source, revision: instance.document.revision + 1 }
  catalogRevision += 1
  instance.version += 1
  instance.dirty = true
  instance.error = null
  publish(instance)
  schedule(instance)
}
export async function flushAudioEditProject(id: string): Promise<void> {
  const instance = instances.get(id)
  if (!instance) return
  clearTimeout(instance.timer)
  if (instance.saving) return instance.saving
  const saving = (async () => {
    while (instance.dirty) {
      const version = instance.version
      const saved = await getPlatform().audioEdit.saveProject({ ...instance.document, revision: instance.persistedRevision })
      instance.persistedRevision = saved.revision
      instance.document = { ...instance.document, updatedAt: saved.updatedAt, revision: Math.max(instance.document.revision, saved.revision) }
      instance.dirty = version !== instance.version
      instance.error = null
      publish(instance)
    }
  })()
  instance.saving = saving
  try { await saving }
  catch (error) {
    instance.error = error instanceof Error ? error.message : '工程保存失败'
    publish(instance)
    throw error
  } finally { instance.saving = undefined }
}
/** A native result replaces only the version it was submitted against. */
export function acceptAudioEditNativeResult(id: string, document: AudioEditProjectDocument, version: number): void {
  const instance = instances.get(id)
  if (!instance || instance.version !== version) throw new Error('工程已改变，处理结果没有覆盖当前编辑。')
  instance.past = [...instance.past.slice(-49), instance.document]
  instance.future = []
  instance.document = { ...document, revision: Math.max(document.revision, instance.document.revision + 1) }
  instance.persistedRevision = document.revision
  catalogRevision += 1
  instance.version += 1
  instance.dirty = false
  instance.error = null
  publish(instance)
}
export async function withAudioEditProjectOperation<T>(id: string, operation: (instance: AudioEditProjectInstance, commit: (update: (document: AudioEditProjectDocument) => AudioEditProjectDocument) => AudioEditProjectDocument) => Promise<T>): Promise<T> {
  assertApplicationWritesAllowed()
  const instance = await loadAudioEditProject(id)
  if (instance.busy) throw new Error('该工程已有处理任务。')
  instance.busy += 1
  publish(instance)
  try {
    await flushAudioEditProject(id)
    return await operation(instance, (update) => {
      instance.busy -= 1
      try { return editAudioEditProject(id, update) } finally { instance.busy += 1; publish(instance) }
    })
  }
  finally { instance.busy -= 1; publish(instance) }
}
export function releaseAudioEditProject(id: string): void {
  const instance = instances.get(id)
  if (instance && (instance.dirty || instance.busy || instance.saving)) throw new Error('请先保存或等待工程处理完成。')
  if (instance) clearTimeout(instance.timer)
  instances.delete(id)
  participants.delete(id)
}
export async function flushAllAudioEditProjects(): Promise<void> {
  if (loads.size || [...instances.values()].some((instance) => instance.busy)) throw new Error('口播工程正在处理，请等待或取消后再关闭。')
  await Promise.all([...instances.keys()].map(flushAudioEditProject))
}
export const resolveAudioEditPersistenceParticipants: ApplicationPersistenceResolver = (steps) => {
  const ids = new Set(steps.flatMap((step) => step.kind === 'mutation' && step.target.kind.startsWith('audio_edit.') ? [step.target.id.split(':')[0]] : []))
  return [...ids].map((id) => {
    const existing = participants.get(id)
    if (existing) return existing
    const participant: ApplicationPersistenceParticipant = { key: `audio_edit:${id}`, begin() {
    const instance = instances.get(id)
    if (!instance) throw new Error('工程尚未载入')
    const initial = instance.document
    const initialVersion = instance.version
    instance.batchDepth += 1
    clearTimeout(instance.timer)
    return {
      async confirm() { try { await flushAudioEditProject(id) } catch (error) {
        throw new ApplicationPersistenceFailure('工程修改已保留，但保存失败。请重试保存，不要重复剪辑。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'retry_audio_edit_save', target: { kind: 'audio_edit.project', id }, replayMutation: false } }, error)
      } },
      release() {
        instance.batchDepth -= 1
        if (instance.version !== initialVersion && !instance.batchDepth) { instance.past = [...instance.past.slice(-49), initial]; publish(instance) }
      },
    }
    } }
    participants.set(id, participant)
    return participant
  })
}
