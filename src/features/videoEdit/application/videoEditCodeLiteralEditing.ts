import { createLogger } from '@/core/logging'
import { changedCodeMaterialVersions, codeMaterialVersion, retargetCodeMaterialInstances, validateCodeMaterialDocument, videoEditCodeReferences } from '@/core/videoEdit/codeMaterialDocument'
import { documentCodeSourceResolver, loadCodeSourceReferences, resolveCodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { replaceUniqueCodeStringLiteral } from '@/core/videoEdit/codeStringLiterals'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import type { CodeMaterialVersion } from '@/core/videoEdit/codeMaterialPersistence'
import { getPlatform } from '@/platform/runtime'
import { commitVideoEditCodeProjectFiles, upgradeVideoEditProjectCodeMaterials } from './videoEditCodeProjectEditing'
import { createVideoEditCodeVersions } from './videoEditCodeService'
import { ensureVideoEditChangedCodeMetadata, ensureVideoEditRetargetMetadata, readVideoEditCodeMetadata } from './videoEditCodeState'
import { resolveVideoEditCodeElementClip, type VideoEditCodeElementTarget } from './videoEditCodeElementWrites'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { editVideoProject, requireVideoEditInstance, saveVideoEdit, setVideoEditView } from './videoEditService'

const logger = createLogger('features.videoEdit.codeLiteral')
/** 只在脚本里找出处：说明文档、数据文件里同文的句子不是画面上的字。 */
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/

/**
 * 写死在源码里的字：画出来的字恰好对上源码里唯一一处字符串字面量时，直接改这处字面量，让用这个版本的片段都换上新源码，不经助手。
 * 工程型素材改工程文件并提交，再把素材升级到新提交（与在代码面板里改文件同一条路）；它用到的文件后来又改过时，升级会连带别的改动，交给助手。
 * 返回 false 表示找不到唯一出处，调用方改为交给助手。`signal` 只在第一次写入前有效：写进去以后中途放弃只会留下半截改动。
 */
export async function editVideoEditCodeElementLiteral(target: VideoEditCodeElementTarget, before: string, after: string, signal: AbortSignal): Promise<boolean> {
  const owner = requireVideoEditInstance(target.projectId); const { clip } = resolveVideoEditCodeElementClip(target); const contentVersion = owner.contentVersion
  const code = clip.code!, version = codeMaterialVersion(owner.document, code)
  await loadCodeSourceReferences(version)
  signal.throwIfAborted()
  const files = resolveCodeMaterialFiles(version, documentCodeSourceResolver())
  const changes = replaceUniqueCodeStringLiteral(Object.fromEntries(Object.entries(files.files).filter(([path]) => SCRIPT.test(path))), before, after)
  if (!changes) return false
  if (version.project) {
    // 升级会用工程的最新提交，并把这个素材的所有片段都换过去：用到的文件在最新提交里一字未变、也没有片段停在别的版本上，才只会带进这一处改字。
    const project = await getPlatform().documents.readCodeProject({ id: target.projectId, path: owner.session.documentMeta.path })
    const head = new Map(project.files.map(file => [file.path, file.source])), uncommitted = new Set(project.changes.map(change => change.path))
    if (Object.entries(files.files).some(([path, source]) => uncommitted.has(path) || head.get(path) !== source)) return false
    if (videoEditCodeReferences(owner.document).some(instance => instance.definitionId === code.definitionId && instance.versionId !== code.versionId)) return false
  }
  signal.throwIfAborted()
  const committed = new AbortController().signal
  logger.info('开始直接改源码里的字', { event: 'video_edit.code.literal.start', context: { projectId: target.projectId, clipId: target.clipId, definitionId: code.definitionId, paths: changes.map(change => change.path) } })
  try {
    if (version.project) {
      await commitVideoEditCodeProjectFiles(target.projectId, changes, `改字：${before} → ${after}`.slice(0, 200), committed)
      await upgradeVideoEditProjectCodeMaterials(target.projectId, [code.definitionId], committed)
    } else {
      const next = { ...files.files, ...Object.fromEntries(changes.map(change => [change.path, change.source])) }
      const retarget = (document: VideoEditDocument, versionId: string): VideoEditDocument => {
        const read = readVideoEditCodeMetadata(owner, document)
        return retargetCodeMaterialInstances(document, code.definitionId, versionId, read({ definitionId: code.definitionId, versionId, parameters: {} }), read, { select: (_, instance) => instance.versionId === code.versionId }).document
      }
      // 改回以前的字时源码和某个旧版本完全相同，版本按内容确定，不能再建一个：直接换回那个版本。
      const existing = await sameSourceVersion(owner.document, version, next)
      if (existing) {
        await ensureVideoEditRetargetMetadata(owner, owner.document, code.definitionId, existing, committed)
        const document = retarget(owner.document, existing)
        await ensureVideoEditChangedCodeMetadata(owner, owner.document, document, committed)
        validateCodeMaterialDocument(document, readVideoEditCodeMetadata(owner, document), changedCodeMaterialVersions(owner.document, document))
        // 准备期间用户可能又改了别处，整份替换会盖掉那些改动。
        if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('改字期间剪辑已改变，请重新改一次。')
        editVideoProject(target.projectId, () => document)
      } else await createVideoEditCodeVersions(target.projectId, [{ definitionId: code.definitionId, entry: files.entry, files: next }], committed, undefined, undefined, (document, [versionId]) => retarget(document, versionId))
      await saveVideoEdit(target.projectId)
    }
  } catch (error) {
    logger.error('直接改源码里的字失败', { event: 'video_edit.code.literal.failed', error, context: { projectId: target.projectId, clipId: target.clipId } })
    throw error
  }
  // 片段换了源码版本，选中记录跟过去，改完还停在这个元素上。
  const versionId = owner.document.sequences.find(sequence => sequence.id === target.sequenceId)?.clips.find(value => value.id === target.clipId)?.code?.versionId
  if (versionId && versionId !== target.versionId) setVideoEditView(target.projectId, { selection: target.clipId, selectedCodeElement: { sequenceId: target.sequenceId, clipId: target.clipId, versionId, elementId: target.elementId } })
  logger.info('已直接改源码里的字', { event: 'video_edit.code.literal.completed', context: { projectId: target.projectId, clipId: target.clipId, versionId } })
  return true
}

/** 源码、组件引用、作者接口与库版本都和改后一致的旧版本：只有这样换回去画面才只差这处字。 */
async function sameSourceVersion(document: VideoEditDocument, current: CodeMaterialVersion, files: Readonly<Record<string, string>>): Promise<string | undefined> {
  const versions = document.codeMaterials?.find(definition => definition.versions.some(version => version.id === current.id))?.versions ?? []
  const paths = Object.keys(files).sort().join('\n'), same = (version: CodeMaterialVersion): boolean => version.apiVersion === current.apiVersion && JSON.stringify(version.imports ?? []) === JSON.stringify(current.imports ?? []) && JSON.stringify(version.libraries ?? {}) === JSON.stringify(current.libraries ?? {})
  for (const version of versions) {
    if (version.id === current.id || version.project || version.entry !== current.entry || !same(version) || version.files.map(file => file.path).sort().join('\n') !== paths) continue
    try { await loadCodeSourceReferences(version) } catch { continue }
    const resolved = resolveCodeMaterialFiles(version, documentCodeSourceResolver()).files
    if (Object.entries(files).every(([path, source]) => resolved[path] === source)) return version.id
  }
  return undefined
}
