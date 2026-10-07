import { VideoEditMulticamDialog } from './VideoEditMulticamDialog'
import { cancelVideoEditProxy, getVideoEditProxyPreference, readVideoEditProxyState, refreshVideoEditProxies, setVideoEditProxyPreference } from '../application/videoEditProxy'
import { VideoEditProxyDialog } from './VideoEditProxyDialog'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Virtuoso, VirtuosoGrid, type VirtuosoGridHandle, type VirtuosoHandle } from 'react-virtuoso'
import { ArrowUp, ChevronDown, ChevronRight, ChevronUp, FolderInput, FolderOpen, FolderPlus, Import, List, Grid2X2, Plus, Pencil, Trash2, RefreshCw, Play, Settings2, Code2, AudioLines, Tag } from 'lucide-react'
import { ICON_WORKSPACE_VIDEO_EDIT as SequenceIcon, ICON_ASSET_LIBRARY as AssetLibraryIcon, ICON_VIDEO_EDIT_GRAPHIC as GraphicIcon, ICON_VIDEO_EDIT_PROXY as ProxyIcon } from '@/core/theme/icons'
import ContextMenu from '@/components/ContextMenu'
import { PanelTrigger, UiButton, UiEmpty, UiFormRow, UiIconButton, UiSearchInput, UiOptionButton, UiSwitch, UiToast } from '@/components/ui'
import { useSettingsStore } from '@/stores/settingsStore'
import { matchVideoEditShortcut } from '@/core/videoEdit/commands'
import { chooseVideoEditFolders } from '../application/videoEditFolderImport'
import { UI_DIVIDER_CLASS } from '@/components/ui/styleTokens'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { useContextMenu, type MenuItem } from '@/hooks/useContextMenu'
import { openAssetLibrary } from '@/stores/navigationStore'
import { videoEditSequenceFromItem, type VideoEditSequenceSettings } from '@/core/videoEdit/projectItems'
import type { VideoEditBin } from '@/core/videoEdit/document'
import { VIDEO_EDIT_LABELS, VIDEO_EDIT_LABEL_NAMES, type VideoEditLabel } from '@/core/videoEdit/labels'
import { VIDEO_EDIT_LABEL_COLOR_HEX } from '@/core/theme/colorTokens'
import { videoEditFps } from '@/core/videoEdit/time'
import type { FloatingPanelAnchorRect } from '@/components/ui/floatingPanelPosition'
import { acceptsVideoEditDrop, dropVideoEditInput, endVideoEditItemDrag, readVideoEditDrop, writeVideoEditItemDrag } from '../application/videoEditDrop'
import { appendVideoEditSequence, deleteVideoEditSequence, setVideoEditProjectView, switchVideoEditSequence, updateVideoEditSequenceSettings, type VideoEditInstance } from '../application/videoEditService'
import { chooseVideoEditMedia, relinkVideoEditMedia } from '../application/videoEditMedia'
import { appendVideoEditItems, createVideoEditAdjustmentItem, createVideoEditBin, createVideoEditGraphicItem, createVideoEditSequenceFromItem, deleteVideoEditBins, deleteVideoEditItems, setVideoEditLabels, updateVideoEditBin, updateVideoEditItems, type VideoEditGraphicItemInput } from '../application/videoEditProjectItems'
import { updateVideoEditSource } from '../application/videoEditSource'
import { VideoEditSequenceDialog } from './VideoEditSequenceDialog'
import { VideoEditProjectEditDialog, type ProjectEditDialog } from './VideoEditProjectEditDialog'
import { VideoEditProjectThumbnail } from './VideoEditProjectThumbnail'
import { VideoEditCodeCreateDialog } from './VideoEditCodeCreateDialog'
import { VideoEditAudioChannelsDialog, type VideoEditAudioChannelsTarget } from './VideoEditAudioChannelsDialog'
import { VideoEditProjectDocumentsButton } from './VideoEditProjectDocuments'
import { readVideoEditCodeMetadata } from '../application/videoEditCodeState'
import { selectVideoEditProjectItems, videoEditBinPath, videoEditProjectColumns, videoEditProjectRows, type VideoEditProjectEntry, type VideoEditProjectRow, type VideoEditProjectSort, type VideoEditProjectSortKey } from './videoEditProjectModel'
import { videoEditKindIcon } from './videoEditKindIcons'

/** 透明的拖拽图（1×1）：替换浏览器默认的拖拽缩略图。 */
const EMPTY_DRAG_IMAGE: HTMLImageElement = typeof Image === 'undefined' ? ({} as HTMLImageElement) : Object.assign(new Image(1, 1), { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' })

const GridList = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => <div {...props} ref={ref} className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-1 px-1.5 pb-1.5" />)
GridList.displayName = 'VideoEditProjectGridList'
const GridItem = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => <div {...props} ref={ref} className="min-w-0" />)
GridItem.displayName = 'VideoEditProjectGridItem'
const gridComponents = { List: GridList, Item: GridItem }
const SORT_OPTIONS = [{ value: 'name', label: '名称' }, { value: 'kind', label: '类型' }, { value: 'duration', label: '时长' }] as const
/** 列表视图的列（PR 素材面板：名称、帧速率、媒体开始、媒体结束、媒体持续时间），点表头排序。 */
const LIST_COLUMNS: Array<{ key: Exclude<VideoEditProjectSortKey, 'kind' | 'name'> | 'proxy'; label: string }> = [
  { key: 'frameRate', label: '帧速率' }, { key: 'mediaStart', label: '媒体开始' }, { key: 'mediaEnd', label: '媒体结束' }, { key: 'duration', label: '持续时间' }, { key: 'proxy', label: '代理' },
]
/** 列宽（PR：拖表头之间的分隔线调整），本机记住；列宽总和超过面板宽时左右滚动。 */
type ListColumnKey = 'name' | (typeof LIST_COLUMNS)[number]['key']
const DEFAULT_COLUMN_WIDTHS: Record<ListColumnKey, number> = { name: 220, frameRate: 72, mediaStart: 96, mediaEnd: 96, duration: 96, proxy: 88 }
const COLUMN_WIDTHS_KEY = 'henji.videoEdit.projectColumns'
const MIN_COLUMN_WIDTH = 48
function readColumnWidths(): Record<ListColumnKey, number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_KEY) ?? 'null')
    if (raw && typeof raw === 'object') return Object.fromEntries(Object.entries(DEFAULT_COLUMN_WIDTHS).map(([key, value]) => { const saved = (raw as Record<string, unknown>)[key]; return [key, typeof saved === 'number' && Number.isFinite(saved) ? Math.max(MIN_COLUMN_WIDTH, Math.min(800, saved)) : value] })) as Record<ListColumnKey, number>
  } catch { /* 读不到就用默认列宽 */ }
  return DEFAULT_COLUMN_WIDTHS
}
/** 树缩进：每级 12px，最多 8 级。 */
const INDENT_PX = 12
const NO_EXPANDED: ReadonlySet<string> = new Set()
type LabelTargets = { itemIds: string[]; binIds: string[]; sequenceIds: string[] }
type SequenceDialog = { kind: 'create' | 'edit' | 'fromItem'; settings: VideoEditSequenceSettings; id?: string; requireFrameRate?: boolean }


export function VideoEditProjectPanel({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible?: boolean }): React.ReactElement {
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<VideoEditProjectSort>({ key: 'name', direction: 'asc' })
  const [view, setView] = useState<'list' | 'grid'>('list')
  // PR 列表视图：素材箱是可展开的树（三角展开），没有单独的素材箱侧栏。
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [columnWidths, setColumnWidths] = useState<Record<ListColumnKey, number>>(readColumnWidths)
  const resizeColumn = (key: ListColumnKey) => (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    const handle = event.currentTarget; handle.setPointerCapture(event.pointerId)
    const startX = event.clientX; const startWidth = columnWidths[key]
    const move = (next: PointerEvent): void => setColumnWidths(current => ({ ...current, [key]: Math.max(MIN_COLUMN_WIDTH, Math.min(800, Math.round(startWidth + next.clientX - startX))) }))
    const up = (): void => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up)
      setColumnWidths(current => { try { localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(current)) } catch { /* 只是本机偏好 */ } return current })
    }
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up)
  }
  const tableWidth = Object.values(columnWidths).reduce((sum, value) => sum + value, 0) + 20 + 12
  // 拖出素材时跟着鼠标的小标签（浏览器缩略图已去掉）；到了时间线上由时间线画片段虚影，这里隐藏
  const [dragFollow, setDragFollow] = useState<{ count: number; x: number; y: number; hidden: boolean } | null>(null)
  const dragging = dragFollow !== null
  useEffect(() => {
    if (!dragging) return
    const move = (event: DragEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      const hidden = Boolean(target?.closest('[data-video-edit-timeline-viewport]')) || (event.clientX === 0 && event.clientY === 0)
      setDragFollow(current => current && { ...current, x: event.clientX, y: event.clientY, hidden })
    }
    document.addEventListener('dragover', move, true)
    return () => document.removeEventListener('dragover', move, true)
  }, [dragging])
  const [selectedBinRow, setSelectedBinRow] = useState<string | null>(null)
  const [labelPicker, setLabelPicker] = useState<{ anchor: FloatingPanelAnchorRect; targets: LabelTargets; current?: VideoEditLabel } | null>(null)
  const pointerAt = useRef<FloatingPanelAnchorRect>({ left: 0, top: 0, bottom: 0, width: 0 })
  const [edit, setEdit] = useState<ProjectEditDialog | null>(null)
  const [sequenceDialog, setSequenceDialog] = useState<SequenceDialog | null>(null)
  const [selectedSequence, setSelectedSequence] = useState<string | null>(null)
  const [creatingCode, setCreatingCode] = useState(false)
  const projectId = instance.document.id
  const [multicamItemIds, setMulticamItemIds] = useState<string[] | null>(null)
  const proxyError = useRef(onError); proxyError.current = onError
  const [proxyMediaIds, setProxyMediaIds] = useState<string[] | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void refreshVideoEditProxies(projectId, controller.signal).catch(error => { if (!controller.signal.aborted) proxyError.current(error) })
    return () => controller.abort()
  }, [projectId, instance.document.media])
  const [audioChannels, setAudioChannels] = useState<VideoEditAudioChannelsTarget | null>(null)
  const anchor = useRef<string | null>(null)
  const menu = useContextMenu()
  const binId = instance.selectedBinId
  const activeSequence = instance.document.sequences.find(sequence => sequence.id === instance.activeSequenceId)
  const fallbackFps = activeSequence ? videoEditFps(activeSequence.frameRate) : 60
  const rows = useMemo(() => videoEditProjectRows(instance.document, binId, keyword, sort, view === 'grid' ? NO_EXPANDED : expanded, fallbackFps), [instance.document, binId, keyword, sort, view, expanded, fallbackFps])
  const entries = useMemo(() => rows.map(row => row.entry), [rows])
  const binPath = videoEditBinPath(instance.document.bins, binId)
  const media = useMemo(() => new Map(instance.document.media.map(value => [value.id, value])), [instance.document.media])
  const selectedIds = new Set(instance.selectedItemIds)
  const selectedItems = instance.document.items.filter(item => selectedIds.has(item.id))
  const run = (operation: () => unknown | Promise<unknown>): void => { void Promise.resolve().then(operation).catch(error => {
    if (error instanceof Error && /源预览请求已被更新|源预览已关闭/.test(error.message)) return
    onError(error)
  }) }
  const choose = (): void => run(() => chooseVideoEditMedia(projectId, binId || undefined))
  // 导入结果提示：文件夹导入跳过了不支持或读不出的文件时告诉用户跳过几个（Premiere 同样只导入能用的文件）。
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(timer) }, [notice])
  const reportSkipped = (skipped: number): void => { if (skipped) setNotice(`已跳过 ${skipped} 项不支持、无法读取或重复的素材及目录`) }
  /** 文件夹的素材进了新建的子素材箱：当前素材箱只选中直接放进来的素材项。 */
  const selectImported = (targetBin: string, ids: string[]): void => {
    const items = new Map(instance.document.items.map(item => [item.id, item]))
    setVideoEditProjectView(projectId, { selectedBinId: targetBin, selectedItemIds: ids.filter(id => (items.get(id)?.binId ?? '') === targetBin) })
  }
  const chooseFolders = (): void => run(async () => {
    const result = await chooseVideoEditFolders(projectId, binId || undefined)
    if (result.itemIds.length) selectImported(binId, result.itemIds)
    reportSkipped(result.skipped)
  })
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const listRef = useRef<VirtuosoHandle>(null); const gridRef = useRef<VirtuosoGridHandle>(null)
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
    { id: 'import_folder', label: '导入文件夹', icon: <FolderInput size={16} />, onClick: chooseFolders },
    { id: 'assets', label: '从资产库拖入', icon: <AssetLibraryIcon size={16} />, onClick: () => openAssetLibrary('floating') },
    { id: 'bin', label: '新建素材箱', icon: <FolderPlus size={16} />, onClick: () => setEdit({ kind: 'createBin', parentId: binId }) },
    { id: 'sequence', label: '新建序列…', icon: <SequenceIcon size={16} />, onClick: newSequence },
    { id: 'code', label: '新建代码素材', icon: <Code2 size={16} />, onClick: () => setCreatingCode(true) },
    ...graphicMenu(),
  ]
  const toggleBin = (id: string): void => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  /** PR“标签”：右键菜单打开色板，设给右键的这一项或当前选区。 */
  const labelItem = (targets: LabelTargets, current?: VideoEditLabel): MenuItem => ({ id: 'label', label: '标签…', icon: <Tag size={16} />, onClick: () => setLabelPicker({ anchor: { ...pointerAt.current }, targets, ...(current ? { current } : {}) }) })
  const itemMenu = (entry: VideoEditProjectEntry): MenuItem[] => {
    if (entry.kind === 'bin') return [...binMenu(entry.value), labelItem({ itemIds: [], binIds: [entry.value.id], sequenceIds: [] }, entry.value.label)]
    if (entry.kind === 'sequence') return [
      { id: 'open', label: '打开序列', icon: <Play size={16} />, onClick: () => run(() => switchVideoEditSequence(projectId, entry.value.id)) },
      { id: 'settings', label: '序列设置与重命名', icon: <Settings2 size={16} />, onClick: () => setSequenceDialog({ kind: 'edit', id: entry.value.id, settings: entry.value }) },
      { id: 'delete', label: '移除空序列', icon: <Trash2 size={16} />, disabled: !!entry.value.clips.length || !!entry.value.annotations.length, onClick: () => run(() => deleteVideoEditSequence(projectId, entry.value.id)) },
      labelItem({ itemIds: [], binIds: [], sequenceIds: [entry.value.id] }, entry.value.label),
    ]
    const item = entry.value
    const ids = instance.selectedItemIds.includes(item.id) ? instance.selectedItemIds : [item.id]
    const proxyIds = [...new Set(instance.document.items.filter(value => ids.includes(value.id) && value.kind === 'video').flatMap(value => value.mediaId ? [value.mediaId] : []))]
    const items = instance.document.items.filter(value => ids.includes(value.id))
    // Premiere "Modify > Audio Channels": several items at once only when their files have the same sound streams.
    const sounding = items.map(value => media.get(value.mediaId ?? '')).filter(value => value && (value.kind === 'audio' || value.kind === 'video' && value.hasAudio !== false))
    const audioTarget: VideoEditAudioChannelsTarget | undefined = sounding.length === items.length && sounding[0] && (items.length === 1 || sounding.every(value => value!.audioStreams && JSON.stringify(value!.audioStreams) === JSON.stringify(sounding[0]!.audioStreams))) ? { kind: 'items', itemIds: items.map(value => value.id), mediaId: sounding[0].id, ...(items[0].audioChannels ? { layout: items[0].audioChannels } : {}) } : undefined
    return [
      { id: 'create_multicam', label: '创建多机位源序列…', icon: <SequenceIcon size={16} />, disabled: items.length < 2 || items.some(item => item.kind !== 'video'), onClick: () => setMulticamItemIds(ids) },
      { id: 'create_proxy', label: '创建代理…', icon: <ProxyIcon size={16} />, disabled: !proxyIds.length || proxyIds.some(id => readVideoEditProxyState(projectId, id).status === 'generating'), onClick: () => setProxyMediaIds(proxyIds) },
      { id: 'cancel_proxy', label: '取消创建代理', icon: <RefreshCw size={16} />, disabled: !proxyIds.some(id => readVideoEditProxyState(projectId, id).status === 'generating'), onClick: () => proxyIds.forEach(id => cancelVideoEditProxy(projectId, id)) },
      { id: 'preview', label: '打开源素材', icon: <Play size={16} />, disabled: !item.mediaId, onClick: () => run(() => updateVideoEditSource(projectId, { itemId: item.id })) },
      { id: 'append', label: `添加${ids.length > 1 ? ` ${ids.length} 项` : ''}到当前序列`, disabled: !activeSequence, icon: <Plus size={16} />, onClick: () => run(() => appendVideoEditItems(projectId, ids, instance.activeSequenceId)) },
      { id: 'sequence', label: item.kind === 'adjustment' ? '调整图层请添加到现有序列' : '按此素材新建序列', icon: <SequenceIcon size={16} />, disabled: ids.length !== 1 || item.kind === 'adjustment', onClick: () => createFromItem(item.id) },
      { id: 'edit', label: '重命名、标签与移动', icon: <Pencil size={16} />, onClick: () => setEdit({ kind: 'items', items }) },
      labelItem({ itemIds: items.map(value => value.id), binIds: [], sequenceIds: [] }, items.length === 1 ? item.label : undefined),
      { id: 'audio_channels', label: '音频声道…', icon: <AudioLines size={16} />, disabled: !audioTarget, onClick: () => { if (audioTarget) setAudioChannels(audioTarget) } },
      { id: 'relink', label: '重新定位源文件', icon: <RefreshCw size={16} />, disabled: !item.mediaId || ids.length !== 1, onClick: () => run(() => relinkVideoEditMedia(projectId, item.mediaId!)) },
      { id: 'remove', label: `从素材移除${ids.length > 1 ? ` ${ids.length} 项` : ''}`, icon: <Trash2 size={16} />, onClick: () => run(() => deleteVideoEditItems(projectId, ids)) },
    ]
  }
  /** 进入素材箱（双击素材箱或“上一级”）：面板显示这个素材箱的内容。 */
  const selectBin = (id: string): void => { anchor.current = null; setSelectedSequence(null); setSelectedBinRow(null); run(() => setVideoEditProjectView(projectId, { selectedBinId: id, selectedItemIds: [] })) }
  const drop = (event: React.DragEvent, targetBin = binId): void => {
    if (!acceptsVideoEditDrop(event.dataTransfer)) return
    event.preventDefault(); event.stopPropagation()
    try {
      const input = readVideoEditDrop(event.dataTransfer)
      run(async () => {
        let skipped = 0
        const ids = await dropVideoEditInput(projectId, input, undefined, targetBin || undefined, { onSkipped: count => { skipped = count } })
        if (input.kind === 'items') {
          const sequenceIds = ids.filter(id => instance.document.sequences.some(sequence => sequence.id === id))
          for (const id of sequenceIds) updateVideoEditSequenceSettings(projectId, id, { binId: targetBin || null })
          const itemIds = ids.filter(id => !sequenceIds.includes(id))
          if (itemIds.length) updateVideoEditItems(projectId, itemIds, { binId: targetBin || null })
          setVideoEditProjectView(projectId, { selectedBinId: targetBin, selectedItemIds: itemIds })
        }
        else selectImported(targetBin, ids)
        reportSkipped(skipped)
      })
    } catch (error) { onError(error) }
  }
  const detailOf = (entry: VideoEditProjectEntry): string => {
    if (entry.kind === 'bin') { const count = instance.document.items.filter(item => item.binId === entry.value.id).length + instance.document.bins.filter(bin => bin.parentId === entry.value.id).length; return count ? `${count} 项` : '空素材箱' }
    const itemMedia = entry.kind === 'item' ? media.get(entry.value.mediaId ?? '') : undefined
    const itemDuration = entry.kind === 'item' && entry.value.sourceRange ? (entry.value.sourceRange.outUs - entry.value.sourceRange.inUs) / 1e6 : itemMedia?.durationSeconds
    const kind = entry.kind === 'sequence' ? 'sequence' : entry.value.kind
    const graphic = entry.kind === 'item' && kind === 'graphic' ? entry.value.graphic : undefined
    return entry.kind === 'sequence' ? `${entry.value.width} × ${entry.value.height} · ${Number((entry.value.frameRate.numerator / entry.value.frameRate.denominator).toFixed(3))} fps` : itemMedia ? `${itemMedia.kind === 'audio' ? '音频' : `${itemMedia.width} × ${itemMedia.height}`}${itemDuration ? ` · ${itemDuration.toFixed(1)} 秒` : ''}${itemMedia.assetId ? ' · 来自资产库' : ''}` : graphic ? `可编辑图形 · ${graphic.width} × ${graphic.height}` : kind === 'adjustment' ? '调整图层 · 添加到现有序列上方画面轨道' : kind === 'code' ? '原生代码素材' : '文字'
  }
  /** 一项的选择、双击、右键与拖动（列表行与图标格共用）。素材箱双击进入，素材拖到素材箱上即移入。 */
  const entryHandlers = (entry: VideoEditProjectEntry, selected: boolean) => ({
    'data-video-edit-project-entry': entry.value.id, 'aria-label': entry.value.name, 'aria-pressed': selected, draggable: entry.kind !== 'bin',
    onClick: (event: React.MouseEvent) => {
      if (entry.kind === 'bin') { setSelectedSequence(null); setSelectedBinRow(entry.value.id); run(() => setVideoEditProjectView(projectId, { selectedItemIds: [] })); return }
      setSelectedBinRow(null)
      if (entry.kind === 'sequence') { setSelectedSequence(entry.value.id); run(() => setVideoEditProjectView(projectId, { selectedItemIds: [] })); return }
      setSelectedSequence(null)
      const ids = entries.filter((value): value is Extract<VideoEditProjectEntry, { kind: 'item' }> => value.kind === 'item').map(value => value.value.id)
      const selection = selectVideoEditProjectItems(ids, instance.selectedItemIds, entry.value.id, anchor.current, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey })
      if (!event.shiftKey) anchor.current = entry.value.id
      run(() => setVideoEditProjectView(projectId, { selectedItemIds: selection }))
    },
    onDoubleClick: (event: React.MouseEvent) => { event.stopPropagation(); if (entry.kind === 'bin') { selectBin(entry.value.id); return } run(() => entry.kind === 'sequence' ? switchVideoEditSequence(projectId, entry.value.id) : entry.value.mediaId ? updateVideoEditSource(projectId, { itemId: entry.value.id }) : appendVideoEditItems(projectId, [entry.value.id], instance.activeSequenceId)) },
    onContextMenu: (event: React.MouseEvent) => {
      event.stopPropagation(); pointerAt.current = { left: event.clientX, top: event.clientY, bottom: event.clientY, width: 0 }
      if (entry.kind === 'item' && !selected) run(() => setVideoEditProjectView(projectId, { selectedItemIds: [entry.value.id] }))
      menu.showMenu(event, itemMenu(entry))
    },
    // 不显示浏览器自带的拖拽缩略图：它遮住落点、和实际位置对不上；拖到时间线上由时间线画出片段虚影（所见即所得）
    onDragStart: (event: React.DragEvent) => {
      if (entry.kind === 'bin') return
      const ids = entry.kind === 'sequence' ? [entry.value.id] : selected ? instance.selectedItemIds : [entry.value.id]
      writeVideoEditItemDrag(event.dataTransfer, projectId, ids); event.dataTransfer.effectAllowed = 'copyMove'; event.dataTransfer.setDragImage(EMPTY_DRAG_IMAGE, 0, 0)
      setDragFollow({ count: ids.length, x: event.clientX, y: event.clientY, hidden: false })
    },
    onDragEnd: () => { endVideoEditItemDrag(); setDragFollow(null) },
    ...(entry.kind === 'bin' ? { onDragOver: (event: React.DragEvent) => { if (acceptsVideoEditDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }, onDrop: (event: React.DragEvent) => drop(event, entry.value.id) } : {}),
  })
  const isSelected = (entry: VideoEditProjectEntry): boolean => entry.kind === 'item' ? instance.selectedItemIds.includes(entry.value.id) : entry.kind === 'bin' ? selectedBinRow === entry.value.id : selectedSequence === entry.value.id
  const kindOf = (entry: VideoEditProjectEntry): string => entry.kind === 'item' ? entry.value.kind : entry.kind
  /** 图标视图：封面 + 名称（素材箱显示文件夹，双击进入）。 */
  const renderTile = (_index: number, entry: VideoEditProjectEntry): React.ReactElement => {
    const selected = isSelected(entry); const kind = kindOf(entry)
    return <UiOptionButton variant="menu" size="sm" active={selected} selection={entry.kind === 'item' ? 'multiple' : 'single'} className="w-full min-w-0 flex-col items-stretch gap-1.5 !p-1.5" data-entry-kind={kind} {...entryHandlers(entry, selected)}>
      <span className="block h-16 w-full shrink-0 overflow-hidden rounded-md bg-raised"><VideoEditProjectThumbnail media={entry.kind === 'item' ? media.get(entry.value.mediaId ?? '') : undefined} kind={kind} active={visible} /></span>
      <span className="flex w-full min-w-0 items-center gap-1.5"><LabelSwatch label={videoEditProjectColumns(instance.document, entry, fallbackFps).label} /><span className="block min-w-0 flex-1 truncate text-xs font-medium" data-observation-sensitive>{entry.value.name}</span></span>
      <span className="block truncate text-2xs text-text3">{detailOf(entry)}</span>
    </UiOptionButton>
  }
  /** 列表视图一行（PR）：缩进 + 展开三角 + 颜色标签 + 图标与名称 + 帧速率、媒体开始、媒体结束、持续时间。 */
  const renderRow = (_index: number, row: VideoEditProjectRow): React.ReactElement => {
    const { entry } = row; const selected = isSelected(entry); const kind = kindOf(entry); const Icon = videoEditKindIcon(kind)
    const columns = videoEditProjectColumns(instance.document, entry, fallbackFps)
    const cells: Record<(typeof LIST_COLUMNS)[number]['key'], string> = { frameRate: columns.frameRateText, mediaStart: columns.mediaStart, mediaEnd: columns.mediaEnd, duration: columns.durationText, proxy: entry.kind === 'item' && entry.value.kind === 'video' && entry.value.mediaId ? (() => { const state = readVideoEditProxyState(projectId, entry.value.mediaId!); return state.status === 'generating' ? `生成中 ${Math.round(state.progress * 100)}%` : state.status === 'ready' ? '已有' : state.error ? '无（创建失败）' : '无' })() : '' }
    return <div className="flex min-w-0 items-center" role="treeitem" aria-level={row.depth + 1} aria-expanded={row.expandable ? row.expanded : undefined} aria-selected={selected} style={{ paddingLeft: Math.min(row.depth, 8) * INDENT_PX }}>
      {row.expandable ? <UiIconButton size="xs" className="shrink-0" aria-label={`${row.expanded ? '折叠' : '展开'}素材箱 ${entry.value.name}`} onClick={() => toggleBin(entry.value.id)}>{row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</UiIconButton> : <span className="w-5 shrink-0" aria-hidden="true" />}
      <UiOptionButton variant="menu" size="sm" active={selected} selection={entry.kind === 'item' ? 'multiple' : 'single'} className="min-h-7 min-w-0 flex-1 gap-2 !px-1.5" data-entry-kind={kind} {...entryHandlers(entry, selected)}>
        <LabelSwatch label={columns.label} />
        <Icon size={13} className="shrink-0 text-text2" aria-hidden="true" />
        <span className="min-w-0 shrink-0 truncate text-left text-xs" style={{ width: Math.max(40, columnWidths.name - Math.min(row.depth, 8) * INDENT_PX - 44) }} data-observation-sensitive title={entry.kind === 'item' && entry.value.tags?.length ? `${entry.value.name}（${entry.value.tags.join(' · ')}）` : `${entry.value.name} · ${detailOf(entry)}`}>{entry.value.name}</span>
        {LIST_COLUMNS.map(column => <span key={column.key} className="shrink-0 truncate pl-2 text-left font-mono text-2xs tabular-nums text-text3" style={{ width: columnWidths[column.key] }} data-video-edit-project-column={column.key}>{cells[column.key]}</span>)}
      </UiOptionButton>
    </div>
  }
  const sortBy = (key: VideoEditProjectSortKey): void => setSort(previous => ({ key, direction: previous.key === key && previous.direction === 'asc' ? 'desc' : 'asc' }))
  const binMenu = (bin: VideoEditBin): MenuItem[] => [
    { id: 'new', label: '新建子素材箱', icon: <FolderPlus size={16} />, onClick: () => setEdit({ kind: 'createBin', parentId: bin.id }) },
    { id: 'edit', label: '重命名与移动素材箱', icon: <Pencil size={16} />, onClick: () => setEdit({ kind: 'bin', bin }) },
    { id: 'open', label: '打开素材箱', icon: <FolderOpen size={16} />, onClick: () => selectBin(bin.id) },
    { id: 'delete', label: '移除空素材箱', icon: <Trash2 size={16} />, onClick: () => run(() => deleteVideoEditBins(projectId, [bin.id])) },
  ]
  const followLabel = dragFollow && !dragFollow.hidden ? createPortal(<div aria-hidden="true" data-video-edit-drag-follow className="pointer-events-none fixed z-drag rounded-full bg-raised px-2.5 py-1 text-xs text-text1 shadow-panel" style={{ left: dragFollow.x + 14, top: dragFollow.y + 14 }}>{dragFollow.count > 1 ? `${dragFollow.count} 个素材` : '1 个素材'}</div>, document.body) : null
  return <div className="relative flex h-full min-h-0 flex-col" aria-label="素材面板" tabIndex={0}
    onDragOver={event => { if (acceptsVideoEditDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={event => drop(event)}
    onKeyDown={event => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return
      // 素材面板自己的视图键（Premiere：Ctrl+PgUp 列表、Ctrl+PgDn 图标、Shift+\ 切换），可在快捷键设置里改。
      const viewCommand = matchVideoEditShortcut({ code: event.code, key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, repeat: event.repeat, isComposing: event.nativeEvent.isComposing, defaultPrevented: event.defaultPrevented }, 'project', shortcuts)
      if (viewCommand === 'project_list_view' || viewCommand === 'project_icon_view' || viewCommand === 'project_toggle_view') { event.preventDefault(); event.stopPropagation(); setView(viewCommand === 'project_list_view' ? 'list' : viewCommand === 'project_icon_view' ? 'grid' : view === 'list' ? 'grid' : 'list'); return }
      // 方向键与 Home/End 移动选择，Shift 连选（Premiere 素材面板）。
      const step = ({ ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 } as Record<string, number>)[event.key]
      if ((step || event.key === 'Home' || event.key === 'End') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const ids = entries.filter((value): value is Extract<VideoEditProjectEntry, { kind: 'item' }> => value.kind === 'item').map(value => value.value.id)
        if (!ids.length) return
        event.preventDefault(); event.stopPropagation()
        const focus = instance.selectedItemIds.at(-1)
        const current = focus ? ids.indexOf(focus) : -1
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, current < 0 ? (step > 0 ? 0 : ids.length - 1) : current + step))
        if (!event.shiftKey || !anchor.current) anchor.current = event.shiftKey ? focus ?? ids[index] : ids[index]
        const selection = event.shiftKey ? selectVideoEditProjectItems(ids, instance.selectedItemIds, ids[index], anchor.current, { toggle: false, range: true }) : [ids[index]]
        setSelectedSequence(null)
        // 当前位置放在选区末尾，下一次方向键从这里继续。
        run(() => setVideoEditProjectView(projectId, { selectedItemIds: [...selection.filter(id => id !== ids[index]), ids[index]] }))
        const entryIndex = entries.findIndex(value => value.value.id === ids[index])
        if (view === 'grid') gridRef.current?.scrollToIndex({ index: entryIndex, align: 'center' }); else listRef.current?.scrollIntoView({ index: entryIndex })
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); if (selectedItems.length) run(() => deleteVideoEditItems(projectId, instance.selectedItemIds)); else if (selectedSequence) run(() => deleteVideoEditSequence(projectId, selectedSequence)); else if (selectedBinRow) run(() => { deleteVideoEditBins(projectId, [selectedBinRow]); setSelectedBinRow(null) }) }
      if (event.key === 'F2' && selectedItems.length) { event.preventDefault(); event.stopPropagation(); setEdit({ kind: 'items', items: selectedItems }) }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); run(() => setVideoEditProjectView(projectId, { selectedItemIds: entries.filter(value => value.kind === 'item').map(value => value.value.id) })) }
    }}>
    {followLabel}
    {/* 一行：搜索 + 视图与排序 + 资产库 + 新建 + 导入（设计稿 VideoEdit 素材面板；新建类入口收进“新建”菜单） */}
    {/* 窄面板（960 窗口下约 160px）时图标组整体换到第二行，不被裁掉。 */}
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-0.5 px-2 py-1">
      {/* 当前所在素材箱（双击素材箱进入）：上一级 + 名称，悬停看完整位置 */}
      {binId && <div className="mr-1 flex min-w-0 max-w-[40%] shrink items-center gap-0.5" title={['素材', ...binPath.map(bin => bin.name)].join(' / ')}>
        <UiIconButton size="sm" aria-label="返回上一级素材箱" title="返回上一级素材箱" onClick={() => selectBin(binPath.at(-2)?.id ?? '')} onDragOver={event => { if (acceptsVideoEditDrop(event.dataTransfer)) event.preventDefault() }} onDrop={event => drop(event, binPath.at(-2)?.id ?? '')}><ArrowUp size={14} /></UiIconButton>
        <span className="min-w-0 truncate text-xs text-text2" data-user-content data-video-edit-current-bin>{binPath.at(-1)?.name}</span>
      </div>}
      <UiSearchInput className="mr-1 min-w-28 flex-1" aria-label="搜索素材" placeholder="搜索素材" size="sm" value={keyword} onChange={event => setKeyword(event.target.value)} />
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
      <PanelTrigger panelWidth={168} zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu" renderPanel={() => <div className="flex flex-col gap-1">
        <UiOptionButton variant="menu" size="sm" className="gap-2" active={view === 'list'} onClick={() => setView('list')}><List size={14} />列表视图</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" active={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={14} />缩略图视图</UiOptionButton>
        <div className={`my-1 ${UI_DIVIDER_CLASS}`} />
        {SORT_OPTIONS.map(option => <UiOptionButton key={option.value} variant="menu" size="sm" active={sort.key === option.value} onClick={() => setSort({ key: option.value, direction: 'asc' })}>按{option.label}排序</UiOptionButton>)}
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
      <PanelTrigger panelWidth={240} zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu" renderPanel={() => <div className="flex flex-col gap-1">
        <UiOptionButton variant="menu" size="sm" className="gap-2" onClick={choose}><Import size={14} />导入文件</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" onClick={chooseFolders}><FolderInput size={14} />导入文件夹</UiOptionButton>
        <UiFormRow label="自动创建代理" info="导入高于 1080p 的视频时，自动创建用于流畅预览的代理。" inline density="compact"><UiSwitch checked={getVideoEditProxyPreference(projectId).autoCreate} onCheckedChange={autoCreate => setVideoEditProxyPreference(projectId, { autoCreate })} /></UiFormRow>
      </div>}>
        {({ open, togglePanel }) => <UiIconButton aria-label="导入" title="导入文件或文件夹" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><Import size={15} /></UiIconButton>}
      </PanelTrigger>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-x-auto" aria-label="素材项列表" onDoubleClick={event => { if (!(event.target as HTMLElement).closest('[data-video-edit-project-entry]')) choose() }} onContextMenu={event => { pointerAt.current = { left: event.clientX, top: event.clientY, bottom: event.clientY, width: 0 }; menu.showMenu(event, blankMenu()) }}>
      {!entries.length ? <UiEmpty className="h-full" title={keyword ? '没有匹配的素材项' : '此素材箱为空'} description={keyword ? '尝试其他名称或标签。' : '双击空白导入文件，或从资产库拖入素材。'} />
        : view === 'grid' ? <VirtuosoGrid ref={gridRef} key={`${binId}:grid`} data={entries} components={gridComponents} computeItemKey={(_index, entry) => entry.value.id} itemContent={renderTile} />
          // 列表视图（PR）：表头点击排序，素材箱是可展开的树；窄面板横向滚动看全部列。
          : <div className="flex h-full flex-col" style={{ minWidth: tableWidth }}>
            <div className="flex h-7 shrink-0 items-center border-b border-gap pl-5 pr-1.5" role="row" aria-label="列表列">
              {([{ key: 'name' as const, label: '名称' }, ...LIST_COLUMNS]).map(column => <div key={column.key} className="relative flex shrink-0 items-center" style={{ width: columnWidths[column.key] }}>
                <UiButton size="sm" className="min-w-0 flex-1 !justify-start !px-1.5" disabled={column.key === 'proxy'} aria-sort={sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'} onClick={() => { if (column.key !== 'proxy') sortBy(column.key) }}>{column.label}{column.key !== 'proxy' && <SortMark sort={sort} column={column.key} />}</UiButton>
                {/* 列分隔线：按住左右拖动调整列宽 */}
                <span role="separator" aria-orientation="vertical" aria-label={`调整“${column.label}”列宽`} title="拖动调整列宽" className="absolute -right-1 bottom-1 top-1 z-raised w-2 cursor-col-resize border-r border-line hover:border-accent-ring" onPointerDown={resizeColumn(column.key)} onClick={event => event.stopPropagation()} />
              </div>)}
            </div>
            <Virtuoso ref={listRef} className="min-h-0 flex-1" key={`${binId}:list`} data={rows} computeItemKey={(_index, row) => row.entry.value.id} itemContent={renderRow} role="tree" aria-label="素材与素材箱" />
          </div>}
    </div>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
    {notice && <UiToast message={notice} tone="success" placement="container" />}
    {labelPicker && <PanelTrigger anchor={labelPicker.anchor} open onOpenChange={open => { if (!open) setLabelPicker(null) }} panelWidth={200} zIndex={Z_LAYERS.dropdown} panelPadding="content" closeOnPanelClick
      renderPanel={() => <div className="flex flex-col gap-2" aria-label="颜色标签">
        <div className="grid grid-cols-6 gap-1">
          {VIDEO_EDIT_LABELS.map(label => <UiOptionButton key={label} variant="swatch" active={labelPicker.current === label} aria-label={VIDEO_EDIT_LABEL_NAMES[label]} title={VIDEO_EDIT_LABEL_NAMES[label]} style={{ backgroundColor: VIDEO_EDIT_LABEL_COLOR_HEX[label] }} onClick={() => run(() => setVideoEditLabels(projectId, labelPicker.targets, label))} />)}
        </div>
        <UiButton size="sm" onClick={() => run(() => setVideoEditLabels(projectId, labelPicker.targets, null))}>按类型默认</UiButton>
      </div>} />}
    {multicamItemIds && <VideoEditMulticamDialog projectId={projectId} sequenceId={instance.activeSequenceId} itemIds={multicamItemIds} onClose={() => setMulticamItemIds(null)} />}
    {proxyMediaIds && <VideoEditProxyDialog projectId={projectId} mediaIds={proxyMediaIds} onClose={() => setProxyMediaIds(null)} onError={onError} />}
    {audioChannels && <VideoEditAudioChannelsDialog projectId={projectId} target={audioChannels} onClose={() => setAudioChannels(null)} />}
    {creatingCode && <VideoEditCodeCreateDialog projectId={projectId} binId={binId || undefined} onClose={() => setCreatingCode(false)} onCreated={ids => setVideoEditProjectView(projectId, { selectedItemIds: ids })} />}
    {edit && <VideoEditProjectEditDialog value={edit} bins={instance.document.bins} onClose={() => setEdit(null)} onSubmit={values => {
      if (edit.kind === 'createBin') { const id = createVideoEditBin(projectId, values.name!, values.binId || undefined); selectBin(id) }
      else if (edit.kind === 'bin') updateVideoEditBin(projectId, edit.bin.id, { name: values.name, parentId: values.binId || null })
      else updateVideoEditItems(projectId, edit.items.map(item => item.id), { ...(values.name !== undefined ? { name: values.name } : {}), binId: values.binId || null, ...(values.tags !== undefined ? { tags: values.tags } : {}) })
    }} />}
    {sequenceDialog && <VideoEditSequenceDialog title={sequenceDialog.kind === 'edit' ? '序列设置' : sequenceDialog.kind === 'fromItem' ? '按素材新建序列' : '新建序列'} mode={sequenceDialog.kind === 'edit' ? 'edit' : 'create'} initial={sequenceDialog.settings} bins={instance.document.bins} requireFrameRate={sequenceDialog.requireFrameRate} onClose={() => setSequenceDialog(null)} onSubmit={settings => {
      if (sequenceDialog.kind === 'edit') updateVideoEditSequenceSettings(projectId, sequenceDialog.id!, settings)
      else if (sequenceDialog.kind === 'fromItem') createVideoEditSequenceFromItem(projectId, sequenceDialog.id!, settings)
      else switchVideoEditSequence(projectId, appendVideoEditSequence(projectId, { ...settings, binId: settings.binId || undefined }))
    }} />}
  </div>
}

/** 表头当前排序列的方向（升序向上、降序向下）。 */
function SortMark({ sort, column }: { sort: VideoEditProjectSort; column: VideoEditProjectSortKey }): React.ReactElement | null {
  if (sort.key !== column) return null
  return sort.direction === 'asc' ? <ChevronUp size={11} className="shrink-0" aria-hidden="true" /> : <ChevronDown size={11} className="shrink-0" aria-hidden="true" />
}
/** 颜色标签小方块（PR 素材面板的标签列）：颜色是用户内容色，名称进悬停说明。 */
function LabelSwatch({ label }: { label: VideoEditLabel }): React.ReactElement {
  return <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: VIDEO_EDIT_LABEL_COLOR_HEX[label] }} title={VIDEO_EDIT_LABEL_NAMES[label]} data-video-edit-label={label} aria-hidden="true" />
}
