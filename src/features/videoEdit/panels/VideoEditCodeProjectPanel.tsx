import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, Braces, ChevronDown, ChevronRight, FileCode2, FileText, FolderTree, History, ListFilter } from 'lucide-react'
import { UiButton, UiEmpty, UiError, UiIconButton, UiInput, UiLoading, UiOptionButton, UiTextArea, UiToolbar, UiVirtualList } from '@/components/ui'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import type { CodeProjectFile, CodeProjectState } from '@/core/videoEdit/codeMaterial/projectContract'
import { formatTimeAgo } from '@/utils/preset'
import { readCommittedVideoCodeProject, subscribeVideoCodeProjectChanges } from '../application/videoEditCodeProject'
import { commitVideoEditCodeProjectFile, commitVideoEditCodeProjectWorkspace, upgradeVideoEditProjectCodeMaterials } from '../application/videoEditCodeProjectEditing'
import { codeProjectAncestors, getVideoEditCodeProjectView, revealVideoEditCodeProjectPaths, setVideoEditCodeProjectView, subscribeVideoEditCodeProjectView, videoEditCodeProjectViewRevision } from '../application/videoEditCodeProjectView'
import type { VideoEditInstance } from '../application/videoEditService'
import { clipCodeProjectClosures, codeMaterialsUsingProjectFile, codeProjectRows, outdatedProjectCodeMaterials, type CodeProjectRow } from './videoEditCodeProjectModel'

const INDENT_PX = 12
const message = (reason: unknown, fallback: string): string => reason instanceof Error ? reason.message : fallback

/** 面板可见时读工程；提交落盘、回到窗口（可能刚在外部编辑器里改过）时重读。 */
function useCodeProject(projectId: string, visible: boolean, root: React.RefObject<HTMLElement>): { state?: CodeProjectState; error?: string; refresh: () => void } {
  const [state, setState] = useState<CodeProjectState>()
  const [error, setError] = useState<string>()
  const generation = useRef(0)
  const refresh = useCallback((): void => {
    const current = ++generation.current
    void readCommittedVideoCodeProject(projectId).then(value => { if (current === generation.current) { setState(value); setError(undefined) } })
      .catch(reason => { if (current === generation.current) setError(message(reason, '代码工程未能读取，请重试。')) })
  }, [projectId])
  useEffect(() => {
    if (!visible) return
    const reads = generation
    refresh()
    const stop = subscribeVideoCodeProjectChanges(id => { if (id === projectId) refresh() })
    const view = root.current?.ownerDocument.defaultView
    view?.addEventListener('focus', refresh)
    return () => { stop(); view?.removeEventListener('focus', refresh); reads.current++ }
  }, [projectId, visible, refresh, root])
  return { state, error, refresh }
}

function FileIcon({ path }: { path: string }): React.ReactElement {
  const Icon = /\.json$/.test(path) ? Braces : /\.(?:md|txt)$/.test(path) ? FileText : FileCode2
  return <Icon size={UI_ICON_SIZE.xs} className="shrink-0 text-text3" aria-hidden="true" />
}

/** 一条要处理的事：说明在左，处理按钮在右；静息时不着色，只是排在内容最上面。 */
function Notice({ text, detail, action }: { text: string; detail?: string; action: React.ReactNode }): React.ReactElement {
  return <div className="flex min-h-band-row shrink-0 items-center gap-2 border-b border-gap px-3" data-video-edit-code-project-notice>
    <span className="min-w-0 flex-1 truncate text-xs text-text2" title={detail ?? text}>{text}</span>
    {action}
  </div>
}

function FileView({ projectId, file, uncommitted, highlight, onBack, onError, users }: { projectId: string; file: CodeProjectFile; uncommitted: boolean; highlight?: { start: number; end: number }; onBack: () => void; onError: (reason: unknown) => void; users: { name: string; entry: boolean }[] }): React.ReactElement {
  const input = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(file.source)
  // 草稿起点：文件被别处改了而这里没动过时跟着更新；这里也改过就保留草稿，并提示提交会覆盖那次修改
  const [base, setBase] = useState(file.source)
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (file.source === base) return
    if (draft === base || draft === file.source) { setDraft(file.source); setBase(file.source) }
  }, [file.source, base, draft])
  // 从画面元素打开时选中它那一段，并滚到它前一行
  useLayoutEffect(() => {
    const element = input.current
    if (!element || !highlight) return
    element.setSelectionRange(highlight.start, highlight.end)
    const line = file.source.slice(0, highlight.start).split('\n').length
    const lineHeight = Number.parseFloat(element.ownerDocument.defaultView!.getComputedStyle(element).lineHeight) || 20
    element.scrollTop = Math.max(0, (line - 2) * lineHeight)
  }, [highlight, file.source])
  const dirty = draft !== file.source
  const stale = dirty && base !== file.source
  const name = file.path.split('/').at(-1)!
  const folder = file.path.slice(0, -name.length)
  const commit = async (): Promise<void> => {
    if (!dirty || busy) return
    // 提交一旦发出就做完，不随面板切换或关闭取消
    setBusy(true); setError(undefined)
    try { await commitVideoEditCodeProjectFile(projectId, file.path, draft, summary.trim() || `修改 ${file.path}`, new AbortController().signal); if (mounted.current) setSummary('') }
    catch (reason) { if (mounted.current) setError(message(reason, '提交未完成，请重试。')); onError(reason) }
    finally { if (mounted.current) setBusy(false) }
  }
  const usage = users.length ? `${users.length} 个素材在用${users.some(user => user.entry) ? '（入口）' : ''}` : '素材没有用到'
  return <div className="flex min-h-0 flex-1 flex-col" data-video-edit-code-project-file={file.path}>
    <div className="flex min-h-band-row shrink-0 items-center gap-1 px-1.5">
      <UiIconButton size="xs" aria-label="返回文件列表" tooltip="返回文件列表" onClick={onBack}><ArrowLeft /></UiIconButton>
      <span className="min-w-0 flex-1 truncate text-xs" title={file.path}><span className="text-text3">{folder}</span><span className="text-text1">{name}</span></span>
      <span className="shrink-0 text-2xs text-text3" title={users.map(user => user.name).join('、') || undefined}>{usage}</span>
    </div>
    <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
      <UiTextArea ref={input} aria-label={`${file.path} 源码`} className="min-h-0 flex-1 font-mono" wrap="off" spellCheck={false} readOnly={uncommitted || busy} value={draft}
        onChange={event => setDraft(event.target.value)} textHistory={{ onValueChange: setDraft }}
        onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void commit() } }} />
    </div>
    {stale && <span className="shrink-0 px-3 pb-2 text-xs text-text3">这个文件刚在别处改过，提交会覆盖那次修改；不想覆盖就先放弃这里的修改。</span>}
    {uncommitted && <span className="shrink-0 px-3 pb-2 text-xs text-text3">这个文件在外部改过、还没提交，先提交外部修改再在这里改。</span>}
    {error && <div className="shrink-0 px-3 pb-2"><UiError size="xs" align="start" title={error} message="" /></div>}
    {dirty && <div className="flex shrink-0 items-center gap-2 px-2 pb-2" data-video-edit-code-project-commit>
      <UiInput size="sm" className="min-w-0 flex-1" aria-label="提交说明" placeholder={`修改 ${name}`} value={summary} disabled={busy} onChange={event => setSummary(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void commit() }} />
      <UiButton size="sm" variant="primary" loading={busy} disabled={busy} tooltip="提交这次修改（Ctrl+S）" onClick={() => { void commit() }}>提交</UiButton>
      <UiButton size="sm" disabled={busy} onClick={() => { setDraft(file.source); setBase(file.source); setError(undefined) }}>放弃</UiButton>
    </div>}
  </div>
}

function HistoryView({ state, onOpen }: { state: CodeProjectState; onOpen: (path: string) => void }): React.ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null)
  const exists = useMemo(() => new Set(state.tree.map(file => file.path)), [state.tree])
  if (!state.log.length) return <UiEmpty className="h-full" title="还没有提交" description="修改工程文件后，每次提交都会记在这里。" />
  return <div className="min-h-0 flex-1 overflow-auto px-1 py-1" role="list" aria-label="提交记录">
    {state.log.map(entry => {
      const open = expanded === entry.oid; const title = entry.message.split('\n')[0]
      return <div key={entry.oid} role="listitem">
        <UiOptionButton variant="menu" size="sm" className="min-h-7 w-full min-w-0 gap-1.5" aria-expanded={open} onClick={() => setExpanded(open ? null : entry.oid)}>
          {open ? <ChevronDown size={UI_ICON_SIZE.xs} className="shrink-0 text-text3" aria-hidden="true" /> : <ChevronRight size={UI_ICON_SIZE.xs} className="shrink-0 text-text3" aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate text-left text-xs" title={entry.message}>{title}</span>
          <span className="shrink-0 text-2xs text-text3" title={new Date(entry.time).toLocaleString()}>{formatTimeAgo(Date.parse(entry.time))}</span>
        </UiOptionButton>
        {open && entry.paths.map(path => <div key={path} className="pl-5"><UiOptionButton variant="menu" size="sm" className="min-h-7 w-full min-w-0 gap-1.5" disabled={!exists.has(path)} disabledReason={exists.has(path) ? undefined : '这个文件已经不在工程里'} tooltip={exists.has(path) ? '打开当前版本' : undefined} onClick={() => onOpen(path)}>
          <FileIcon path={path} /><span className="min-w-0 flex-1 truncate text-left text-xs">{path}</span>
        </UiOptionButton></div>)}
      </div>
    })}
  </div>
}

/**
 * 代码面板：片子的代码工程（项目 `代码/` 文件夹）。文件树、打开文件查看与修改、提交记录；
 * 选中代码片段时标出它用到的文件和入口，外部改过待提交、素材用的是旧版本代码这两件事排在最上面。
 */
export function VideoEditCodeProjectPanel({ instance, onError, visible }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible: boolean }): React.ReactElement {
  const projectId = instance.document.id
  const root = useRef<HTMLDivElement>(null)
  const { state, error, refresh } = useCodeProject(projectId, visible, root)
  useSyncExternalStore(subscribeVideoEditCodeProjectView, videoEditCodeProjectViewRevision)
  const view = getVideoEditCodeProjectView(projectId)
  const [busy, setBusy] = useState<'commit' | 'upgrade' | null>(null)
  const closures = useMemo(() => clipCodeProjectClosures(instance.document, instance.activeSequenceId, instance.selection), [instance.document, instance.activeSequenceId, instance.selection])
  const used = useMemo(() => new Set(closures.flatMap(closure => [...closure.paths])), [closures])
  const entries = useMemo(() => new Set(closures.map(closure => closure.entry)), [closures])
  const usedFolders = useMemo(() => new Set([...used].flatMap(codeProjectAncestors)), [used])
  const entryKey = [...entries].join('\n')
  // 选中代码片段：展开到它的入口文件并滚到那一行
  useEffect(() => { if (visible && entryKey) revealVideoEditCodeProjectPaths(projectId, entryKey.split('\n')) }, [visible, projectId, entryKey])
  const changes = useMemo(() => new Map((state?.changes ?? []).map(change => [change.path, change.kind])), [state?.changes])
  const filtering = view.onlySelection && used.size > 0
  const rows = useMemo(() => state ? codeProjectRows(state.tree.map(file => file.path), new Set(view.expanded), filtering ? used : undefined) : [], [state, view.expanded, filtering, used])
  const entryIndex = rows.findIndex(row => entries.has(row.path))
  const outdated = useMemo(() => state ? outdatedProjectCodeMaterials(instance.document, state) : [], [instance.document, state])
  const openFile = view.openPath ? state?.files.find(file => file.path === view.openPath) : undefined
  const setView = (values: Parameters<typeof setVideoEditCodeProjectView>[1]): void => setVideoEditCodeProjectView(projectId, values)
  const openPath = (path: string): void => { revealVideoEditCodeProjectPaths(projectId, [path]); setView({ mode: 'files', openPath: path, highlight: null }) }
  const toggle = (path: string): void => setView({ expanded: view.expanded.includes(path) ? view.expanded.filter(value => value !== path) : [...view.expanded, path] })
  const act = async (kind: 'commit' | 'upgrade', task: (signal: AbortSignal) => Promise<void>): Promise<void> => {
    setBusy(kind)
    try { await task(new AbortController().signal) } catch (reason) { onError(reason) } finally { setBusy(null); refresh() }
  }
  const changedPaths = [...changes.keys()]
  const commitWorkspace = (): Promise<void> => act('commit', signal => commitVideoEditCodeProjectWorkspace(projectId, `提交外部修改：${changedPaths.slice(0, 3).join('、')}${changedPaths.length > 3 ? ` 等 ${changedPaths.length} 个文件` : ''}`, signal))
  const upgrade = (): Promise<void> => act('upgrade', signal => upgradeVideoEditProjectCodeMaterials(projectId, outdated.map(value => value.definitionId), signal))

  const renderRow = (row: CodeProjectRow): React.ReactElement => {
    const indent = { paddingLeft: Math.min(row.depth, 10) * INDENT_PX }
    if (row.kind === 'folder') return <div className="flex min-w-0 items-center px-1" role="treeitem" aria-level={row.depth + 1} aria-expanded={row.expanded} aria-selected={false} style={indent}>
      <UiOptionButton variant="menu" size="sm" className="min-h-7 w-full min-w-0 gap-1.5" onClick={() => { if (!filtering) toggle(row.path) }}>
        {row.expanded ? <ChevronDown size={UI_ICON_SIZE.xs} className="shrink-0 text-text3" aria-hidden="true" /> : <ChevronRight size={UI_ICON_SIZE.xs} className="shrink-0 text-text3" aria-hidden="true" />}
        <span className={`min-w-0 flex-1 truncate text-left text-xs ${usedFolders.size && !usedFolders.has(row.path) ? 'text-text3' : ''}`}>{row.name}</span>
      </UiOptionButton>
    </div>
    const change = changes.get(row.path)
    // 选中了代码片段时，它没用到的文件退后
    const dim = used.size > 0 && !used.has(row.path)
    return <div className="flex min-w-0 items-center px-1" role="treeitem" aria-level={row.depth + 1} aria-selected={view.openPath === row.path} style={indent} data-video-edit-code-project-path={row.path}>
      <UiOptionButton variant="menu" size="sm" active={view.openPath === row.path} className="min-h-7 w-full min-w-0 gap-1.5" onClick={() => openPath(row.path)}>
        <span className="w-3 shrink-0" aria-hidden="true" />
        <FileIcon path={row.path} />
        <span className={`min-w-0 flex-1 truncate text-left text-xs ${dim ? 'text-text3' : ''}`}>{row.name}</span>
        {change && <span className="shrink-0 text-2xs text-text2">{change === 'added' ? '新增' : change === 'deleted' ? '已删' : '已改'}</span>}
        {entries.has(row.path) && <span className="shrink-0 text-2xs text-text3">入口</span>}
      </UiOptionButton>
    </div>
  }

  const body = (): React.ReactNode => {
    if (error && !state) return <UiError className="h-full" title="代码工程未能读取" message={error} onRetry={refresh} />
    if (!state) return <UiLoading className="h-full" message="正在读取代码工程…" />
    if (!state.tree.length) return <UiEmpty className="h-full" title="还没有代码工程" description="让助手按片子结构建立工程后，文件会出现在这里。" />
    if (view.mode === 'history') return <HistoryView state={state} onOpen={openPath} />
    if (openFile) return <FileView key={openFile.path} projectId={projectId} file={openFile} uncommitted={changes.has(openFile.path)} highlight={view.highlight?.path === openFile.path && view.highlight.hash === openFile.hash ? view.highlight : undefined} users={codeMaterialsUsingProjectFile(instance.document, openFile.path)} onError={onError} onBack={() => setView({ openPath: null, highlight: null })} />
    return <div className="min-h-0 flex-1 py-1" role="tree" aria-label="代码工程文件">
      <UiVirtualList data={rows} getKey={row => `${row.kind}:${row.path}`} renderItem={renderRow} highlightedIndex={entryIndex >= 0 ? entryIndex : undefined} resetKey={filtering ? 'filtered' : 'all'} />
    </div>
  }
  const status = !state ? '' : view.mode === 'history' ? `最近 ${state.log.length} 次提交` : `${state.tree.length} 个文件${filtering ? ` · 所选片段用到 ${used.size} 个` : ''}`
  return <div ref={root} className="flex h-full min-h-0 flex-col" aria-label="代码面板">
    {state && changes.size > 0 && <Notice text={`外部改了 ${changes.size} 个文件，还没提交`} detail={changedPaths.join('\n')} action={<UiButton size="sm" variant="secondary" loading={busy === 'commit'} disabled={!!busy} onClick={() => { void commitWorkspace() }}>提交</UiButton>} />}
    {state && outdated.length > 0 && <Notice text={`${outdated.length} 个素材用的是旧版本代码`} detail={outdated.map(value => `${value.name}：${value.changedPaths.join('、')}`).join('\n')} action={<UiButton size="sm" variant="secondary" loading={busy === 'upgrade'} disabled={!!busy || changes.size > 0} disabledReason={changes.size > 0 ? '先提交外部修改' : undefined} tooltip="升级到最新提交，正在用旧版本的片段一并更新" onClick={() => { void upgrade() }}>升级</UiButton>} />}
    {body()}
    <UiToolbar variant="footer" aria-label="代码工具" tools={[
      { kind: 'action', id: 'only-selection', label: '只看所选片段用到的文件', icon: ListFilter, on: view.onlySelection, disabled: !used.size && !view.onlySelection, disabledReason: '先在时间线上选一个代码片段', onSelect: () => setView({ onlySelection: !view.onlySelection, mode: 'files', openPath: null }) },
      { kind: 'action', id: 'files', label: '文件', icon: FolderTree, on: view.mode === 'files', selection: 'mode', onSelect: () => setView({ mode: 'files' }) },
      { kind: 'action', id: 'history', label: '提交记录', icon: History, on: view.mode === 'history', selection: 'mode', onSelect: () => setView({ mode: 'history' }) },
    ]}>{status}</UiToolbar>
  </div>
}
