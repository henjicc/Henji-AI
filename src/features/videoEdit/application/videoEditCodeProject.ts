import { getPlatform } from '@/platform/runtime'
import type { CodeProjectFile, CodeProjectState } from '@/core/videoEdit/codeMaterial/projectContract'
import { codeProjectPathSchema } from '@/core/videoEdit/codeMaterial/projectContract'
import { sha256HexString } from '@/utils/save/hash'
import type { ApplicationPlannedStep } from '@/core/application-control'
import type { ApplicationPersistenceParticipant } from '@/core/application-control/execution/persistence'
import { requireVideoEditInstance, publishVideoEdit } from './videoEditService'

const target = (id: string) => ({ id, path: requireVideoEditInstance(id).session.documentMeta.path })
const keyOf = (id: string): string => JSON.stringify(requireVideoEditInstance(id).session.documentMeta.container)
interface Batch { id: string; initial?: CodeProjectState; current?: CodeProjectState; summary: string }
const batches = new Map<string, Batch>()
export async function readVideoCodeProject(id: string): Promise<CodeProjectState> {
  const batch = batches.get(keyOf(id))
  if (!batch) return getPlatform().documents.readCodeProject(target(id))
  if (!batch.initial) { batch.initial = await getPlatform().documents.readCodeProject(target(id)); batch.current = structuredClone(batch.initial) }
  return batch.current!
}
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
const participants = new Map<string, ApplicationPersistenceParticipant>()
export function codeProjectPersistenceParticipants(steps: readonly ApplicationPlannedStep[]): ApplicationPersistenceParticipant[] {
  const ids = steps.flatMap(step => step.kind === 'mutation' && step.entityType === 'video_edit.code_project_file' ? [step.target.id.split(':')[0]]
    : step.kind === 'collection' && step.entityType === 'video_edit.code_project_file' ? [step.parent.id] : [])
  return [...new Set(ids)].map(id => {
    const key = keyOf(id); const known = participants.get(key); if (known) return known
    const participant: ApplicationPersistenceParticipant = { key: `code_project:${key}`, begin() {
      const batch: Batch = { id, summary: '修改代码工程' }; batches.set(key, batch)
      return {
        async confirm() {
          if (!batch.initial || !batch.current) return
          const before = new Map(batch.initial.files.map(file => [file.path, file])); const after = new Map(batch.current.files.map(file => [file.path, file]))
          const changes = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path)?.hash !== after.get(path)?.hash)
            .map(path => ({ path, source: after.get(path)?.source ?? null, expectedHash: before.get(path)?.hash ?? null }))
          if (changes.length) await getPlatform().documents.changeCodeProject({ target: target(batch.id), message: batch.summary, changes })
        },
        release() { batches.delete(key) },
      }
    } }
    participants.set(key, participant); return participant
  })
}
