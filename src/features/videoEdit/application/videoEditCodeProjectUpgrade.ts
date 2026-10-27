import type { z } from 'zod'
import { upgradeVideoEditCodeMaterialsCapability } from '@/core/application-control/domains/videoEdit/videoEditCodeProjectCapabilities'
import { addressCodeMaterialFiles, codeVersionContentKey } from '@/core/videoEdit/codeMaterial/sources'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import type { CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { videoEditComposition } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import { prepareProjectCodePublication } from './videoEditCodeStorage'
import { createVideoEditCodeVersions } from './videoEditCodeService'
import { requireVideoEditInstance, editVideoProject, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'
import { ensureVideoEditChangedCodeMetadata, readVideoEditCodeMetadata } from './videoEditCodeState'
import { validateCodeMaterialDocument, changedCodeMaterialVersions } from '@/core/videoEdit/codeMaterialDocument'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
type Input = z.infer<typeof upgradeVideoEditCodeMaterialsCapability.inputSchema>
type Output = z.infer<typeof upgradeVideoEditCodeMaterialsCapability.outputSchema>
export async function upgradeVideoEditCodeMaterials(input: Input, signal?: AbortSignal): Promise<Output> {
  const id = input.documentRef.id; const owner = requireVideoEditInstance(id); const contentVersion = owner.contentVersion
  const commit = input.commit ?? (await getPlatform().documents.readCodeProject({ id, path: owner.session.documentMeta.path })).head
  if (!commit) throw new Error('工程尚未提交，请先创建或提交工程文件。')
  const selected = input.materialRefs ? input.materialRefs.map(ref => {
    if (!ref.id.startsWith(`${id}:`)) throw new Error(`素材 ${ref.id} 不属于目标剪辑。`)
    const definition = owner.document.codeMaterials?.find(value => `${id}:${value.id}` === ref.id)
    if (!definition) throw new Error(`素材 ${ref.id} 不存在。`)
    if (!definition.versions.find(version => version.id === definition.defaultVersionId)?.project) throw new Error(`素材 ${definition.name} 不是工程入口素材。`)
    return definition
  }) : (owner.document.codeMaterials ?? []).filter(definition => definition.versions.find(version => version.id === definition.defaultVersionId)?.project)
  const upgrades: Output['upgrades'] = []; const pending: string[] = []
  for (const definition of new Map(selected.map(value => [value.id, value])).values()) {
    const old = definition.versions.find(version => version.id === definition.defaultVersionId)!
    const project = await prepareProjectCodePublication(id, old.project!.entry, commit)
    const addressed = await addressCodeMaterialFiles(project.contents)
    const key = codeVersionContentKey({ ...addressed, imports: project.publication.imports })
    if (key === codeVersionContentKey(old)) continue
    const existing = definition.versions.find(version => codeVersionContentKey(version) === key)
    const before = new Map(old.files.map(file => [file.path, file.hash])); const after = new Map(addressed.files.map(file => [file.path, file.hash]))
    upgrades.push({ materialRef: { kind: 'video_edit.code_material', id: `${id}:${definition.id}`, label: definition.name }, oldVersion: old.id, newVersion: existing?.id ?? '', changedFiles: [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path)).sort(), retargetedClips: 0 })
    if (!existing) pending.push(definition.id)
  }
  signal?.throwIfAborted()
  if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('解析工程期间剪辑已修改，请重试升级。')
  const resultRefs: Output['resultRefs'] = []
  const retarget = (document: VideoEditDocument, versions: string[]): VideoEditDocument => {
    document = structuredClone(document)
    for (const row of upgrades) {
      const definitionId = row.materialRef.id.slice(id.length + 1)
      if (!row.newVersion) { row.newVersion = versions[pending.indexOf(definitionId)]; resultRefs.push({ kind: 'video_edit.code_version', id: `${id}:${row.newVersion}` }) }
      document.codeMaterials!.find(definition => definition.id === definitionId)!.defaultVersionId = row.newVersion
      resultRefs.push(row.materialRef)
      const bind = (code?: CodeMaterialInstance): boolean => { if (!code || code.definitionId !== definitionId || code.versionId === row.newVersion) return false; code.versionId = row.newVersion; return true }
      for (const item of document.items) if (bind(item.code)) resultRefs.push({ kind: 'video_edit.item', id: `${id}:${item.id}` })
      for (const sequence of document.sequences) for (const clip of sequence.clips) {
        let changed = bind(clip.code)
        for (const effect of clip.effects ?? []) if (bind(effect.code)) { changed = true; resultRefs.push({ kind: 'video_edit.effect', id: `${id}:${effect.id}` }) }
        if (changed) { assertVideoEditClipsEditable(videoEditComposition(document, sequence.id), [clip.id]); row.retargetedClips++; resultRefs.push({ kind: 'video_edit.clip', id: `${id}:${clip.id}` }) }
      }
    }
    return document
  }
  if (pending.length) await createVideoEditCodeVersions(id, pending.map(definitionId => ({ definitionId, projectCommit: commit })), signal, undefined, undefined, retarget)
  else if (upgrades.length) {
    const next = retarget(owner.document, [])
    await ensureVideoEditChangedCodeMetadata(owner, owner.document, next, signal)
    validateCodeMaterialDocument(next, readVideoEditCodeMetadata(owner, next), changedCodeMaterialVersions(owner.document, next))
    if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('升级检查期间剪辑已改变，请重试。')
    editVideoProject(id, () => next)
  }
  await saveVideoEdit(id)
  return { commit, upgrades, resultRefs: [...new Map(resultRefs.map(ref => [`${ref.kind}:${ref.id}`, ref])).values()], verified: await verifyVideoEditSaved(id), message: upgrades.length ? `已升级 ${upgrades.length} 个工程素材。` : '工程素材闭包未变化，无需升级。' }
}
