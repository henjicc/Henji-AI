import type { CodeProjectState } from '@/core/videoEdit/codeMaterial/projectContract'
import type { CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { codeProjectAncestors } from '../application/videoEditCodeProjectView'

/** 代码工程面板的纯数据：文件树的行、片段用到的文件、跟工作区相比已经过时的工程素材。 */
export interface CodeProjectRow { kind: 'folder' | 'file'; path: string; name: string; depth: number; expanded: boolean }
type Codes = Pick<VideoEditDocument, 'codeMaterials'>

const byName = (a: string, b: string): number => a.localeCompare(b, 'zh-CN', { numeric: true })
/** 文件夹在前、文件在后，各按名称（`01-opening` 排在 `02-…` 前）；`only` 给出时只留这些文件和它们所在的文件夹（全部展开）。 */
export function codeProjectRows(paths: readonly string[], expanded: ReadonlySet<string>, only?: ReadonlySet<string>): CodeProjectRow[] {
  const visible = only ? paths.filter(path => only.has(path)) : paths
  const folders = new Set(visible.flatMap(codeProjectAncestors))
  const children = new Map<string, { folders: string[]; files: string[] }>()
  const bucket = (parent: string) => { let value = children.get(parent); if (!value) children.set(parent, value = { folders: [], files: [] }); return value }
  for (const folder of folders) bucket(codeProjectAncestors(folder).at(-1) ?? '').folders.push(folder)
  for (const path of visible) bucket(codeProjectAncestors(path).at(-1) ?? '').files.push(path)
  const rows: CodeProjectRow[] = []
  const walk = (parent: string, depth: number): void => {
    const entry = children.get(parent); if (!entry) return
    for (const folder of [...entry.folders].sort(byName)) {
      const open = !!only || expanded.has(folder)
      rows.push({ kind: 'folder', path: folder, name: folder.split('/').at(-1)!, depth, expanded: open })
      if (open) walk(folder, depth + 1)
    }
    for (const path of [...entry.files].sort(byName)) rows.push({ kind: 'file', path, name: path.split('/').at(-1)!, depth, expanded: false })
  }
  walk('', 0)
  return rows
}

export interface CodeProjectClosure { definitionId: string; name: string; entry: string; paths: ReadonlySet<string> }
function projectVersion(document: Codes, definitionId: string, versionId: string) {
  const definition = document.codeMaterials?.find(value => value.id === definitionId)
  const version = definition?.versions.find(value => value.id === versionId)
  return definition && version?.project ? { definition, version, project: version.project } : null
}
/** 片段（含效果链里的代码滤镜）用到的工程文件；不是工程入口素材的不算。 */
export function clipCodeProjectClosures(document: VideoEditDocument, sequenceId: string, clipId: string | null): CodeProjectClosure[] {
  const clip = clipId ? document.sequences.find(sequence => sequence.id === sequenceId)?.clips.find(value => value.id === clipId) : undefined
  if (!clip) return []
  const codes = [clip.code, ...(clip.effects ?? []).map(effect => effect.code)].filter((code): code is CodeMaterialInstance => !!code)
  return codes.flatMap(code => {
    const found = projectVersion(document, code.definitionId, code.versionId)
    return found ? [{ definitionId: found.definition.id, name: found.definition.name, entry: found.project.entry, paths: new Set(found.version.files.map(file => file.path)) }] : []
  })
}
/** 默认版本用到这个文件的工程素材（同一份剪辑里）。 */
export function codeMaterialsUsingProjectFile(document: Codes, path: string): { definitionId: string; name: string; entry: boolean }[] {
  return (document.codeMaterials ?? []).flatMap(definition => {
    const found = projectVersion(document, definition.id, definition.defaultVersionId)
    return found?.version.files.some(file => file.path === path) ? [{ definitionId: definition.id, name: definition.name, entry: found.project.entry === path }] : []
  })
}
/**
 * 默认版本用到的文件在工作区里已经改了的工程素材：升级就能用上新代码。
 * 外部改过还没提交的文件不算（升级只认提交），文件被删了算改了。
 */
export function outdatedProjectCodeMaterials(document: Codes, state: Pick<CodeProjectState, 'files' | 'changes'>): { definitionId: string; name: string; changedPaths: string[] }[] {
  const current = new Map(state.files.map(file => [file.path, file.hash])); const uncommitted = new Set(state.changes.map(change => change.path))
  return (document.codeMaterials ?? []).flatMap(definition => {
    const found = projectVersion(document, definition.id, definition.defaultVersionId)
    const changedPaths = found ? found.version.files.filter(file => !uncommitted.has(file.path) && current.get(file.path) !== file.hash).map(file => file.path) : []
    return changedPaths.length ? [{ definitionId: definition.id, name: definition.name, changedPaths }] : []
  })
}
