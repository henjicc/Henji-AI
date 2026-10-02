import { Copy, Clipboard, Scissors, Trash2, Link2, Unlink, Group, Ungroup, Locate, Play, SlidersHorizontal, AudioLines, ArrowRightToLine, ListChecks, MoveHorizontal, ChevronsLeftRight } from 'lucide-react'
import { expandVideoEditSelection, videoEditPickRelations } from '@/core/videoEdit/timelineSelection'
import { useContextMenu, type MenuItem } from '@/hooks/useContextMenu'
import { useSettingsStore } from '@/stores/settingsStore'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from '../application/videoEditCommands'
import { setVideoEditTimelineView, type VideoEditInstance } from '../application/videoEditService'
import { timelineCommandPresentation } from './timelineCommandPresentation'
import { elementOfEventTarget } from '@/utils/crossRealmDom'

const actionIcons = { copy: Copy, paste: Clipboard, insert: ArrowRightToLine, overwrite: Clipboard, split: Scissors, split_tracks: Scissors, delete: Trash2, ripple_delete: Trash2, link: Link2, unlink: Unlink, group: Group, ungroup: Ungroup, separate_audio: AudioLines, locate_source: Play, locate_project: Locate, locate_effects: SlidersHorizontal, select_all: ListChecks, move_into_sync: MoveHorizontal, slip_into_sync: ChevronsLeftRight } as const
type MenuCommand = keyof typeof actionIcons

export function useTimelineMenu(instance: VideoEditInstance, onError: (error: unknown) => void, cancelPointer: () => void) {
  const menu = useContextMenu()
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const show = (event: React.MouseEvent): void => {
    // 浮窗中的目标属于子窗口 realm，不能用 instanceof Element 判定。
    const target = elementOfEventTarget(event.target)
    if (!target || target.closest('[data-video-edit-track-header]')) return
    cancelPointer()
    try {
      const clipId = target.closest('[data-video-edit-clip]')?.getAttribute('data-video-edit-clip')
      const sequence = instance.document.sequences.find(value => value.id === instance.activeSequenceId)!
      // Right-clicking an unselected clip picks it like a left click (Linked Selection and groups; Alt singles it out).
      const ids = clipId ? instance.selectedClipIds.includes(clipId) ? [clipId, ...instance.selectedClipIds.filter(id => id !== clipId)] : [clipId, ...expandVideoEditSelection(sequence, [clipId], videoEditPickRelations(instance.linkedSelection !== false, event.altKey)).filter(id => id !== clipId)] : []
      if (clipId) setVideoEditTimelineView(instance.document.id, { selectedClipIds: ids }, clipId)
      // Freeze at menu opening. The shared menu executes its callback after closing, not at this event.
      const context = captureVideoEditCommandContext(instance.document.id, 'timeline', { clipIds: ids })
      const optional = (id: MenuCommand): MenuCommand[] => videoEditCommandState(context, id).enabled ? [id] : []
      const commands: MenuCommand[] = clipId ? ['locate_source', 'locate_project', 'locate_effects', 'copy', 'paste', 'split', 'split_tracks', 'delete', 'ripple_delete', 'link', ...optional('unlink'), 'group', ...optional('ungroup'), 'separate_audio', ...optional('move_into_sync'), ...optional('slip_into_sync')] : ['paste', 'insert', 'overwrite', 'select_all']
      const dividers = new Set<VideoEditCommandId>(['locate_effects', 'paste', 'split_tracks', 'ripple_delete', 'ungroup', 'separate_audio'])
      const items: MenuItem[] = commands.map(id => {
        const presentation = timelineCommandPresentation(context, id, shortcuts); const Icon = actionIcons[id]
        return { id, label: presentation.label, icon: <Icon size={16} />, disabled: !presentation.enabled, divider: dividers.has(id), onClick: () => executeVideoEditCommand(context, id).catch(onError) }
      })
      menu.showMenu(event, items)
    } catch (error) { onError(error) }
  }
  return { ...menu, show }
}
