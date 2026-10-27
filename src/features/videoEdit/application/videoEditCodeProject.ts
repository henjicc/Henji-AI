import { getPlatform } from '@/platform/runtime'
import type { CodeProjectFile, CodeProjectState } from '@/core/videoEdit/codeMaterial/projectContract'
import { codeProjectPathSchema } from '@/core/videoEdit/codeMaterial/projectContract'
import { sha256HexString } from '@/utils/save/hash'
import type { ApplicationPlannedStep } from '@/core/application-control'
import type { ApplicationPersistenceParticipant } from '@/core/application-control/execution/persistence'
import { requireVideoEditInstance, publishVideoEdit } from './videoEditService'

const target = (id: string) => ({ id, path: requireVideoEditInstance(id).session.documentMeta.path })
const keyOf = (id: string): string => JSON.stringify(requireVideoEditInstance(id).session.documentMeta.container)
interface Batch { id: string; initial?: CodeProjectState; current?: CodeProjectState; summary: string; rollback: (() => void)[] }
const batches = new Map<string, Batch>()
const changeListeners = new Set<(id: string) => void>()
/** 提交落进 Git 后通知界面重读：事务里的文件改动要到批次确认时才提交，事务中途的发布读不到新提交。 */
export function subscribeVideoCodeProjectChanges(listener: (id: string) => void): () => void { changeListeners.add(listener); return () => { changeListeners.delete(listener) } }
export function notifyVideoCodeProjectChanged(id: string): void { for (const listener of changeListeners) listener(id) }
export function onCodeProjectCommitFailure(id: string, rollback: () => void): void {
  const batch = batches.get(keyOf(id))
  if (!batch) throw new Error('工程文件修改必须位于 change_application_entities 事务中。')
  batch.rollback.push(rollback)
}
export async function readVideoCodeProject(id: string): Promise<CodeProjectState> {
  const batch = batches.get(keyOf(id))
  if (!batch) return getPlatform().documents.readCodeProject(target(id))
  if (!batch.initial) { batch.initial = await getPlatform().documents.readCodeProject(target(id)); batch.current = structuredClone(batch.initial) }
  return batch.current!
}
/** 界面用：只读已经提交到磁盘的工程，不读进行中事务的工作副本（事务可能还会回滚）。 */
export async function readCommittedVideoCodeProject(id: string): Promise<CodeProjectState> { return getPlatform().documents.readCodeProject(target(id)) }
export async function replaceVideoCodeProjectFiles(id: string, files: CodeProjectFile[], summary: string): Promise<void> {
  const batch = batches.get(keyOf(id))
  if (!batch) throw new Error('工程文件修改必须位于 change_application_entities 事务中。')
  await readVideoCodeProject(id)
  batch.current!.files = structuredClone(files); batch.summary = summary
  publishVideoEdit(true)
}
export async function makeCodeProjectFile(path: string, source: string): Promise<CodeProjectFile> {
  return { path: codeProjectPathSchema.parse(path), source, bytes: new TextEncoder().encode(source).byteLength, hash: await sha256HexString(source) }
}
// The transaction planner compares participant identity; refresh the active document without replacing it.
const participants = new Map<string, { participant: ApplicationPersistenceParticipant; id: string }>()
export function codeProjectPersistenceParticipants(steps: readonly ApplicationPlannedStep[]): ApplicationPersistenceParticipant[] {
  const ids = steps.flatMap(step => step.kind === 'mutation' && step.entityType === 'video_edit.code_project_file' ? [step.target.id.split(':')[0]]
    : step.kind === 'collection' && step.entityType === 'video_edit.code_project_file' ? [step.parent.id] : [])
  return [...new Set(ids)].map(id => {
    const key = keyOf(id)
    const known = participants.get(key)
    if (known) { known.id = id; return known.participant }
    const participant: ApplicationPersistenceParticipant = { key: `code_project:${key}`, begin() {
      const batch: Batch = { id: participants.get(key)!.id, summary: '修改代码工程', rollback: [] }; batches.set(key, batch)
      let confirmed = false; let committed = false
      return {
        async confirm() {
          if (!batch.initial || !batch.current) { confirmed = true; return }
          const before = new Map(batch.initial.files.map(file => [file.path, file])); const after = new Map(batch.current.files.map(file => [file.path, file]))
          const changes = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path)?.hash !== after.get(path)?.hash)
            .map(path => ({ path, source: after.get(path)?.source ?? null, expectedHash: before.get(path)?.hash ?? null }))
          if (changes.length) { await getPlatform().documents.changeCodeProject({ target: target(batch.id), message: batch.summary, changes }); committed = true }
          confirmed = true
        },
        // 批次释放后再通知：释放前读到的还是事务里的工作副本，没有新提交
        release() { if (!confirmed) for (const rollback of batch.rollback.reverse()) rollback(); batches.delete(key); if (committed) notifyVideoCodeProjectChanged(batch.id) },
      }
    } }
    participants.set(key, { participant, id }); return participant
  })
}
