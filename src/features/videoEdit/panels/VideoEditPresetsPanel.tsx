import { useMemo, useState, useSyncExternalStore } from 'react'
import { FolderInput, FolderOutput, Star } from 'lucide-react'
import { UI_COVER_FRAME_CLASS, UI_TEXT_META_CLASS, UiButton, UiEmpty, UiFormRow, UiGroup, UiIconButton, UiModal, UiOptionButton, UiSearchInput, UiSegmented, UiSwitch } from '@/components/ui'
import { useNotification } from '@/contexts/NotificationContext'
import { openDialog, readTextFile, saveDialog, writeTextFile } from '@/platform/desktopApi'
import { henjiDialogExtensions } from '@/core/fileExtensions'
import { VIDEO_EDIT_PRESET_PANEL_CATEGORIES, VIDEO_EDIT_PRESET_CATEGORY_LABELS, VIDEO_EDIT_PRESET_DEFAULTABLE, VIDEO_EDIT_PRESET_MAX_RATING, VIDEO_EDIT_PRESET_PACKAGE_EXTENSION, type VideoEditPresetCategory } from '@/core/videoEdit/presetPackage'
import { deleteVideoEditPreset, exportVideoEditPresetPackage, importVideoEditPresetPackage, listVideoEditPresets, setVideoEditPresetDefault, setVideoEditPresetRating, videoEditPresetExportable, videoEditPresetSource, type VideoEditPresetEntry } from '../application/videoEditPresetCatalog'
import { applyVideoEditPreset } from '../application/videoEditPresetApply'
import { getActiveVideoEditSequence, subscribeVideoEditDomain, videoEditDomainRevision, type VideoEditInstance } from '../application/videoEditService'
import { startVideoEditEffectDrag } from './videoEditEffectDrag'
import { startVideoEditTransitionDrag } from './videoEditTransitionDrag'
import { VideoEditPresetPlayer } from './VideoEditPresetPlayer'
import type { VideoEditTransitionKind } from '@/core/videoEdit/transitions'

const TILE_SIZE = { width: 320, height: 180 }
const DETAIL_SIZE = { width: 640, height: 360 }
const FILTERS = [{ name: '痕迹AI剪辑预设', extensions: [VIDEO_EDIT_PRESET_PACKAGE_EXTENSION, 'json'] }]
const OPEN_FILTERS = [{ name: '痕迹AI剪辑预设', extensions: [...henjiDialogExtensions('preset_package'), 'json'] }]
function status(entry: VideoEditPresetEntry): string[] {
  return [entry.isDefault ? '默认' : '', entry.recommended ? '推荐' : '', entry.rating ? `${entry.rating} 星` : ''].filter(Boolean)
}

/** Tiles and the dialog share one live player; audio-only effect presets have no picture to show. */
function PresetPicture({ entry, size, playing, label }: { entry: VideoEditPresetEntry; size: typeof TILE_SIZE; playing: boolean; label: string }): React.ReactElement {
  const source = useMemo(() => videoEditPresetSource(entry.category, entry.id), [entry.category, entry.id])
  if (source.category === 'effect' && source.preset.media === 'audio') return <span className="flex h-full w-full items-center justify-center text-xs text-text3">声音效果</span>
  return <VideoEditPresetPlayer source={source} size={size} playing={playing} label={label} />
}
function PresetDetail({ entry, instance, onClose, onError }: { entry: VideoEditPresetEntry; instance: VideoEditInstance; onClose: () => void; onError: (reason: unknown) => void }): React.ReactElement {
  const { showNotification } = useNotification()
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<void> | void): Promise<void> => { setBusy(true); try { await action() } catch (reason) { onError(reason) } finally { setBusy(false) } }
  const sequenceId = instance.activeSequenceId
  const exportOne = (): Promise<void> => run(async () => {
    const path = await saveDialog({ defaultPath: `${entry.name}.${VIDEO_EDIT_PRESET_PACKAGE_EXTENSION}`, filters: FILTERS }); if (!path) return
    await writeTextFile(path, exportVideoEditPresetPackage([entry])); showNotification(`已导出“${entry.name}”。`)
  })
  return <UiModal isOpen title={entry.name} size="editor" onClose={onClose} footer={<>
    {!entry.builtin && <UiButton variant="danger" disabled={busy} className="mr-auto" onClick={() => { void run(() => { deleteVideoEditPreset(entry.category, entry.id); onClose() }) }}>删除</UiButton>}
    {videoEditPresetExportable(entry.category, entry.id) && <UiButton variant="secondary" disabled={busy} onClick={() => { void exportOne() }}>导出</UiButton>}
    <UiButton variant="primary" loading={busy} disabledReason={!sequenceId ? '先打开一个序列' : undefined} disabled={!sequenceId} onClick={() => { void run(async () => { showNotification(await applyVideoEditPreset(instance.document.id, sequenceId!, entry.category, entry.id)); onClose() }) }}>应用</UiButton>
  </>}>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]" data-video-edit-preset-detail={entry.category}>
      <div className="flex min-w-0 flex-col gap-4">
        <span className={`${UI_COVER_FRAME_CLASS} block aspect-video w-full overflow-hidden`}><PresetPicture entry={entry} size={DETAIL_SIZE} playing label={`${entry.name}动态预览`} /></span>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <UiGroup labelWidth={96}>
          <UiFormRow label="喜爱程度" density="compact">
            <span className="flex items-center gap-1" role="group" aria-label="喜爱程度">
              {Array.from({ length: VIDEO_EDIT_PRESET_MAX_RATING }, (_, index) => index + 1).map(value => <UiIconButton key={value} size="sm" on={entry.rating >= value} label={`${value} 星`} aria-pressed={entry.rating >= value} onClick={() => { void run(() => setVideoEditPresetRating(entry.category, entry.id, entry.rating === value ? 0 : value)) }}><Star /></UiIconButton>)}
            </span>
          </UiFormRow>
          {VIDEO_EDIT_PRESET_DEFAULTABLE.includes(entry.category) && <UiFormRow label="设为默认" density="compact" info={DEFAULT_HINT[entry.category]}><UiSwitch aria-label="设为默认" checked={entry.isDefault} disabled={busy || entry.category === 'transition' && entry.isDefault} onCheckedChange={value => { void run(() => setVideoEditPresetDefault(entry.category, value ? entry.id : null)) }} /></UiFormRow>}
        </UiGroup>
        {entry.meta && <p className={UI_TEXT_META_CLASS}>{entry.meta}</p>}
      </div>
    </div>
  </UiModal>
}
const DEFAULT_HINT: Partial<Record<VideoEditPresetCategory, string>> = {
  text: '新字幕没有可参照的样式时使用它。',
  transition: '快捷键添加的默认视频转场；同一时间只有一个。',
}

function PresetTile({ entry, instance, onOpen, onApply }: { entry: VideoEditPresetEntry; instance: VideoEditInstance; onOpen: () => void; onApply: () => void }): React.ReactElement {
  const [hovered, setHovered] = useState(false)
  const drag = (event: React.DragEvent): void => {
    if (entry.category === 'effect') startVideoEditEffectDrag(event.dataTransfer, instance.document.id, `preset:${entry.id}`)
    else if (entry.category === 'transition') startVideoEditTransitionDrag(event.dataTransfer, instance.document.id, entry.id as VideoEditTransitionKind)
    else event.preventDefault()
  }
  const draggable = entry.category === 'effect' || entry.category === 'transition'
  return <UiOptionButton variant="cover" className="w-full min-w-0" data-video-edit-preset={`${entry.category}:${entry.id}`} draggable={draggable} onDragStart={drag}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onClick={onOpen} onDoubleClick={onApply} aria-label={`${entry.name}，${[...status(entry), '单击查看，双击应用'].join('，')}`}>
    <span className={`${UI_COVER_FRAME_CLASS} block aspect-video w-full overflow-hidden`}><PresetPicture entry={entry} size={TILE_SIZE} playing={hovered} label={`${entry.name}预览`} /></span>
    <span className="block w-full min-w-0 px-0.5">
      <span className="block truncate text-xs text-text1">{entry.name}</span>
      <span className={`block truncate ${UI_TEXT_META_CLASS}`}>{status(entry).join(' · ') || entry.meta}</span>
    </span>
  </UiOptionButton>
}

/** 预设面板：所有剪辑预设的动态预览与管理（导入导出、删除、默认、喜爱程度）；排序为默认 → 评分 → 原顺序。 */
function Content({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible?: boolean }): React.ReactElement {
  const { showNotification } = useNotification()
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const [category, setCategory] = useState<VideoEditPresetCategory>('text')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const sequence = instance.activeSequenceId ? getActiveVideoEditSequence(instance) : undefined
  const entries = listVideoEditPresets(category).filter(entry => !query.trim() || `${entry.name} ${entry.meta}`.toLowerCase().includes(query.trim().toLowerCase()))
  const personal = listVideoEditPresets(category).filter(entry => !entry.builtin && videoEditPresetExportable(entry.category, entry.id))
  const detail = open ? listVideoEditPresets(category).find(entry => `${entry.category}:${entry.id}` === open) : undefined
  const apply = (entry: VideoEditPresetEntry): void => { if (!sequence) return; void applyVideoEditPreset(instance.document.id, sequence.id, entry.category, entry.id).then(text => showNotification(text), onError) }
  const importFiles = async (): Promise<void> => {
    try {
      const selected = await openDialog({ multiple: true, filters: OPEN_FILTERS }); const paths = selected === null ? [] : Array.isArray(selected) ? selected : [selected]
      let count = 0
      for (const path of paths) count += (await importVideoEditPresetPackage(await readTextFile(path))).length
      if (count) showNotification(`已导入 ${count} 个预设。`)
    } catch (reason) { onError(reason) }
  }
  const exportPersonal = async (): Promise<void> => {
    try {
      const path = await saveDialog({ defaultPath: `${VIDEO_EDIT_PRESET_CATEGORY_LABELS[category]}预设.${VIDEO_EDIT_PRESET_PACKAGE_EXTENSION}`, filters: FILTERS }); if (!path) return
      await writeTextFile(path, exportVideoEditPresetPackage(personal)); showNotification(`已导出 ${personal.length} 个${VIDEO_EDIT_PRESET_CATEGORY_LABELS[category]}预设。`)
    } catch (reason) { onError(reason) }
  }
  return <div className="flex h-full min-h-0 flex-col gap-2 px-3 py-3" aria-label="预设" data-video-edit-presets>
    <UiSegmented ariaLabel="预设类别" size="sm" fullWidth value={category} onChange={value => { setCategory(value); setOpen(null) }} options={VIDEO_EDIT_PRESET_PANEL_CATEGORIES.map(value => ({ value, label: VIDEO_EDIT_PRESET_CATEGORY_LABELS[value] }))} />
    <div className="flex items-center gap-1">
      <UiSearchInput size="sm" className="min-w-0 flex-1" aria-label="搜索预设" placeholder="搜索预设" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel="清除搜索" />
      <UiIconButton size="sm" label="导入预设" onClick={() => { void importFiles() }}><FolderInput /></UiIconButton>
      <UiIconButton size="sm" label={`导出全部个人${VIDEO_EDIT_PRESET_CATEGORY_LABELS[category]}预设`} disabled={!personal.length} disabledReason={`还没有个人${VIDEO_EDIT_PRESET_CATEGORY_LABELS[category]}预设`} onClick={() => { void exportPersonal() }}><FolderOutput /></UiIconButton>
    </div>
    {!sequence && <p className={UI_TEXT_META_CLASS}>打开序列后才能应用预设。</p>}
    <div className="min-h-0 flex-1 overflow-y-auto">
      {entries.length
        ? <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3" role="list" aria-label={`${VIDEO_EDIT_PRESET_CATEGORY_LABELS[category]}预设`}>
          {visible && entries.map(entry => <div role="listitem" key={entry.id} className="min-w-0"><PresetTile entry={entry} instance={instance} onOpen={() => setOpen(`${entry.category}:${entry.id}`)} onApply={() => apply(entry)} /></div>)}
        </div>
        : <UiEmpty size="sm" title={query ? '没有匹配的预设' : category === 'effect' ? '还没有效果预设' : '还没有预设'} description={category === 'effect' && !query ? '在效果控件里把一组效果“保存为预设”，就会出现在这里。' : undefined} />}
    </div>
    {detail && <PresetDetail entry={detail} instance={instance} onClose={() => setOpen(null)} onError={onError} />}
  </div>
}
export function VideoEditPresetsPanel(props: Parameters<typeof Content>[0]): React.ReactElement { return <Content {...props} /> }
