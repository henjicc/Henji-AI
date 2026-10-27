import { focusVideoEditPanel } from './videoEditService'

/** 代码工程面板的视图状态，每个剪辑实例一份：看文件还是看提交、打开了哪个文件、展开了哪些文件夹。 */
export type VideoEditCodeProjectMode = 'files' | 'history'
/** `highlight`：打开文件后选中这一段（元素的源码位置）；`hash` 是定位所依据的文件内容，工作区里的文件改过就不选。 */
export interface VideoEditCodeProjectHighlight { path: string; hash: string; start: number; end: number }
export interface VideoEditCodeProjectView { mode: VideoEditCodeProjectMode; openPath: string | null; expanded: readonly string[]; onlySelection: boolean; highlight: VideoEditCodeProjectHighlight | null }
const DEFAULT_VIEW: VideoEditCodeProjectView = { mode: 'files', openPath: null, expanded: [], onlySelection: false, highlight: null }
const views = new Map<string, VideoEditCodeProjectView>()
const listeners = new Set<() => void>()
let revision = 0

export function subscribeVideoEditCodeProjectView(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoEditCodeProjectViewRevision(): number { return revision }
export function getVideoEditCodeProjectView(id: string): VideoEditCodeProjectView { return views.get(id) ?? DEFAULT_VIEW }
export function setVideoEditCodeProjectView(id: string, values: Partial<VideoEditCodeProjectView>): void {
  views.set(id, { ...getVideoEditCodeProjectView(id), ...values }); revision++
  for (const listener of listeners) listener()
}
/** `style/dot-matrix/parts/tag.ts` → `style`、`style/dot-matrix`、`style/dot-matrix/parts`。 */
export function codeProjectAncestors(path: string): string[] {
  const parts = path.split('/'); return parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join('/'))
}
/** 展开这些文件所在的文件夹，已展开的保持不动。 */
export function revealVideoEditCodeProjectPaths(id: string, paths: readonly string[]): void {
  const view = getVideoEditCodeProjectView(id)
  const expanded = [...new Set([...view.expanded, ...paths.flatMap(codeProjectAncestors)])]
  if (expanded.length !== view.expanded.length) setVideoEditCodeProjectView(id, { expanded })
}
/** 效果控件等处的“在代码工程中打开”：展开所在文件夹、打开文件，并把代码面板调到前面。 */
export function openVideoEditCodeProjectFile(id: string, path: string, highlight?: Omit<VideoEditCodeProjectHighlight, 'path'>): void {
  revealVideoEditCodeProjectPaths(id, [path])
  setVideoEditCodeProjectView(id, { mode: 'files', openPath: path, highlight: highlight ? { path, ...highlight } : null })
  focusVideoEditPanel(id, 'code_project')
}
