import { useEffect, useRef, useSyncExternalStore } from 'react'
import { contributeAppMenus, type AppMenuCommand, type AppMenuEditRole } from '@/core/appMenu/appMenu'
import { VIDEO_EDIT_COMMANDS, videoEditCommandShortcut, videoEditShortcutLabel, type VideoEditCommandId, type VideoEditCommandScope } from '@/core/videoEdit/commands'
import { useSettingsStore } from '@/stores/settingsStore'
import { activeVideoEditInstance, subscribeVideoEdit, subscribeVideoEditView, videoEditRevision, videoEditViewRevision } from './application/videoEditService'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from './application/videoEditCommands'
import { subscribeVideoEditAnnotationSelection, videoEditAnnotationSelectionRevision } from './application/videoEditAnnotations'

/** `scope`：这一组固定在某个作用域执行（批注菜单不随当前面板走，免得在时间线上点“删除”删掉片段）；不写就跟当前面板。 */
const groups: readonly { menu: string; label?: string; scope?: VideoEditCommandScope; ids: readonly VideoEditCommandId[] }[] = [
  { menu: 'file', ids: ['new_project', 'import', 'save', 'export'] },
  { menu: 'edit', ids: ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'select_all'] },
  { menu: 'sequence', label: '序列', ids: ['new_sequence', 'match_frame', 'reverse_match_frame', 'apply_video_transition', 'apply_audio_transition', 'toggle_motion_blur', 'toggle_frame_blend'] },
  { menu: 'clip', label: '剪辑', ids: ['split', 'split_tracks', 'ripple_delete', 'toggle_clip_enabled', 'link', 'unlink', 'group', 'ungroup', 'clip_speed', 'audio_gain', 'separate_audio'] },
  { menu: 'marker', label: '标记', ids: ['add_marker', 'prev_marker', 'next_marker', 'mark_in', 'mark_out', 'clear_in_out'] },
  { menu: 'annotation', label: '批注', scope: 'annotations', ids: ['select_all', 'annotations_select_in_out', 'annotations_select_clips', 'annotations_resolve', 'annotations_reject', 'annotations_mark_addressed', 'delete', 'annotations_clear_handled', 'annotations_clear_all'] },
  { menu: 'view', ids: ['toggle_safe_margins'] },
]
const editRoles: Partial<Record<VideoEditCommandId, AppMenuEditRole>> = { undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste', select_all: 'selectAll' }
/** 全选、删除在批注作用域里作用于批注，菜单上写明。 */
const annotationLabels: Partial<Record<VideoEditCommandId, string>> = { select_all: '全选批注', delete: '删除选中批注' }
const dangerous = new Set<VideoEditCommandId>(['delete', 'annotations_clear_handled', 'annotations_clear_all'])

/** 菜单与快捷键共用命令上下文、可用性和用户改键；执行前重新捕获当前状态。 */
export function VideoEditAppMenus(): null {
  const withdraw = useRef<() => void>()
  const revision = useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const viewRevision = useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const annotationRevision = useSyncExternalStore(subscribeVideoEditAnnotationSelection, videoEditAnnotationSelectionRevision)
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
      const panelScope = owner?.activePanel ?? 'timeline'
      const contexts = new Map<VideoEditCommandScope, ReturnType<typeof captureVideoEditCommandContext>>()
      const contextOf = (scope: VideoEditCommandScope) => { if (!contexts.has(scope)) contexts.set(scope, captureVideoEditCommandContext(projectId, scope)); return contexts.get(scope)! }
      const item = (id: VideoEditCommandId, fixed?: VideoEditCommandScope): AppMenuCommand => {
        const descriptor = VIDEO_EDIT_COMMANDS.find(command => command.id === id)!
        const scope = fixed ?? panelScope
        const state = videoEditCommandState(contextOf(scope), id)
        const shortcut = videoEditCommandShortcut(id, shortcuts)
        return {
          kind: 'action', id: fixed ? `videoEdit.${fixed}.${id}` : `videoEdit.${id}`, label: (scope === 'annotations' ? annotationLabels[id] : undefined) ?? descriptor.title,
          shortcut: shortcut ? videoEditShortcutLabel(shortcut) : undefined, editRole: fixed ? undefined : editRoles[id],
          disabledReason: state.enabled ? undefined : state.reason, checked: state.checked, danger: scope === 'annotations' && dangerous.has(id) ? true : undefined,
          run: () => executeVideoEditCommand(captureVideoEditCommandContext(projectId, fixed ?? activeVideoEditInstance()?.activePanel ?? 'timeline'), id),
        }
      }
      withdraw.current = contributeAppMenus('videoEdit', groups.map(group => ({ menu: group.menu, label: group.label, order: 100, items: group.ids.map(id => item(id, group.scope)) })))
    }, withdraw.current ? 150 : 0)
    return () => clearTimeout(timer)
  }, [revision, viewRevision, annotationRevision, shortcuts])
  return null
}
