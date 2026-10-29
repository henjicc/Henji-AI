import type { CodeAuthorApiVersion } from '@/core/videoEdit/codeAuthorProgram'
import type { z } from 'zod'
import { upgradeVideoEditCodeMaterialsCapability, videoEditCodeInstanceMigration } from '@/core/application-control/domains/videoEdit/videoEditCodeProjectCapabilities'
import { addressCodeMaterialFiles, codeVersionContentKey, loadCodeSourceReferences, resolveCodeMaterialFiles, documentCodeSourceResolver } from '@/core/videoEdit/codeMaterial/sources'
import { codeVersionCompilation, codeVersionInheritance } from '@/core/videoEdit/codeMaterialVersions'
import { latestAuthorLibraryVersions, authorLibraryVersion } from '@/core/videoEdit/codeMaterial/authorLibraries'
import { expandPinnedCodeComponents } from '@/core/videoEdit/codeMaterial/components'
import type { VideoEditCodeVersionInput } from './videoEditCodeService'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { videoEditComposition } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import { prepareProjectCodePublication } from './videoEditCodeStorage'
import { createVideoEditCodeVersions } from './videoEditCodeService'
import { requireVideoEditInstance, editVideoProject, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'
import { compileVideoEditCode, ensureVideoEditChangedCodeMetadata, ensureVideoEditRetargetMetadata, readVideoEditCodeMetadata, withVideoEditUnreadableCodeVersions } from './videoEditCodeState'
import { validateCodeMaterialDocument, codeMaterialTrustContext, changedCodeMaterialVersions, retargetCodeMaterialInstances, videoEditCodeReferences } from '@/core/videoEdit/codeMaterialDocument'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
type Input = z.infer<typeof upgradeVideoEditCodeMaterialsCapability.inputSchema>
type Output = z.infer<typeof upgradeVideoEditCodeMaterialsCapability.outputSchema>
export async function upgradeVideoEditCodeMaterials(input: Input, signal?: AbortSignal): Promise<Output> {
  const id = input.documentRef.id; const owner = requireVideoEditInstance(id); const contentVersion = owner.contentVersion
  const selected = input.materialRefs ? input.materialRefs.map(ref => {
    if (!ref.id.startsWith(`${id}:`)) throw new Error(`素材 ${ref.id} 不属于目标剪辑。`)
    const definition = owner.document.codeMaterials?.find(value => `${id}:${value.id}` === ref.id)
    if (!definition) throw new Error(`素材 ${ref.id} 不存在。`)
    if (!input.upgradeLibraries && !definition.versions.find(version => version.id === definition.defaultVersionId)?.project) throw new Error(`素材 ${definition.name} 不是工程入口素材。`)
    return definition
  }) : (owner.document.codeMaterials ?? []).filter(definition => input.upgradeLibraries || definition.versions.find(version => version.id === definition.defaultVersionId)?.project)
  const hasProject = selected.some(definition => definition.versions.find(version => version.id === definition.defaultVersionId)?.project)
  const commit = input.commit ?? (hasProject ? (await getPlatform().documents.readCodeProject({ id, path: owner.session.documentMeta.path })).head : '')
  if (hasProject && !commit) throw new Error('工程尚未提交，请先创建或提交工程文件。')
  const upgrades: Output['upgrades'] = []; const pending: VideoEditCodeVersionInput[] = []; const unreadable = new Set<string>()
  for (const definition of new Map(selected.map(value => [value.id, value])).values()) {
    const old = definition.versions.find(version => version.id === definition.defaultVersionId)!
    await loadCodeSourceReferences(old).catch(() => undefined)
    const resolver = documentCodeSourceResolver()
    const project = old.project ? await prepareProjectCodePublication(id, old.project.entry, commit!) : undefined
    const contents = { ...(project?.contents ?? resolveCodeMaterialFiles(old, resolver)), trustContext: codeMaterialTrustContext(owner.document, { definitionId: definition.id, versionId: old.id }) }
    const imports = project?.publication.imports ?? old.imports ?? []
    const libraries = input.upgradeLibraries ? latestAuthorLibraryVersions(old.apiVersion) : project?.publication.libraries
    const compilation = codeVersionCompilation(expandPinnedCodeComponents(contents, imports, resolver), { ...codeVersionInheritance(old, resolver), ...project?.publication, libraries, apiVersion: old.apiVersion as CodeAuthorApiVersion })
    // 升级库时以打包器实际保留的导入为准，避免仅作类型使用的 import 产生空升级。
    const usedLibraries = input.upgradeLibraries ? (await compileVideoEditCode(compilation, signal)).bundle.libraries : compilation.libraries
    const addressed = await addressCodeMaterialFiles(contents)
    const key = codeVersionContentKey({ ...addressed, imports, libraries: usedLibraries, apiVersion: old.apiVersion })
    const effectiveKey = (version: typeof old): string => codeVersionContentKey({ ...version, libraries: Object.fromEntries(Object.keys(usedLibraries ?? {}).map(name => [name, authorLibraryVersion(name, version.libraries)!])) })
    const outdatedReferences = input.upgradeLibraries && videoEditCodeReferences(owner.document).some(instance => instance.definitionId === definition.id && instance.versionId !== old.id)
    if (key === effectiveKey(old) && !outdatedReferences) continue
    const existing = definition.versions.find(version => effectiveKey(version) === key)
    const before = new Map(old.files.map(file => [file.path, file.hash])); const after = new Map(addressed.files.map(file => [file.path, file.hash]))
    upgrades.push({ materialRef: { kind: 'video_edit.code_material', id: `${id}:${definition.id}`, label: definition.name }, oldVersion: old.id, newVersion: existing?.id ?? '', changedFiles: [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path)).sort(), retargetedClips: 0 })
    if (!existing) pending.push({ definitionId: definition.id, ...(project ? { projectCommit: commit! } : { files: contents.files, entry: contents.entry }), ...(input.upgradeLibraries ? { libraries: usedLibraries ?? {} } : {}) })
    // 新建版本的声明在创建时登记，所以只有复用已有版本时才先读目标版本。
    for (const versionId of await ensureVideoEditRetargetMetadata(owner, owner.document, definition.id, existing?.id, signal)) unreadable.add(versionId)
  }
  signal?.throwIfAborted()
  if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('解析工程期间剪辑已修改，请重试升级。')
  const resultRefs: Output['resultRefs'] = []; const instances: Output['instances'] = []
  const retarget = (document: VideoEditDocument, versions: string[]): VideoEditDocument => {
    const read = readVideoEditCodeMetadata(owner, document)
    for (const row of upgrades) {
      const definitionId = row.materialRef.id.slice(id.length + 1)
      if (!row.newVersion) { row.newVersion = versions[pending.findIndex(value => value.definitionId === definitionId)]; resultRefs.push({ kind: 'video_edit.code_version', id: `${id}:${row.newVersion}` }) }
      const moved = retargetCodeMaterialInstances(document, definitionId, row.newVersion, read({ definitionId, versionId: row.newVersion, parameters: {} }), read, { unreadable })
      document = moved.document
      document.codeMaterials!.find(definition => definition.id === definitionId)!.defaultVersionId = row.newVersion
      resultRefs.push(row.materialRef)
      const clips = new Map<string, string>()
      for (const instance of moved.instances) {
        const row = videoEditCodeInstanceMigration(id, instance); const { target } = instance
        resultRefs.push(row.ref); instances.push(row)
        if (target.kind !== 'item') clips.set(target.kind === 'clip' ? target.id : target.clipId, target.sequenceId)
      }
      for (const [clipId, sequenceId] of clips) {
        const sequence = videoEditComposition(document, sequenceId)
        assertVideoEditClipsEditable(sequence, [clipId]); row.retargetedClips++
        resultRefs.push({ kind: 'video_edit.clip', id: `${id}:${clipId}`, label: sequence.clips.find(clip => clip.id === clipId)!.name })
      }
    }
    return document
  }
  await withVideoEditUnreadableCodeVersions(owner, unreadable, async () => {
    if (pending.length) await createVideoEditCodeVersions(id, pending, signal, undefined, undefined, retarget)
    else if (upgrades.length) {
      const next = retarget(owner.document, [])
      await ensureVideoEditChangedCodeMetadata(owner, owner.document, next, signal)
      validateCodeMaterialDocument(next, readVideoEditCodeMetadata(owner, next), changedCodeMaterialVersions(owner.document, next))
      if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('升级检查期间剪辑已改变，请重试。')
      editVideoProject(id, () => next)
    }
  })
  await saveVideoEdit(id)
  return { commit: commit ?? '', upgrades, instances, resultRefs: [...new Map(resultRefs.map(ref => [`${ref.kind}:${ref.id}`, ref])).values()], verified: await verifyVideoEditSaved(id), message: upgrades.length ? `已升级 ${upgrades.length} 个代码素材。` : '源码与内置库未变化，无需升级。' }
}
