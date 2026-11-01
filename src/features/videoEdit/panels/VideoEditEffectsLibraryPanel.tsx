import { UI_ICON_SIZE } from '@/core/theme/icons'
import { notificationText } from '@/i18n/notifications'
import { Fragment, useMemo, useState, useSyncExternalStore } from 'react'
import { ChevronDown, ChevronRight, Folder, Pencil, ScanFace, Sparkles, Star, Trash2 } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { UI_COVER_FRAME_CLASS, UiEmpty, UiError, UiIconButton, UiOptionButton, UiSearchInput, UiSpinner } from '@/components/ui'
import Tooltip from '@/components/ui/Tooltip'
import { useContextMenu } from '@/hooks/useContextMenu'
import { ICON_MEDIA_AUDIO, ICON_VIDEO_EDIT_TRANSITION } from '@/core/theme/icons'
import { VIDEO_EDIT_EFFECT_CATEGORIES, videoEditEffectsRegistry } from '@/core/videoEdit/effectsRegistry'
import { videoEditDefaultTransitionKind, videoEditTransitionMedium } from '@/core/videoEdit/transitions'
import { useSettingsStore } from '@/stores/settingsStore'
import { setVideoEditTimelineView, subscribeVideoEditDomain, videoEditDomainRevision, type VideoEditInstance } from '../application/videoEditService'
import { endVideoEditTransitionDrag, startVideoEditTransitionDrag } from './videoEditTransitionDrag'
import { endVideoEditEffectDrag, startVideoEditEffectDrag, startVideoEditStylePieceDrag, videoEditEffectDropClips } from './videoEditEffectDrag'
import { applyVideoEditTransitionToSelection } from '../application/videoEditTransitions'
import { applyVideoEditBuiltinEffect, applyVideoEditStylePiece } from '../application/videoEditCompositing'
import { filterVideoEditLibraryEntries, listVideoEditStylePieces, useVideoEditEffectLibraryStore, videoEditStylePieceLibraryEntries, type VideoEditEffectPreset, type VideoEditLibraryEntry, type VideoEditStylePieceEntry } from '../application/videoEditEffectPresets'
import { VideoEditEffectPresetDialog } from './VideoEditEffectPresetDialog'
import { VideoEditPresetPlayer } from './VideoEditPresetPlayer'

/** 与预设面板的格子同一渲染尺寸，两处共用预览缓存。 */
const PREVIEW_SIZE = { width: 320, height: 180 }
function StylePiecePreview({ preset }: { preset: VideoEditEffectPreset }): React.ReactElement {
  const source = useMemo(() => ({ category: 'effect' as const, preset }), [preset])
  return <span className={`${UI_COVER_FRAME_CLASS} block aspect-video w-72 overflow-hidden`}><VideoEditPresetPlayer source={source} size={PREVIEW_SIZE} playing label={`${preset.name}预览`} trustAction={false} /></span>
}

/**
 * 效果面板（PR“效果”）：收藏、风格件与视频效果、视频过渡、音频效果、音频过渡、智能几个文件夹的可搜索树，内置条目来自效果登记表
 * （`@/core/videoEdit/effectsRegistry`）。风格件来自全局库与当前序列绑定的风格，悬停看动态预览。过渡拖到时间线上两个片段相接处：
 * 落在切点上居中，左侧终点对齐切点、右侧起点对齐切点；右键“设为默认过渡”决定 Ctrl+D／Ctrl+Shift+D／Shift+D 用哪一个（标“默认”）。
 */
export function VideoEditEffectsLibraryPanel({ instance, onError, onEffectsAdded }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible?: boolean; onEffectsAdded?: (effectIds: readonly string[]) => void }): React.ReactElement {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set(['more']))
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [applying, setApplying] = useState<string | null>(null)
  const favorites = useVideoEditEffectLibraryStore(state => state.favorites)
  const libraryRevision = useVideoEditEffectLibraryStore(state => state.revision)
  const loadError = useVideoEditEffectLibraryStore(state => state.loadError)
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const defaults = useSettingsStore(state => state.videoEditDefaultTransitions)
  const setDefault = useSettingsStore(state => state.setVideoEditDefaultTransition)
  const menu = useContextMenu()
  const keyword = query.trim().toLowerCase()
  const projectId = instance.document.id
  const sequenceId = instance.activeSequenceId
  const hasSequence = instance.document.sequences.some(sequence => sequence.id === sequenceId)
  // 全局库或序列绑定的风格一变，列表就重新读取；同一修订内保持同一份数据，预览不重建。
  const pieces = useMemo(() => hasSequence ? listVideoEditStylePieces(projectId, sequenceId) : [], [libraryRevision, instance.document, projectId, sequenceId, hasSequence]) // eslint-disable-line react-hooks/exhaustive-deps -- 修订与文档身份即列表来源
  const entries = [...videoEditEffectsRegistry(), ...videoEditStylePieceLibraryEntries(pieces)]
  const matching = filterVideoEditLibraryEntries(entries, query)
  const folders = [
    { id: 'favorites', name: '收藏', entries: filterVideoEditLibraryEntries(entries.filter(entry => favorites.includes(entry.id)), query, '收藏') },
    { id: 'presets', name: '风格件', entries: matching.filter(entry => entry.category === 'presets') },
    ...VIDEO_EDIT_EFFECT_CATEGORIES.map(category => ({ ...category, entries: matching.filter(entry => entry.category === category.id) })),
  ]
    .filter(folder => folder.entries.length)
  const isDefault = (entry: VideoEditLibraryEntry): boolean => Boolean(entry.transitionKind && videoEditDefaultTransitionKind(defaults, videoEditTransitionMedium(entry.transitionKind)) === entry.transitionKind)
  const toggle = (id: string): void => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const favorite = (id: string): void => { try { useVideoEditEffectLibraryStore.getState().toggleFavorite(id) } catch (error) { onError(error) } }
  /** 风格的成员由风格自己管理，面板里只能应用；全局风格件可收藏、改名、删除。 */
  const globalPiece = (entry: VideoEditLibraryEntry): VideoEditStylePieceEntry | undefined => entry.piece && !entry.piece.styleId ? entry.piece : undefined
  const favorable = (entry: VideoEditLibraryEntry): boolean => !entry.piece || Boolean(globalPiece(entry))
  const TransitionIcon = ICON_VIDEO_EDIT_TRANSITION
  const AudioIcon = ICON_MEDIA_AUDIO
  const added = (targets: readonly string[], effectIds: readonly string[]): void => {
    if (!effectIds.length) return
    // 混合媒介多选时保持整个选区，只将控件所查看的主片段切到实际添加成功的片段。
    if (!targets.includes(instance.selection ?? '')) setVideoEditTimelineView(projectId, {}, targets[0])
    onEffectsAdded?.(effectIds)
  }
  // PR：选中片段后双击效果，加到所有选中的同媒介片段（画面效果加画面片段、音频效果加声音片段；一步撤销）。
  const applyEntry = (entry: VideoEditLibraryEntry): void => {
    if (!entry.templateRef && !entry.piece) {
      if (entry.transitionKind) void applyVideoEditTransitionToSelection(projectId, entry.transitionKind).catch(onError)
      return
    }
    if (applying) return
    if (!instance.selectedClipIds.length) { onError(new Error(notificationText('effectUnavailable'))); return }
    try {
      const sequence = instance.document.sequences.find(value => value.id === sequenceId)
      if (!sequence) throw new Error('原序列已移除。')
      // 与拖放预览共用媒介、素材与锁定轨道判定；预期的不可用选区只给短提示。
      const targets = videoEditEffectDropClips(sequence, instance.selectedClipIds[0], instance.selectedClipIds, entry.piece ?? entry.templateRef)
      if (!targets.length) {
        onError(new Error(notificationText('effectUnavailable')))
        return
      }
      if (entry.piece) {
        // 含代码成员的风格件要先试渲染，完成前不再接受第二次应用。
        setApplying(entry.id)
        void applyVideoEditStylePiece(projectId, sequenceId, targets, entry.piece.ref).then(effectIds => added(targets, effectIds)).catch(onError).finally(() => setApplying(null))
        return
      }
      added(targets, applyVideoEditBuiltinEffect(projectId, sequenceId, instance.selectedClipIds, entry.templateRef!))
    } catch (error) { onError(error) }
  }
  const hint = (entry: VideoEditLibraryEntry): string => `${entry.tooltip.replace(/。$/, '')}。${entry.kind === 'transition' ? '拖到时间线上两个片段相接处或片段一端，或选中片段后双击应用。' : entry.category === 'generator' ? '拖到轨道空白处新建一段；拖到片段上，就在它的范围里生成。' : '拖到片段上，或选中片段后双击应用。'}`
  return <div className="flex h-full min-h-0 flex-col gap-2 px-3 py-3" aria-label="效果" data-video-edit-effects-library>
    <UiSearchInput size="sm" aria-label="搜索效果" placeholder="搜索效果与过渡" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel="清除搜索" />
    {loadError && <UiError size="xs" title="效果库读取失败" message={loadError} />}
    <div role="tree" aria-label="效果与过渡" className="flex min-h-0 flex-1 flex-col overflow-auto">
      {folders.length ? folders.map(folder => {
        const open = Boolean(keyword) || !collapsed.has(folder.id)
        return <div key={folder.id} role="treeitem" aria-expanded={open} aria-selected={false} data-video-edit-effects-folder={folder.id}>
          <UiOptionButton variant="menu" size="sm" className="w-full min-w-0 justify-start gap-1.5" onClick={() => toggle(folder.id)}>
            {open ? <ChevronDown size={UI_ICON_SIZE.sm} aria-hidden="true" className="shrink-0 text-text3" /> : <ChevronRight size={UI_ICON_SIZE.sm} aria-hidden="true" className="shrink-0 text-text3" />}
            <Folder size={UI_ICON_SIZE.sm} aria-hidden="true" className="shrink-0 text-text3" />
            <span className="min-w-0 flex-1 truncate text-left">{folder.name}</span>
          </UiOptionButton>
          {open && <div role="group" className="flex flex-col pl-5">
            {folder.entries.length ? folder.entries.map((entry, index) => <Fragment key={entry.id}>
              {entry.group && entry.group !== folder.entries[index - 1]?.group && <span className="truncate px-2 pb-0.5 pt-1.5 text-2xs text-text3" aria-hidden="true">{entry.group}</span>}
              <div className="flex min-w-0 items-center gap-1">
              <div className="min-w-0 flex-1">
              <Tooltip content={entry.piece && entry.media === 'video' ? <span className="flex flex-col gap-1.5 py-1"><StylePiecePreview preset={entry.piece.preset} /><span>{hint(entry)}</span></span> : hint(entry)} placement="left">
              <UiOptionButton variant="menu" size="sm" className="w-full min-w-0 justify-start gap-2" role="treeitem" aria-selected={false} aria-busy={applying === entry.id || undefined} draggable={entry.kind === 'transition' || Boolean(entry.templateRef || entry.piece)} data-video-edit-effects-entry={entry.id}
                onDragStart={event => { if (entry.transitionKind) startVideoEditTransitionDrag(event.dataTransfer, projectId, entry.transitionKind); else if (entry.piece) startVideoEditStylePieceDrag(event.dataTransfer, projectId, entry.piece); else if (entry.templateRef) startVideoEditEffectDrag(event.dataTransfer, projectId, entry.templateRef) }}
                onDragEnd={() => { endVideoEditTransitionDrag(); endVideoEditEffectDrag() }}
                onDoubleClick={() => applyEntry(entry)}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!event.repeat && !event.nativeEvent.isComposing) applyEntry(entry) } }}
                onContextMenu={event => {
                  const kind = entry.transitionKind
                  const piece = globalPiece(entry)
                  if (!favorable(entry)) { event.preventDefault(); return }
                  menu.showMenu(event, [
                    { id: 'favorite', label: favorites.includes(entry.id) ? '取消收藏' : '收藏', icon: <Star size={UI_ICON_SIZE.sm} />, onClick: () => favorite(entry.id) },
                    ...(kind ? [{ id: 'default', label: '设为默认过渡', icon: <Star size={UI_ICON_SIZE.sm} />, disabled: isDefault(entry), onClick: () => setDefault(videoEditTransitionMedium(kind), kind) }] : []),
                    ...(piece ? [
                      { id: 'rename', label: '重命名…', icon: <Pencil size={UI_ICON_SIZE.sm} />, onClick: () => setRenaming({ id: piece.preset.id, name: piece.preset.name }) },
                      { id: 'delete', label: '删除风格件', icon: <Trash2 size={UI_ICON_SIZE.sm} />, onClick: () => { void useVideoEditEffectLibraryStore.getState().deletePreset(piece.preset.id).catch(onError) } },
                    ] : []),
                  ])
                }}>
                {entry.kind === 'transition' ? <TransitionIcon size={UI_ICON_SIZE.sm} aria-hidden="true" className="shrink-0 text-text3" /> : entry.media === 'audio' ? <AudioIcon size={UI_ICON_SIZE.sm} aria-hidden="true" className="shrink-0 text-text3" /> : entry.category === 'smart' ? <ScanFace size={UI_ICON_SIZE.sm} aria-hidden="true" className="shrink-0 text-text3" /> : <Sparkles size={UI_ICON_SIZE.sm} aria-hidden="true" className="shrink-0 text-text3" />}
                <span className="min-w-0 flex-1 truncate text-left">{entry.name}</span>
                {isDefault(entry) && <span className="shrink-0 text-2xs text-text3">默认</span>}
                {applying === entry.id && <UiSpinner size="2xs" />}
              </UiOptionButton>
            </Tooltip>
              </div>
              {favorable(entry) ? <UiIconButton size="2xs" on={favorites.includes(entry.id)} aria-pressed={favorites.includes(entry.id)} aria-label={`${favorites.includes(entry.id) ? '取消收藏' : '收藏'}${entry.name}`} tooltip={favorites.includes(entry.id) ? '取消收藏' : '收藏'} onClick={() => favorite(entry.id)}><Star  /></UiIconButton> : <span className="w-5 shrink-0" aria-hidden="true" />}
              </div>
            </Fragment>) : <UiEmpty size="xs" title={folder.id === 'favorites' ? '尚未收藏效果' : folder.id === 'presets' ? hasSequence ? '在效果控件中保存风格件' : '打开序列后显示风格件' : '暂无可用项'} />}
          </div>}
        </div>
      }) : <UiEmpty size="xs" title="没有匹配的效果或过渡" />}
    </div>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
    {renaming && <VideoEditEffectPresetDialog presetId={renaming.id} initialName={renaming.name} onClose={() => setRenaming(null)} />}
  </div>
}
