import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso'
import { ChevronDown, ChevronRight, Folder, FolderPlus, Import, List, Grid2X2, Plus, Pencil, Trash2, RefreshCw, Play, Settings2, Code2, AudioLines } from 'lucide-react'
import { ICON_WORKSPACE_VIDEO_EDIT as SequenceIcon, ICON_ASSET_LIBRARY as AssetLibraryIcon, ICON_VIDEO_EDIT_GRAPHIC as GraphicIcon } from '@/core/theme/icons'
import ContextMenu from '@/components/ContextMenu'
import { PanelTrigger, UiChipButton, UiEmpty, UiIconButton, UiSearchInput, UiOptionButton } from '@/components/ui'
import { UI_DIVIDER_CLASS } from '@/components/ui/styleTokens'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { useContextMenu, type MenuItem } from '@/hooks/useContextMenu'
import { openAssetLibrary } from '@/stores/navigationStore'
import { videoEditSequenceFromItem, type VideoEditSequenceSettings } from '@/core/videoEdit/projectItems'
import type { VideoEditBin } from '@/core/videoEdit/document'
import { acceptsVideoEditDrop, dropVideoEditInput, readVideoEditDrop, writeVideoEditItemDrag } from '../application/videoEditDrop'
import { appendVideoEditSequence, deleteVideoEditSequence, setVideoEditProjectView, switchVideoEditSequence, updateVideoEditSequenceSettings, type VideoEditInstance } from '../application/videoEditService'
import { chooseVideoEditMedia, relinkVideoEditMedia } from '../application/videoEditMedia'
import { appendVideoEditItems, createVideoEditAdjustmentItem, createVideoEditBin, createVideoEditGraphicItem, createVideoEditSequenceFromItem, deleteVideoEditBins, deleteVideoEditItems, updateVideoEditBin, updateVideoEditItems, type VideoEditGraphicItemInput } from '../application/videoEditProjectItems'
import { updateVideoEditSource } from '../application/videoEditSource'
import { VideoEditSequenceDialog } from './VideoEditSequenceDialog'
import { VideoEditProjectEditDialog, type ProjectEditDialog } from './VideoEditProjectEditDialog'
import { VideoEditProjectThumbnail } from './VideoEditProjectThumbnail'
import { VideoEditCodeCreateDialog } from './VideoEditCodeCreateDialog'
import { VideoEditAudioChannelsDialog, type VideoEditAudioChannelsTarget } from './VideoEditAudioChannelsDialog'
import { VideoEditProjectDocumentsButton } from './VideoEditProjectDocuments'
import { readVideoEditCodeMetadata } from '../application/videoEditCodeState'
import { selectVideoEditProjectItems, videoEditBinRows, videoEditProjectEntries, type VideoEditProjectEntry } from './videoEditProjectModel'

const GridList = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => <div {...props} ref={ref} className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-1 px-1.5 pb-1.5" />)
GridList.displayName = 'VideoEditProjectGridList'
const GridItem = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => <div {...props} ref={ref} className="min-w-0" />)
GridItem.displayName = 'VideoEditProjectGridItem'
const gridComponents = { List: GridList, Item: GridItem }
const SORT_OPTIONS = [{ value: 'name', label: '名称' }, { value: 'kind', label: '类型' }, { value: 'duration', label: '时长' }] as const
type SequenceDialog = { kind: 'create' | 'edit' | 'fromItem'; settings: VideoEditSequenceSettings; id?: string; requireFrameRate?: boolean }

/** 素材箱树放得下根目录名称所需的宽度（“素材根目录”五个字 + 图标 + 内边距约 96px）；树最多占面板宽的 40% */
const BIN_TREE_LABEL_MIN_WIDTH = 96
const BIN_TREE_MAX_RATIO = 0.4

export function VideoEditProjectPanel({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible?: boolean }): React.ReactElement {
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<'name' | 'kind' | 'duration'>('name')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // 面板窄到素材箱树放不下“素材根目录”时（窄停靠面板，如 960 宽窗口），树收成一列图标、名称进悬停说明，
  // 让出宽度给素材项列表；不把根目录截成“项目…”（5.8 shortTextTruncated）。按面板宽度判断，避免收起后自己变窄回不来。
  const binTreeRef = useRef<HTMLDivElement>(null)
  const [compactBinTree, setCompactBinTree] = useState(false)
  useLayoutEffect(() => {
    const host = binTreeRef.current?.parentElement
    if (!host || typeof ResizeObserver === 'undefined') return
    const update = (): void => setCompactBinTree(host.clientWidth * BIN_TREE_MAX_RATIO < BIN_TREE_LABEL_MIN_WIDTH)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])
  const [edit, setEdit] = useState<ProjectEditDialog | null>(null)
  const [sequenceDialog, setSequenceDialog] = useState<SequenceDialog | null>(null)
  const [selectedSequence, setSelectedSequence] = useState<string | null>(null)
  const [creatingCode, setCreatingCode] = useState(false)
  const [audioChannels, setAudioChannels] = useState<VideoEditAudioChannelsTarget | null>(null)
  const anchor = useRef<string | null>(null)
  const menu = useContextMenu()
  const projectId = instance.document.id
  const binId = instance.selectedBinId
  const entries = useMemo(() => videoEditProjectEntries(instance.document, binId, keyword, sort), [instance.document, binId, keyword, sort])
  const bins = useMemo(() => videoEditBinRows(instance.document.bins, collapsed), [instance.document.bins, collapsed])
  const media = useMemo(() => new Map(instance.document.media.map(value => [value.id, value])), [instance.document.media])
  const selectedItems = instance.document.items.filter(item => instance.selectedItemIds.includes(item.id))
  const run = (operation: () => unknown | Promise<unknown>): void => { void Promise.resolve().then(operation).catch(error => {
    if (error instanceof Error && /源预览请求已被更新|源预览已关闭/.test(error.message)) return
    onError(error)
  }) }
  const choose = (): void => run(() => chooseVideoEditMedia(projectId, binId || undefined))
  const newSequence = (): void => setSequenceDialog({ kind: 'create', settings: { name: `序列 ${instance.document.sequences.length + 1}`, binId: binId || undefined } })
  const selectCreatedItem = (id: string): void => {
    setKeyword('')
    setSelectedSequence(null)
    anchor.current = id
    setVideoEditProjectView(projectId, { selectedBinId: binId, selectedItemIds: [id] })
  }
  const createGraphic = (kind: VideoEditGraphicItemInput['kind']): void => run(() => selectCreatedItem(createVideoEditGraphicItem(projectId, { kind, binId: binId || undefined })))
  const createAdjustment = (): void => run(() => selectCreatedItem(createVideoEditAdjustmentItem(projectId, { binId: binId || undefined })))
  const graphicMenu = (): MenuItem[] => [
    { id: 'solid', label: '新建纯色', icon: <Plus size={16} />, onClick: () => createGraphic('solid') },
    { id: 'rect', label: '新建矩形', icon: <Plus size={16} />, onClick: () => createGraphic('rect') },
    { id: 'ellipse', label: '新建椭圆', icon: <Plus size={16} />, onClick: () => createGraphic('ellipse') },
    { id: 'text', label: '新建原生文字', icon: <Plus size={16} />, onClick: () => createGraphic('text') },
    { id: 'adjustment', label: '新建调整图层', icon: <Plus size={16} />, onClick: createAdjustment },
  ]
  const createFromItem = (id: string): void => {
    try {
      const item = instance.document.items.find(item => item.id === id)!
      const source = media.get(item.mediaId ?? '')
      const requireFrameRate = source?.kind === 'video' && (!source.frameRate || source.frameRateMode !== 'sampled-constant')
      const settings = requireFrameRate ? { name: item.name, binId: item.binId, width: source.width >= 16 ? source.width : 1920, height: source.height >= 16 ? source.height : 1080 } : videoEditSequenceFromItem(instance.document, id, {}, readVideoEditCodeMetadata(instance, instance.document))
      setSequenceDialog({ kind: 'fromItem', id, settings, requireFrameRate })
    } catch (error) { onError(error) }
  }
  const blankMenu = (): MenuItem[] => [
    { id: 'import', label: '导入文件', icon: <Import size={16} />, onClick: choose },
    { id: 'assets', label: '从资产库拖入', icon: <AssetLibraryIcon size={16} />, onClick: () => openAssetLibrary('floating') },
    { id: 'bin', label: '新建素材箱', icon: <FolderPlus size={16} />, onClick: () => setEdit({ kind: 'createBin', parentId: binId }) },
    { id: 'sequence', label: '新建素材项 → 序列', icon: <SequenceIcon size={16} />, onClick: newSequence },
    { id: 'code', label: '新建代码素材', icon: <Code2 size={16} />, onClick: () => setCreatingCode(true) },
    ...graphicMenu(),
  ]
  const itemMenu = (entry: VideoEditProjectEntry): MenuItem[] => {
    if (entry.kind === 'sequence') return [
      { id: 'open', label: '打开序列', icon: <Play size={16} />, onClick: () => run(() => switchVideoEditSequence(projectId, entry.value.id)) },
      { id: 'settings', label: '序列设置与重命名', icon: <Settings2 size={16} />, onClick: () => setSequenceDialog({ kind: 'edit', id: entry.value.id, settings: entry.value }) },
      { id: 'delete', label: '移除空序列', icon: <Trash2 size={16} />, disabled: instance.document.sequences.length <= 1 || !!entry.value.clips.length || !!entry.value.annotations.length, onClick: () => run(() => deleteVideoEditSequence(projectId, entry.value.id)) },
    ]
    const item = entry.value
    const ids = instance.selectedItemIds.includes(item.id) ? instance.selectedItemIds : [item.id]
    const items = instance.document.items.filter(value => ids.includes(value.id))
    // Premiere "Modify > Audio Channels": several items at once only when their files have the same sound streams.
    const sounding = items.map(value => media.get(value.mediaId ?? '')).filter(value => value && (value.kind === 'audio' || value.kind === 'video' && value.hasAudio !== false))
    const audioTarget: VideoEditAudioChannelsTarget | undefined = sounding.length === items.length && sounding[0] && (items.length === 1 || sounding.every(value => value!.audioStreams && JSON.stringify(value!.audioStreams) === JSON.stringify(sounding[0]!.audioStreams))) ? { kind: 'items', itemIds: items.map(value => value.id), mediaId: sounding[0].id, ...(items[0].audioChannels ? { layout: items[0].audioChannels } : {}) } : undefined
    return [
      { id: 'preview', label: '打开源素材', icon: <Play size={16} />, disabled: !item.mediaId, onClick: () => run(() => updateVideoEditSource(projectId, { itemId: item.id })) },
      { id: 'append', label: `添加${ids.length > 1 ? ` ${ids.length} 项` : ''}到当前序列`, icon: <Plus size={16} />, onClick: () => run(() => appendVideoEditItems(projectId, ids, instance.activeSequenceId)) },
      { id: 'sequence', label: item.kind === 'adjustment' ? '调整图层请添加到现有序列' : '按此素材新建序列', icon: <SequenceIcon size={16} />, disabled: ids.length !== 1 || item.kind === 'adjustment', onClick: () => createFromItem(item.id) },
      { id: 'edit', label: '重命名、标签与移动', icon: <Pencil size={16} />, onClick: () => setEdit({ kind: 'items', items }) },
      { id: 'audio_channels', label: '音频声道…', icon: <AudioLines size={16} />, disabled: !audioTarget, onClick: () => { if (audioTarget) setAudioChannels(audioTarget) } },
      { id: 'relink', label: '重新定位源文件', icon: <RefreshCw size={16} />, disabled: !item.mediaId || ids.length !== 1, onClick: () => run(() => relinkVideoEditMedia(projectId, item.mediaId!)) },
      { id: 'remove', label: `从素材移除${ids.length > 1 ? ` ${ids.length} 项` : ''}`, icon: <Trash2 size={16} />, onClick: () => run(() => deleteVideoEditItems(projectId, ids)) },
    ]
  }
  const selectBin = (id: string): void => { anchor.current = null; setSelectedSequence(null); run(() => setVideoEditProjectView(projectId, { selectedBinId: id, selectedItemIds: [] })) }
  const drop = (event: React.DragEvent, targetBin = binId): void => {
    if (!acceptsVideoEditDrop(event.dataTransfer)) return
    event.preventDefault(); event.stopPropagation()
    try {
      const input = readVideoEditDrop(event.dataTransfer)
      run(async () => {
        const ids = await dropVideoEditInput(projectId, input, undefined, targetBin || undefined)
        if (input.kind === 'items') updateVideoEditItems(projectId, ids, { binId: targetBin || null })
        setVideoEditProjectView(projectId, { selectedBinId: targetBin, selectedItemIds: ids })
      })
    } catch (error) { onError(error) }
  }
  const renderEntry = (_index: number, entry: VideoEditProjectEntry): React.ReactElement => {
    const itemMedia = entry.kind === 'item' ? media.get(entry.value.mediaId ?? '') : undefined
    const selected = entry.kind === 'item' ? instance.selectedItemIds.includes(entry.value.id) : selectedSequence === entry.value.id
    const kind = entry.kind === 'sequence' ? 'sequence' : entry.value.kind
    const graphic = entry.kind === 'item' && kind === 'graphic' ? entry.value.graphic : undefined
    const detail = entry.kind === 'sequence' ? `${entry.value.width} × ${entry.value.height} · ${Number((entry.value.frameRate.numerator / entry.value.frameRate.denominator).toFixed(3))} fps` : itemMedia ? `${itemMedia.kind === 'audio' ? '音频' : `${itemMedia.width} × ${itemMedia.height}`}${itemMedia.durationSeconds ? ` · ${itemMedia.durationSeconds.toFixed(1)} 秒` : ''}${itemMedia.assetId ? ' · 来自资产库' : ''}` : graphic ? `可编辑图形 · ${graphic.width} × ${graphic.height}` : kind === 'adjustment' ? '调整图层 · 添加到现有序列上方画面轨道' : kind === 'code' ? '原生代码素材' : '文字'
    // 列表行（设计稿 VideoEdit 素材面板）：缩略图 52×30 + 名称（12/500）+ 规格（11 辅助文字）；网格视图为封面 + 名称。
    return <UiOptionButton variant="menu" size="sm" active={selected} selection={entry.kind === 'item' ? 'multiple' : 'single'} className={`w-full min-w-0 ${view === 'grid' ? 'flex-col items-stretch gap-1.5 !p-1.5' : 'min-h-11 gap-2.5 !px-1.5'}`} data-video-edit-project-entry={entry.value.id} data-entry-kind={kind} aria-label={entry.value.name} aria-pressed={selected} draggable={entry.kind === 'item'}
      onClick={event => {
        if (entry.kind === 'sequence') { setSelectedSequence(entry.value.id); run(() => setVideoEditProjectView(projectId, { selectedItemIds: [] })); return }
        setSelectedSequence(null)
        const ids = entries.filter((value): value is Extract<VideoEditProjectEntry, { kind: 'item' }> => value.kind === 'item').map(value => value.value.id)
        const selection = selectVideoEditProjectItems(ids, instance.selectedItemIds, entry.value.id, anchor.current, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey })
        if (!event.shiftKey) anchor.current = entry.value.id
        run(() => setVideoEditProjectView(projectId, { selectedItemIds: selection }))
      }}
      onDoubleClick={event => { event.stopPropagation(); run(() => entry.kind === 'sequence' ? switchVideoEditSequence(projectId, entry.value.id) : entry.value.mediaId ? updateVideoEditSource(projectId, { itemId: entry.value.id }) : appendVideoEditItems(projectId, [entry.value.id], instance.activeSequenceId)) }}
      onContextMenu={event => { if (entry.kind === 'item' && !selected) run(() => setVideoEditProjectView(projectId, { selectedItemIds: [entry.value.id] })); menu.showMenu(event, itemMenu(entry)) }}
      onDragStart={event => { if (entry.kind !== 'item') return; writeVideoEditItemDrag(event.dataTransfer, projectId, selected ? instance.selectedItemIds : [entry.value.id]); event.dataTransfer.effectAllowed = 'copyMove' }}>
      <span className={`block shrink-0 overflow-hidden rounded-md bg-raised ${view === 'grid' ? 'h-16 w-full' : 'h-[30px] w-[52px]'}`}><VideoEditProjectThumbnail media={itemMedia} kind={kind} active={visible} /></span>
      <span className={`flex min-w-0 flex-col gap-0.5 ${view === 'grid' ? 'w-full' : 'flex-1'}`}><span className="block truncate text-xs font-medium" data-observation-sensitive>{entry.value.name}</span><span className="block truncate text-2xs text-text3">{detail}</span>{entry.kind === 'item' && !!entry.value.tags?.length && <span className="block truncate text-2xs text-text3">{entry.value.tags.join(' · ')}</span>}</span>
    </UiOptionButton>
  }
  const binMenu = (bin: VideoEditBin): MenuItem[] => [
    { id: 'new', label: '新建子素材箱', icon: <FolderPlus size={16} />, onClick: () => setEdit({ kind: 'createBin', parentId: bin.id }) },
    { id: 'edit', label: '重命名与移动素材箱', icon: <Pencil size={16} />, onClick: () => setEdit({ kind: 'bin', bin }) },
    { id: 'delete', label: '移除空素材箱', icon: <Trash2 size={16} />, onClick: () => run(() => deleteVideoEditBins(projectId, [bin.id])) },
  ]
  return <div className="flex h-full min-h-0 flex-col" aria-label="素材面板" tabIndex={0}
    onDragOver={event => { if (acceptsVideoEditDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={event => drop(event)}
    onKeyDown={event => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return
      if (event.key === 'Delete') { event.preventDefault(); event.stopPropagation(); if (selectedItems.length) run(() => deleteVideoEditItems(projectId, instance.selectedItemIds)); else if (selectedSequence) run(() => deleteVideoEditSequence(projectId, selectedSequence)) }
      if (event.key === 'F2' && selectedItems.length) { event.preventDefault(); event.stopPropagation(); setEdit({ kind: 'items', items: selectedItems }) }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); run(() => setVideoEditProjectView(projectId, { selectedItemIds: entries.filter(value => value.kind === 'item').map(value => value.value.id) })) }
    }}>
    {/* 一行：搜索 + 视图与排序 + 资产库 + 新建 + 导入（设计稿 VideoEdit 素材面板；新建类入口收进“新建”菜单） */}
    {/* 窄面板（960 窗口下约 160px）时图标组整体换到第二行，不被裁掉。 */}
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-0.5 px-2 py-1">
      <UiSearchInput className="mr-1 min-w-28 flex-1" aria-label="搜索素材" placeholder="搜索素材" size="sm" value={keyword} onChange={event => setKeyword(event.target.value)} />
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
      <PanelTrigger panelWidth={168} zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu" renderPanel={() => <div className="flex flex-col gap-1">
        <UiOptionButton variant="menu" size="sm" className="gap-2" active={view === 'list'} onClick={() => setView('list')}><List size={14} />列表视图</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" active={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={14} />缩略图视图</UiOptionButton>
        <div className={`my-1 ${UI_DIVIDER_CLASS}`} />
        {SORT_OPTIONS.map(option => <UiOptionButton key={option.value} variant="menu" size="sm" active={sort === option.value} onClick={() => setSort(option.value)}>按{option.label}排序</UiOptionButton>)}
      </div>}>
        {({ open, togglePanel }) => <UiIconButton aria-label="视图与排序" title="视图与排序" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}>{view === 'grid' ? <Grid2X2 size={15} /> : <List size={15} />}</UiIconButton>}
      </PanelTrigger>
      <UiIconButton aria-label="资产库" title="资产库：拖入素材" onClick={() => openAssetLibrary('floating')}><AssetLibraryIcon size={15} /></UiIconButton>
      <VideoEditProjectDocumentsButton instance={instance} onError={onError} />
      <PanelTrigger panelWidth={184} zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu" renderPanel={() => <div className="flex flex-col gap-1">
        <UiOptionButton variant="menu" size="sm" className="gap-2" onClick={() => setEdit({ kind: 'createBin', parentId: binId })}><FolderPlus size={14} />新建素材箱</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" onClick={newSequence}><SequenceIcon size={14} />新建序列</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" onClick={() => setCreatingCode(true)}><Code2 size={14} />新建代码素材</UiOptionButton>
        <div className={`my-1 ${UI_DIVIDER_CLASS}`} />
        {graphicMenu().map(item => <UiOptionButton key={item.id} variant="menu" size="sm" className="gap-2" onClick={item.onClick}><GraphicIcon size={14} />{item.label}</UiOptionButton>)}
      </div>}>
        {({ open, togglePanel }) => <UiIconButton aria-label="新建素材项" title="新建素材箱、序列、代码素材、图形与调整图层" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><Plus size={16} /></UiIconButton>}
      </PanelTrigger>
      <UiIconButton aria-label="导入" title="导入素材" onClick={choose}><Import size={15} /></UiIconButton>
      </div>
    </div>
    <div className="flex min-h-0 flex-1">
      <div ref={binTreeRef} className={`flex shrink-0 flex-col border-r border-line pl-1 ${compactBinTree ? 'w-10' : 'w-28 min-w-14 max-w-[40%]'}`} aria-label="素材箱树" role="tree">
        <UiChipButton selectionRole="navigation" active={!binId} size="sm" className="w-full gap-1 !px-2" aria-label={compactBinTree ? '素材根目录' : undefined} title={compactBinTree ? '素材根目录' : undefined} onClick={() => selectBin('')} onDrop={event => drop(event, '')}><Folder size={14} />{compactBinTree ? null : <span className="truncate">素材根目录</span>}</UiChipButton>
        <Virtuoso className="min-h-0 flex-1" data={bins} computeItemKey={(_index, row) => row.bin.id} itemContent={(_index, row) => <div className="flex items-center" style={{ paddingLeft: compactBinTree ? 0 : Math.min(row.depth, 8) * 10 }} role="treeitem" aria-level={row.depth + 1} aria-expanded={row.hasChildren ? !collapsed.has(row.bin.id) : undefined}>
          {compactBinTree ? null : <UiIconButton size="sm" className="shrink-0" disabled={!row.hasChildren} title={collapsed.has(row.bin.id) ? '展开素材箱' : '折叠素材箱'} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(row.bin.id)) next.delete(row.bin.id); else next.add(row.bin.id); return next })}>{row.hasChildren ? collapsed.has(row.bin.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} /> : null}</UiIconButton>}
          <UiChipButton selectionRole="navigation" active={binId === row.bin.id} data-video-edit-bin={row.bin.id} size="sm" className="min-w-0 flex-1 gap-1 !px-1" aria-label={compactBinTree ? row.bin.name : undefined} title={compactBinTree ? row.bin.name : undefined} onClick={() => selectBin(row.bin.id)} onContextMenu={event => menu.showMenu(event, binMenu(row.bin))} onDrop={event => drop(event, row.bin.id)}><Folder size={13} className="shrink-0" />{compactBinTree ? null : <span className="truncate" data-user-content>{row.bin.name}</span>}</UiChipButton>
        </div>} />
      </div>
      <div className="min-h-0 min-w-0 flex-1" aria-label="素材项列表" onDoubleClick={event => { if (!(event.target as HTMLElement).closest('[data-video-edit-project-entry]')) choose() }} onContextMenu={event => menu.showMenu(event, blankMenu())}>
        {!entries.length ? <UiEmpty className="h-full" title={keyword ? '没有匹配的素材项' : '此素材箱为空'} description={keyword ? '尝试其他名称或标签。' : '双击空白导入文件，或从资产库拖入素材。'} /> : view === 'grid' ? <VirtuosoGrid key={`${binId}:grid`} data={entries} components={gridComponents} computeItemKey={(_index, entry) => entry.value.id} itemContent={renderEntry} /> : <Virtuoso key={`${binId}:list`} data={entries} computeItemKey={(_index, entry) => entry.value.id} itemContent={renderEntry} />}
      </div>
    </div>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
    {audioChannels && <VideoEditAudioChannelsDialog projectId={projectId} target={audioChannels} onClose={() => setAudioChannels(null)} />}
    {creatingCode && <VideoEditCodeCreateDialog projectId={projectId} binId={binId || undefined} onClose={() => setCreatingCode(false)} onCreated={ids => setVideoEditProjectView(projectId, { selectedItemIds: ids })} />}
    {edit && <VideoEditProjectEditDialog value={edit} bins={instance.document.bins} onClose={() => setEdit(null)} onSubmit={values => {
      if (edit.kind === 'createBin') { const id = createVideoEditBin(projectId, values.name!, values.binId || undefined); selectBin(id) }
      else if (edit.kind === 'bin') updateVideoEditBin(projectId, edit.bin.id, { name: values.name, parentId: values.binId || null })
      else updateVideoEditItems(projectId, edit.items.map(item => item.id), { ...(values.name !== undefined ? { name: values.name } : {}), binId: values.binId || null, ...(values.tags !== undefined ? { tags: values.tags } : {}) })
    }} />}
    {sequenceDialog && <VideoEditSequenceDialog title={sequenceDialog.kind === 'edit' ? '序列设置' : sequenceDialog.kind === 'fromItem' ? '按素材新建序列' : '新建序列'} initial={sequenceDialog.settings} bins={instance.document.bins} requireFrameRate={sequenceDialog.requireFrameRate} onClose={() => setSequenceDialog(null)} onSubmit={settings => {
      if (sequenceDialog.kind === 'edit') updateVideoEditSequenceSettings(projectId, sequenceDialog.id!, settings)
      else if (sequenceDialog.kind === 'fromItem') createVideoEditSequenceFromItem(projectId, sequenceDialog.id!, settings)
      else switchVideoEditSequence(projectId, appendVideoEditSequence(projectId, { ...settings, binId: settings.binId || undefined }))
    }} />}
  </div>
}
