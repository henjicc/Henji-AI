import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, ScanFace, Sparkles, Star } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { UiOptionButton, UiSearchInput } from '@/components/ui'
import Tooltip from '@/components/ui/Tooltip'
import { useContextMenu } from '@/hooks/useContextMenu'
import { ICON_MEDIA_AUDIO, ICON_VIDEO_EDIT_TRANSITION } from '@/core/theme/icons'
import { VIDEO_EDIT_EFFECT_CATEGORIES, videoEditEffectsRegistry, type VideoEditEffectCategory, type VideoEditEffectsRegistryEntry } from '@/core/videoEdit/effectsRegistry'
import { videoEditDefaultTransitionKind, videoEditTransitionMedium } from '@/core/videoEdit/transitions'
import { useSettingsStore } from '@/stores/settingsStore'
import type { VideoEditInstance } from '../application/videoEditService'
import { endVideoEditTransitionDrag, startVideoEditTransitionDrag } from './videoEditTransitionDrag'
import { endVideoEditEffectDrag, startVideoEditEffectDrag } from './videoEditEffectDrag'
import { applyVideoEditTransitionToSelection } from '../application/videoEditTransitions'
import { applyVideoEditBuiltinEffect } from '../application/videoEditCompositing'

/**
 * 效果面板（PR“效果”）：视频效果、视频过渡、音频效果、音频过渡与智能五个文件夹的可搜索树，条目来自效果登记表
 * （`@/core/videoEdit/effectsRegistry`）。过渡拖到时间线上两个片段相接处：落在切点上居中，左侧终点对齐切点、右侧起点对齐切点；
 * 右键“设为默认过渡”决定 Ctrl+D／Ctrl+Shift+D／Shift+D 用哪一个（标“默认”）。
 */
export function VideoEditEffectsLibraryPanel({ instance, onError }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible?: boolean }): React.ReactElement {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<VideoEditEffectCategory>>(new Set())
  const defaults = useSettingsStore(state => state.videoEditDefaultTransitions)
  const setDefault = useSettingsStore(state => state.setVideoEditDefaultTransition)
  const menu = useContextMenu()
  const keyword = query.trim().toLowerCase()
  const entries = videoEditEffectsRegistry()
  const folders = VIDEO_EDIT_EFFECT_CATEGORIES.map(category => ({ ...category, entries: entries.filter(entry => entry.category === category.id && (!keyword || entry.name.toLowerCase().includes(keyword) || category.name.includes(keyword) || Boolean(entry.group?.includes(keyword)))) }))
    .filter(folder => !keyword || folder.entries.length)
  const isDefault = (entry: VideoEditEffectsRegistryEntry): boolean => Boolean(entry.transitionKind && videoEditDefaultTransitionKind(defaults, videoEditTransitionMedium(entry.transitionKind)) === entry.transitionKind)
  const toggle = (id: VideoEditEffectCategory): void => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const TransitionIcon = ICON_VIDEO_EDIT_TRANSITION
  const AudioIcon = ICON_MEDIA_AUDIO
  // PR：选中片段后双击效果，加到所有选中的同媒介片段（画面效果加画面片段、音频效果加声音片段；一步撤销）。
  const applyToSelection = (templateRef: string): void => {
    try {
      if (!instance.selectedClipIds.length) throw new Error('先在时间线上选中片段，再双击效果；也可以把效果直接拖到片段上。')
      applyVideoEditBuiltinEffect(instance.document.id, instance.activeSequenceId, instance.selectedClipIds, templateRef)
    } catch (error) { onError(error) }
  }
  return <div className="flex h-full min-h-0 flex-col gap-2 px-3 py-2.5" aria-label="效果" data-video-edit-effects-library>
    <UiSearchInput size="sm" aria-label="搜索效果" placeholder="搜索效果与过渡" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel="清除搜索" />
    <div role="tree" aria-label="效果与过渡" className="flex min-h-0 flex-1 flex-col overflow-auto">
      {folders.length ? folders.map(folder => {
        const open = Boolean(keyword) || !collapsed.has(folder.id)
        return <div key={folder.id} role="treeitem" aria-expanded={open} aria-selected={false} data-video-edit-effects-folder={folder.id}>
          <UiOptionButton variant="menu" size="sm" className="w-full min-w-0 justify-start gap-1.5" onClick={() => toggle(folder.id)}>
            {open ? <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-text3" /> : <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-text3" />}
            <Folder size={14} aria-hidden="true" className="shrink-0 text-text3" />
            <span className="min-w-0 flex-1 truncate text-left">{folder.name}</span>
          </UiOptionButton>
          {open && <div role="group" className="flex flex-col pl-5">
            {folder.entries.length ? folder.entries.map((entry, index) => <Fragment key={entry.id}>
              {entry.group && entry.group !== folder.entries[index - 1]?.group && <span className="px-2 pb-0.5 pt-1.5 text-2xs text-text3" aria-hidden="true">{entry.group}</span>}
              <Tooltip content={`${entry.tooltip}。${entry.kind === 'transition' ? '拖到时间线上两个片段相接处或片段一端，或选中片段后双击应用。' : '拖到片段上，或选中片段后双击应用。'}`} placement="left">
              <UiOptionButton variant="menu" size="sm" className="w-full min-w-0 justify-start gap-2" role="treeitem" aria-selected={false} draggable={entry.kind === 'transition' || Boolean(entry.templateRef)} data-video-edit-effects-entry={entry.id}
                onDragStart={event => { if (entry.transitionKind) startVideoEditTransitionDrag(event.dataTransfer, instance.document.id, entry.transitionKind); else if (entry.templateRef) startVideoEditEffectDrag(event.dataTransfer, instance.document.id, entry.templateRef) }}
                onDragEnd={() => { endVideoEditTransitionDrag(); endVideoEditEffectDrag() }}
                onDoubleClick={() => { if (entry.templateRef) applyToSelection(entry.templateRef); else if (entry.transitionKind) void applyVideoEditTransitionToSelection(instance.document.id, entry.transitionKind).catch(onError) }}
                onContextMenu={event => { const kind = entry.transitionKind; if (kind) menu.showMenu(event, [{ id: 'default', label: '设为默认过渡', icon: <Star size={14} />, disabled: isDefault(entry), onClick: () => setDefault(videoEditTransitionMedium(kind), kind) }]) }}>
                {entry.kind === 'transition' ? <TransitionIcon size={14} aria-hidden="true" className="shrink-0 text-text3" /> : entry.media === 'audio' ? <AudioIcon size={14} aria-hidden="true" className="shrink-0 text-text3" /> : entry.category === 'smart' ? <ScanFace size={14} aria-hidden="true" className="shrink-0 text-text3" /> : <Sparkles size={14} aria-hidden="true" className="shrink-0 text-text3" />}
                <span className="min-w-0 flex-1 truncate text-left">{entry.name}</span>
                {isDefault(entry) && <span className="shrink-0 text-2xs text-text3">默认</span>}
              </UiOptionButton>
            </Tooltip>
            </Fragment>) : <span className="px-2 py-1 text-2xs text-text3">暂无可用项</span>}
          </div>}
        </div>
      }) : <span className="px-2 py-1 text-2xs text-text3">没有匹配的效果或过渡</span>}
    </div>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
  </div>
}
