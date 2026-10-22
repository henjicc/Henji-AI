import { useEffect, useRef, useSyncExternalStore } from 'react'
import { contributeAppMenus, type AppMenuCommand, type AppMenuEditRole } from '@/core/appMenu/appMenu'
import { VIDEO_EDIT_COMMANDS, videoEditCommandShortcut, videoEditShortcutLabel, type VideoEditCommandId } from '@/core/videoEdit/commands'
import { useSettingsStore } from '@/stores/settingsStore'
import { activeVideoEditInstance, subscribeVideoEdit, subscribeVideoEditView, videoEditRevision, videoEditViewRevision } from './application/videoEditService'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from './application/videoEditCommands'

const groups: readonly { menu: string; label?: string; ids: readonly VideoEditCommandId[] }[] = [
  { menu: 'file', ids: ['new_project', 'import', 'save', 'export'] },
  { menu: 'edit', ids: ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'select_all'] },
  { menu: 'sequence', label: '序列', ids: ['new_sequence', 'match_frame', 'reverse_match_frame', 'apply_video_transition', 'apply_audio_transition'] },
  { menu: 'clip', label: '剪辑', ids: ['split', 'split_tracks', 'ripple_delete', 'link', 'unlink', 'group', 'ungroup', 'clip_speed', 'audio_gain', 'separate_audio'] },
  { menu: 'marker', label: '标记', ids: ['add_marker', 'prev_marker', 'next_marker', 'mark_in', 'mark_out', 'clear_in_out'] },
]
const editRoles: Partial<Record<VideoEditCommandId, AppMenuEditRole>> = { undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste', select_all: 'selectAll' }

/** 菜单与快捷键共用命令上下文、可用性和用户改键；执行前重新捕获当前状态。 */
export function VideoEditAppMenus(): null {
  const withdraw = useRef<() => void>()
  const revision = useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const viewRevision = useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  useEffect(() => () => { withdraw.current?.(); withdraw.current = undefined }, [])
  useEffect(() => {
    // 播放头每帧都会改变视图：播放与拖动播放头期间不重算菜单（33 个命令的可用性），停下后再算；
    // 其余视图变化合并到 150ms 后一次，避免在逐帧路径上做菜单工作。
    const owner = activeVideoEditInstance()
    if (withdraw.current && (owner?.playing || owner?.scrubbing)) return
    const timer = setTimeout(() => {
      const owner = activeVideoEditInstance()
      const projectId = owner?.document.id
      const scope = owner?.activePanel ?? 'timeline'
      const context = captureVideoEditCommandContext(projectId, scope)
      const item = (id: VideoEditCommandId): AppMenuCommand => {
        const descriptor = VIDEO_EDIT_COMMANDS.find(command => command.id === id)!
        const state = videoEditCommandState(context, id)
        const shortcut = videoEditCommandShortcut(id, shortcuts)
        return {
          kind: 'action', id: `videoEdit.${id}`, label: descriptor.title,
          shortcut: shortcut ? videoEditShortcutLabel(shortcut) : undefined, editRole: editRoles[id],
          disabledReason: state.enabled ? undefined : state.reason, checked: state.checked,
          run: () => executeVideoEditCommand(captureVideoEditCommandContext(projectId, activeVideoEditInstance()?.activePanel ?? 'timeline'), id),
        }
      }
      withdraw.current = contributeAppMenus('videoEdit', groups.map(group => ({ ...group, order: 100, items: group.ids.map(item) })))
    }, withdraw.current ? 150 : 0)
    return () => clearTimeout(timer)
  }, [revision, viewRevision, shortcuts])
  return null
}
