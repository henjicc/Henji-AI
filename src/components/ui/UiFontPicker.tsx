import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Star, Trash2, Upload } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import PanelTrigger from './PanelTrigger'
import Dropdown from './Dropdown'
import { UiButton, UiFieldTrigger, UiIconButton, UiOptionButton, UiSearchInput } from './primitives'
import { UiEmpty, UiError, UiLoading } from './states'
import { cssFontFamily, filterFonts, type FontFaceInfo, type FontFilter } from '@/core/fonts/catalog'
import { favoriteFont, fontLibrarySnapshot, importFonts, loadFontLibrary, readFontPayload, rememberFont, removeFont, resolveFont, subscribeFontLibrary } from '@/platform/fonts'
import { loadDocumentFont, retainDocumentFonts, pinDocumentFonts, releaseDocumentFonts } from '@/platform/fontFaces'

export interface UiFontPickerProps {
  value: string
  ariaLabel?: string
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  projectFonts?: readonly string[]
  onSelect: (name: string, face: FontFaceInfo) => void
  /** Temporary preview only; null means restore the baseline. */
  onPreview?: (face: FontFaceInfo | null) => void
}
const FILTERS: Array<{ value: FontFilter; label: string }> = [
  { value: 'all', label: '全部' }, { value: 'cjk', label: '中文' }, { value: 'latin', label: '英文' },
  { value: 'serif', label: '衬线' }, { value: 'sans-serif', label: '无衬线' }, { value: 'monospace', label: '等宽' }, { value: 'handwriting', label: '手写' },
  { value: 'imported', label: '已导入' }, { value: 'favorites', label: '收藏' }, { value: 'recent', label: '最近使用' }, { value: 'project', label: '本工程已用' },
]
function FontRow({ face, active, selected, favorite, onPreview, onSelect, onError, optionId }: { face: FontFaceInfo; active: boolean; selected: boolean; favorite: boolean; onPreview: () => void; onSelect: () => void; onError: (error: unknown) => void; optionId: string }): React.ReactElement {
  const [ready, setReady] = useState(false)
  const owner = useRef({})
  useEffect(() => {
    let current = true
    if (face.id.startsWith('generic:')) { setReady(true); return }
    pinDocumentFonts(owner.current, [face.id])
    void readFontPayload(face).then(loadDocumentFont).then(() => { if (current) setReady(true) }, error => { if (current) onError(error) })
    const identity = owner.current
    return () => { current = false; releaseDocumentFonts(identity) }
  }, [face.id, face, onError])
  return <div className="flex items-center gap-1" onPointerEnter={onPreview}>
    <UiOptionButton id={optionId} role="option" aria-selected={selected} variant="menu" size="md" active={active || selected} className="min-w-0 flex-1 justify-between gap-3" onClick={onSelect}>
      <span className="min-w-0 truncate" style={{ fontFamily: ready ? cssFontFamily(face.fullName) : undefined }}>{face.localizedFamily}</span>
      <span className="shrink-0 text-sm text-text2" style={{ fontFamily: ready ? cssFontFamily(face.fullName) : undefined }}>{face.supportsCjk ? '痕迹 永 Aa' : 'Aa Bb 123'}</span>
    </UiOptionButton>
    <UiIconButton size="sm" on={favorite} aria-label={`${favorite ? '取消收藏' : '收藏'}${face.localizedFamily}`} onClick={() => favoriteFont(face.family)}><Star className="h-3.5 w-3.5" /></UiIconButton>
  </div>
}

/** One font selection interaction for all workspaces; PanelTrigger owns its surface and overlay lifecycle. */
/** react-virtuoso's root inline height:100% beats a class; inside an auto-height popover that resolved to 0 and hid every row. */
const FONT_LIST_STYLE = { height: 288 } as const

export function UiFontPicker({ value, ariaLabel = '选择字体', size = 'md', disabled, projectFonts, onSelect, onPreview }: UiFontPickerProps): React.ReactElement {
  const library = useSyncExternalStore(subscribeFontLibrary, fontLibrarySnapshot)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FontFilter>('all')
  const [active, setActive] = useState(-1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const list = useRef<VirtuosoHandle>(null)
  const search = useRef<HTMLInputElement>(null)
  const epoch = useRef(0)
  const fontOwner = useRef({})
  const preview = useRef(onPreview); preview.current = onPreview
  const selectedCallback = useRef(onSelect); selectedCallback.current = onSelect
  const optionPrefix = useId()
  // Hosts re-render on every edit (drags included): resolve the value and the project list only when their inputs change.
  const current = useMemo(() => library.faces.find(face => face.fullName === value) ?? resolveFont(value), [library.faces, value])
  const projectKey = (projectFonts ?? []).join('\n')
  const projectList = useMemo(() => projectKey ? projectKey.split('\n') : [], [projectKey])
  useEffect(() => { const owner = fontOwner.current; pinDocumentFonts(owner, current ? [current.id] : []); return () => releaseDocumentFonts(owner) }, [current])
  const familyRows = useMemo(() => {
    // The list exists only inside the open panel; never filter and sort hundreds of system faces while closed.
    if (!open) return []
    const filtered = filterFonts(library.faces, query, filter, library.preferences, projectList)
    const groups = new Map<string, FontFaceInfo>()
    for (const face of filtered) {
      const key = face.family.toLocaleLowerCase(); const existing = groups.get(key)
      if (!existing || Math.abs(face.weight - 400) + Number(face.italic) * 1000 < Math.abs(existing.weight - 400) + Number(existing.italic) * 1000) groups.set(key, face)
    }
    const rows = [...groups.values()]
    return filter === 'recent' ? rows.sort((a, b) => library.preferences.recent.indexOf(a.family) - library.preferences.recent.indexOf(b.family)) : rows.sort((a, b) => a.localizedFamily.localeCompare(b.localizedFamily, 'zh-CN'))
  }, [open, library.faces, library.preferences, query, filter, projectList])
  const styles = useMemo(() => current ? library.faces.filter(face => face.family === current.family) : [], [current, library.faces])
  useEffect(() => { retainDocumentFonts(library.faces) }, [library.faces])
  useEffect(() => { void loadFontLibrary().catch(() => undefined) }, [])
  useEffect(() => { setActive(-1); epoch.current++; preview.current?.(null) }, [query, filter])
  useEffect(() => () => { epoch.current++; preview.current?.(null) }, [])
  useEffect(() => { if (open) search.current?.focus() }, [open])
  const report = useRef((reason: unknown): void => { setError(reason instanceof Error ? reason.message : '字体无法加载，请重新选择。') }).current
  const ensure = async (face: FontFaceInfo): Promise<void> => { pinDocumentFonts(fontOwner.current, current ? [current.id, face.id] : [face.id]); if (!face.id.startsWith('generic:')) await loadDocumentFont(await readFontPayload(face)) }
  useEffect(() => { if (current && !current.id.startsWith('generic:')) void readFontPayload(current).then(loadDocumentFont).catch(report) }, [current, report])
  const showPreview = (face: FontFaceInfo): void => {
    const token = ++epoch.current
    void ensure(face).then(() => { if (token === epoch.current) preview.current?.(face) }, report)
  }
  const restore = (): void => { epoch.current++; preview.current?.(null); pinDocumentFonts(fontOwner.current, current ? [current.id] : []) }
  const choose = (face: FontFaceInfo): void => {
    const token = ++epoch.current
    void ensure(face).then(() => {
      if (token !== epoch.current) return
      preview.current?.(null)
      selectedCallback.current(face.fullName, face)
      rememberFont(face.family); setOpen(false)
    }, report)
  }
  const perform = async (operation: () => Promise<void>): Promise<void> => { setBusy(true); setError(''); restore(); try { await operation() } catch (reason) { report(reason) } finally { setBusy(false) } }
  return <div className="flex min-w-0 flex-col gap-1" data-ui-font-picker>
    <PanelTrigger size={size} panelWidth={384} panelPadding="content" open={open} onOpenChange={next => { if (!next) restore(); else void loadFontLibrary(true).catch(report); setOpen(next) }} renderPanel={() => <div className="flex min-w-0 flex-col gap-2" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); restore(); setOpen(false) }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation()
        const next = Math.max(0, Math.min(familyRows.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)))
        setActive(next); list.current?.scrollIntoView({ index: next }); if (familyRows[next]) showPreview(familyRows[next])
      }
      if (event.key === 'Enter' && familyRows[active]) { event.preventDefault(); event.stopPropagation(); choose(familyRows[active]) }
    }}>
      <div className="flex items-center gap-2"><UiSearchInput ref={search} aria-label="搜索字体" placeholder="搜索中文名或英文名" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel="清除字体搜索" /><UiIconButton aria-label="导入字体" disabled={busy} onClick={() => { void perform(importFonts) }}><Upload className="h-4 w-4" /></UiIconButton></div>
      <Dropdown<FontFilter> ariaLabel="字体分类" size="sm" value={filter} options={FILTERS} onSelect={setFilter} />
      {(error || library.error) && <UiError size="xs" message={error || library.error} onRetry={() => { setError(''); void loadFontLibrary(true).catch(report) }} />}
      {library.loading && <UiLoading size="xs" message="正在读取本机字体…" />}
      {familyRows.length ? <div role="listbox" aria-label="字体列表" aria-activedescendant={active >= 0 ? `${optionPrefix}-${active}` : undefined} onPointerLeave={restore}>
        <Virtuoso ref={list} style={FONT_LIST_STYLE} data={familyRows} computeItemKey={(_index, face) => face.id} initialItemCount={Math.min(8, familyRows.length)} itemContent={(index, face) => <FontRow face={face} optionId={`${optionPrefix}-${index}`} active={active === index} selected={current?.family === face.family} favorite={library.preferences.favorites.includes(face.family)} onPreview={() => { setActive(index); showPreview(face) }} onSelect={() => choose(face)} onError={report} /> } />
      </div> : !library.loading && <UiEmpty size="xs" title="没有匹配的字体" action={<UiButton size="sm" disabled={busy} onClick={() => { void perform(importFonts) }}>导入字体</UiButton>} />}
      {current?.imported && <UiButton variant="danger" size="sm" disabled={busy} onClick={() => { void perform(() => removeFont(current.id)) }}><Trash2 className="h-3.5 w-3.5" />删除此导入字体</UiButton>}
    </div>}>
      {({ togglePanel, open: expanded }) => <UiFieldTrigger size={size} className="w-full" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={expanded} open={expanded} data-panel-trigger-button onClick={togglePanel}><span style={{ fontFamily: cssFontFamily(value) }}>{current?.localizedFamily ?? value}</span></UiFieldTrigger>}
    </PanelTrigger>
    {styles.length > 1 && <Dropdown ariaLabel={`${ariaLabel}样式`} size={size} disabled={disabled} value={current?.id ?? ''} options={styles.map(face => ({ value: face.id, label: face.style }))} onSelect={id => { const face = styles.find(face => face.id === id); if (face) choose(face) }} />}
  </div>
}
