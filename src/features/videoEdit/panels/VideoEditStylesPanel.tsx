import { MemoryEntriesEditor } from '@/features/assistant'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Copy, FolderInput, FolderOutput, Link2, Pencil, RefreshCw, Sparkles, Star, Trash2, Wand2 } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu, type MenuItem } from '@/hooks/useContextMenu'
import { UI_COVER_FRAME_CLASS, UI_TEXT_META_CLASS, UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiIconButton, UiInput, UiModal, UiOptionButton, UiRecordItem, UiRecordList, UiSearchInput } from '@/components/ui'
import { useNotification } from '@/contexts/NotificationContext'
import { openDialog, saveDialog, toDisplaySrc } from '@/platform/desktopApi'
import { parseStyleGuide } from '@/core/videoEdit/styles/styleGuide'
import { henjiDialogExtensions } from '@/core/fileExtensions'
import { VIDEO_EDIT_STYLE_PACKAGE_EXTENSION } from '@/core/videoEdit/styles/templateSchemas'
import { getActiveVideoEditSequence, subscribeVideoEditDomain, videoEditDomainRevision, type VideoEditInstance } from '../application/videoEditService'
import { videoEditStyleLibrary, type VideoEditLibraryStyle } from '../application/videoEditStyleLibrary'
import { bindVideoEditStyle, newerLibraryStyleVersion, unbindVideoEditStyle } from '../application/videoEditStyles'
import { exportVideoEditStylePackage, importVideoEditStylePackage } from '../application/videoEditStylePackages'
import { renderVideoEditStyle } from '../application/videoEditStyleRender'
import { applyVideoEditTemplate } from '../application/videoEditTemplates'
import { askAssistantForStyleTemplates, askAssistantToCreateStyle } from '../application/videoEditStyleAssistant'
import { VideoEditPresetPlayer } from './VideoEditPresetPlayer'

const FILTERS = [{ name: '痕迹AI风格包', extensions: [VIDEO_EDIT_STYLE_PACKAGE_EXTENSION] }]
const OPEN_FILTERS = [{ name: '痕迹AI风格包', extensions: henjiDialogExtensions('style_package') }]
const TILE = { width: 320, height: 180 }
const DETAIL = { width: 640, height: 360 }
function meta(entry: VideoEditLibraryStyle, isDefault: boolean, bound: boolean): string {
  return [isDefault ? '默认' : '', bound ? '本序列' : '', entry.builtin ? '内置' : '', entry.style.version ? `v${entry.style.version}` : '未渲染'].filter(Boolean).join(' · ')
}
/** 卡片画面：有缩略图就用渲染好的缩略图，没有就实时画样片的缩略图时刻。 */
function StylePicture({ entry, size, playing, label }: { entry: VideoEditLibraryStyle; size: typeof TILE; playing: boolean; label: string }): React.ReactElement {
  const source = useMemo(() => ({ category: 'style' as const, sample: entry.style.sample, trustContext: entry.style.foreign ? [entry.style.foreign] : [] }), [entry.style.sample, entry.style.foreign])
  if (entry.media.thumbnail && !playing) return <img className="block h-full w-full object-cover" src={toDisplaySrc(entry.media.thumbnail)} alt={label} draggable={false} />
  if (entry.media.preview && playing) return <video className="block h-full w-full object-cover" src={toDisplaySrc(entry.media.preview)} aria-label={label} autoPlay loop muted playsInline />
  return <VideoEditPresetPlayer source={source} size={size} playing={playing} label={label} trustAction={size === DETAIL} />
}

/** 风格详情：样片预览、锚点帧、说明书与成员模板；绑定是这里唯一的主动作。 */
function StyleDetail({ entry, instance, onClose, onError }: { entry: VideoEditLibraryStyle; instance: VideoEditInstance; onClose: () => void; onError: (reason: unknown) => void }): React.ReactElement {
  const { showNotification } = useNotification()
  const [busy, setBusy] = useState(false); const [anchor, setAnchor] = useState<string | null>(null)
  const sequenceId = instance.activeSequenceId
  const templates = videoEditStyleLibrary.listTemplates(entry.style.id)
  const run = async (action: () => Promise<void>): Promise<void> => { setBusy(true); try { await action() } catch (reason) { onError(reason) } finally { setBusy(false) } }
  const sections = parseStyleGuide(entry.style.guide).filter(section => section.body.replace(/<!--[\s\S]*?-->/g, '').trim())
  return <UiModal isOpen title={`${entry.style.name}${entry.style.version ? ` v${entry.style.version}` : ''}`} size="editor" onClose={onClose} footer={<>
    <UiButton variant="secondary" disabled={busy} onClick={() => { void run(async () => { await exportStyle(entry, showNotification) }) }}>导出</UiButton>
    <UiButton variant="primary" loading={busy} disabled={!sequenceId} disabledReason={!sequenceId ? '先打开一个序列' : undefined} onClick={() => { void run(async () => { const result = await bindVideoEditStyle(instance.document.id, sequenceId!, entry.style.id, { replace: true }); showNotification(`本序列之后按风格“${result.style.name}” v${result.style.version} 创作。`); onClose() }) }}>绑定到当前序列</UiButton>
  </>}>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]" data-video-edit-style-detail={entry.style.id}>
      <div className="flex min-w-0 flex-col gap-4">
        <span className={`${UI_COVER_FRAME_CLASS} block aspect-video w-full overflow-hidden`}>
          {anchor ? <img className="block h-full w-full object-contain" src={toDisplaySrc(anchor)} alt="锚点帧" /> : <StylePicture entry={entry} size={DETAIL} playing label={`${entry.style.name}样片`} />}
        </span>
        {entry.media.anchors.length > 0 && <div className="grid grid-cols-5 gap-2" role="list" aria-label="锚点帧">
          {entry.media.anchors.map((path, index) => <div role="listitem" key={path} className="min-w-0">
            <UiOptionButton variant="cover" active={anchor === path} className="w-full min-w-0" aria-label={`锚点帧 ${index + 1}`} onClick={() => setAnchor(anchor === path ? null : path)}>
              <span className={`${UI_COVER_FRAME_CLASS} block aspect-video w-full overflow-hidden`}><img className="block h-full w-full object-cover" src={toDisplaySrc(path)} alt="" draggable={false} /></span>
            </UiOptionButton>
          </div>)}
        </div>}
        <UiGroup title="成员模板" titleTone="compact">
          {templates.length ? <UiRecordList>{templates.map((value, index) => <UiRecordItem key={value.template.id} index={index} density="compact" title={value.template.name} meta={[value.template.body.kind === 'code' ? '代码' : '文字图形', `v${value.template.version}`]}
            actions={<UiButton size="sm" disabled={busy || !sequenceId} disabledReason="先打开一个序列" onClick={() => { void run(async () => { await applyVideoEditTemplate(instance.document.id, sequenceId!, 'library', value.template.id); showNotification(`已在播放头加入“${value.template.name}”。`) }) }}>应用</UiButton>}>
            {value.template.description && <p className={UI_TEXT_META_CLASS}>{value.template.description}</p>}
          </UiRecordItem>)}</UiRecordList> : <UiEmpty size="sm" title="还没有模板" />}
          <div><UiButton size="sm" disabled={busy} onClick={() => { askAssistantForStyleTemplates(instance.document.id, entry.style.id, entry.style.name); onClose() }}><Wand2 />按“组件”生成模板</UiButton></div>
        </UiGroup>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {entry.style.description && <p className="text-13 leading-6 text-text1">{entry.style.description}</p>}
        <MemoryEntriesEditor title="使用者偏好" target={{ layer: 'style', ownerId: entry.style.id }} />
        {sections.map((section, index) => <UiGroup key={`${section.title}-${index}`} title={section.title || undefined} titleTone="compact">
          <p className="whitespace-pre-wrap text-13 leading-6 text-text1">{section.body.replace(/<!--[\s\S]*?-->/g, '').replace(/^#\s+.*\n?/, '').replace(/^>\s?/gm, '').trim()}</p>
        </UiGroup>)}
      </div>
    </div>
  </UiModal>
}
async function exportStyle(entry: VideoEditLibraryStyle, notify: (message: string) => void): Promise<void> {
  const path = await saveDialog({ defaultPath: `${entry.style.name}.${VIDEO_EDIT_STYLE_PACKAGE_EXTENSION}`, filters: FILTERS }); if (!path) return
  const result = await exportVideoEditStylePackage(entry.style.id, path, { overwrite: true })
  notify(`已导出“${result.style.name}”${result.templates.length ? `（含 ${result.templates.length} 个模板）` : ''}。`)
}

/**
 * 风格面板（Frameflow“预设 → 风格”）：风格卡片看缩略图与样片，单击放大查看，右键设默认、导出、重命名、删除；
 * 导入风格包、让助手创建风格。绑定决定助手在这个序列里按哪份说明书创作，不改时间线。
 */
function Panel({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible?: boolean }): React.ReactElement {
  const { showNotification } = useNotification()
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const [query, setQuery] = useState(''); const [open, setOpen] = useState<string | null>(null); const [hovered, setHovered] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null); const [busy, setBusy] = useState<string | null>(null)
  const menu = useContextMenu()
  useEffect(() => { void videoEditStyleLibrary.ready().catch(onError) }, [onError])
  const sequence = instance.activeSequenceId ? getActiveVideoEditSequence(instance) : undefined
  const bound = sequence?.styleId ? instance.document.styles?.find(style => style.id === sequence.styleId) : undefined
  const newer = bound ? newerLibraryStyleVersion(bound) : null
  const defaultId = videoEditStyleLibrary.defaultStyleId()
  const entries = videoEditStyleLibrary.listStyles().filter(entry => !query.trim() || `${entry.style.name} ${entry.style.description}`.toLowerCase().includes(query.trim().toLowerCase()))
  const detail = open ? videoEditStyleLibrary.findStyle(open) : undefined
  const run = async (key: string, action: () => Promise<void> | void): Promise<void> => { setBusy(key); try { await action() } catch (reason) { onError(reason) } finally { setBusy(null) } }
  const bind = (id: string, replace = true): Promise<void> => run(id, async () => { if (!sequence) throw new Error('先打开一个序列。'); const result = await bindVideoEditStyle(instance.document.id, sequence.id, id, { replace }); showNotification(`本序列之后按风格“${result.style.name}” v${result.style.version} 创作。`) })
  const items = (entry: VideoEditLibraryStyle): MenuItem[] => [
    { id: 'bind', label: '绑定到当前序列', icon: <Link2 />, disabled: !sequence, onClick: () => { void bind(entry.style.id) } },
    { id: 'default', label: defaultId === entry.style.id ? '取消默认' : '设为默认', icon: <Star />, onClick: () => { void run(entry.style.id, () => videoEditStyleLibrary.setDefaultStyle(defaultId === entry.style.id ? null : entry.style.id)) } },
    { id: 'export', label: '导出风格包…', icon: <FolderOutput />, onClick: () => { void run(entry.style.id, () => exportStyle(entry, showNotification)) } },
    ...(entry.builtin ? [{ id: 'copy', label: '复制为个人风格', icon: <Copy />, onClick: () => { void run(entry.style.id, async () => { const copy = await videoEditStyleLibrary.saveStyle({ ...entry.style, id: crypto.randomUUID(), name: `${entry.style.name} 副本`.slice(0, 80), version: 0, contentHash: '' }); showNotification(`已复制为“${copy.style.name}”，可以修改后重新渲染。`) }) } }] : [
      { id: 'render', label: entry.stale || !entry.style.version ? '渲染预览' : '重新渲染预览', icon: <RefreshCw />, onClick: () => { void run(entry.style.id, async () => { const result = await renderVideoEditStyle(entry.style.id, new AbortController().signal); showNotification(`“${entry.style.name}”已渲染为 v${result.version}。${result.warnings.join('')}`) }) } },
      { id: 'rename', label: '重命名…', icon: <Pencil />, onClick: () => setRenaming({ id: entry.style.id, name: entry.style.name }) },
      { id: 'delete', label: '删除', icon: <Trash2 />, divider: true, onClick: () => { void run(entry.style.id, () => videoEditStyleLibrary.removeStyle(entry.style.id)) } },
    ]),
  ]
  const importFile = async (): Promise<void> => {
    const selected = await openDialog({ multiple: false, filters: OPEN_FILTERS }); const path = Array.isArray(selected) ? selected[0] : selected; if (!path) return
    await run('import', async () => {
      let result
      try { result = await importVideoEditStylePackage(path) }
      catch (error) { if (!(error instanceof Error) || !error.message.includes('replace')) throw error; result = await importVideoEditStylePackage(path, { replace: true }) }
      showNotification(`已导入风格“${result.style.name}” v${result.style.version}${result.templates.length ? `和 ${result.templates.length} 个模板` : ''}。`); setOpen(result.style.id)
    })
  }
  return <div className="flex h-full min-h-0 flex-col gap-2 px-3 py-3" aria-label="风格" data-video-edit-styles>
    <div className="flex items-center gap-1">
      <UiSearchInput size="sm" className="min-w-0 flex-1" aria-label="搜索风格" placeholder="搜索风格" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel="清除搜索" />
      <UiIconButton size="sm" label="导入风格包" loading={busy === 'import'} onClick={() => { void importFile() }}><FolderInput /></UiIconButton>
      <UiIconButton size="sm" label="让助手创建风格" onClick={() => askAssistantToCreateStyle(instance.document.id)}><Sparkles /></UiIconButton>
    </div>
    {videoEditStyleLibrary.loadError() && <UiError size="sm" message={videoEditStyleLibrary.loadError()} />}
    {sequence && <UiGroup labelWidth={72}>
      <UiFormRow label="本序列" density="compact" trailing={bound ? <UiButton size="sm" disabled={Boolean(busy)} tooltip="助手不再按这个风格创作；已经做好的内容不变" onClick={() => { void run('unbind', () => unbindVideoEditStyle(instance.document.id, sequence.id)) }}>取消绑定</UiButton> : null}>
        <span className="flex min-w-0 items-center gap-2 text-13 text-text1">
          <span className="truncate">{bound ? `${bound.name} v${bound.version}` : '未绑定风格'}</span>
          {newer && <UiButton size="sm" variant="link" onClick={() => { void bind(bound!.id) }}>升级到 v{newer}</UiButton>}
        </span>
      </UiFormRow>
    </UiGroup>}
    <div className="min-h-0 flex-1 overflow-y-auto">
      {entries.length
        ? <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3" role="list" aria-label="风格">
          {visible && entries.map(entry => <div role="listitem" key={entry.style.id} className="min-w-0">
            <UiOptionButton variant="cover" active={bound?.id === entry.style.id} className="w-full min-w-0" data-video-edit-style={entry.style.id}
              onPointerEnter={() => setHovered(entry.style.id)} onPointerLeave={() => setHovered(null)} onClick={() => setOpen(entry.style.id)}
              onContextMenu={event => { event.preventDefault(); menu.showMenu(event, items(entry)) }} aria-label={`${entry.style.name}，${meta(entry, defaultId === entry.style.id, bound?.id === entry.style.id)}，单击查看，右键更多操作`}>
              <span className={`${UI_COVER_FRAME_CLASS} block aspect-video w-full overflow-hidden`}><StylePicture entry={entry} size={TILE} playing={hovered === entry.style.id} label={`${entry.style.name}预览`} /></span>
              <span className="block w-full min-w-0 px-0.5">
                <span className="block truncate text-xs text-text1">{entry.style.name}</span>
                <span className={`block truncate ${UI_TEXT_META_CLASS}`}>{busy === entry.style.id ? '处理中…' : meta(entry, defaultId === entry.style.id, bound?.id === entry.style.id)}</span>
              </span>
            </UiOptionButton>
          </div>)}
        </div>
        : <UiEmpty size="sm" title={query ? '没有匹配的风格' : '风格库还在读取'} />}
    </div>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} onClose={menu.hideMenu} visible={menu.menuVisible} />
    {detail && <StyleDetail entry={detail} instance={instance} onClose={() => setOpen(null)} onError={onError} />}
    {renaming && <UiModal isOpen title="重命名风格" size="compact" onClose={() => setRenaming(null)} footer={<>
      <UiButton variant="secondary" onClick={() => setRenaming(null)}>取消</UiButton>
      <UiButton variant="primary" disabled={!renaming.name.trim()} onClick={() => { const target = renaming; setRenaming(null); void run(target.id, async () => { const entry = videoEditStyleLibrary.requireStyle(target.id); await videoEditStyleLibrary.saveStyle({ ...entry.style, name: target.name.trim().slice(0, 80), guide: entry.style.guide.startsWith(`# ${entry.style.name}`) ? entry.style.guide.replace(`# ${entry.style.name}`, `# ${target.name.trim()}`) : entry.style.guide }) }) }}>重命名</UiButton>
    </>}>
      <UiFormRow label="名称"><UiInput aria-label="风格名称" value={renaming.name} maxLength={80} onChange={event => setRenaming({ ...renaming, name: event.target.value })} /></UiFormRow>
    </UiModal>}
  </div>
}
export function VideoEditStylesPanel(props: Parameters<typeof Panel>[0]): React.ReactElement { return <Panel {...props} /> }
