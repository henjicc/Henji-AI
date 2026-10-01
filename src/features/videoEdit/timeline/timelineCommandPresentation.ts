import { VIDEO_EDIT_COMMANDS, videoEditCommandShortcut, videoEditShortcutLabel, type VideoEditCommandId, type VideoEditShortcutOverrides } from '@/core/videoEdit/commands'
import { videoEditCommandState, type VideoEditCommandContext } from '../application/videoEditCommands'

/** Presentation only: titles, bindings and availability come from the formal command contract. */
export function timelineCommandPresentation(context: VideoEditCommandContext, id: VideoEditCommandId, shortcuts: VideoEditShortcutOverrides) {
  const descriptor = VIDEO_EDIT_COMMANDS.find(command => command.id === id)!
  const shortcut = videoEditCommandShortcut(id, shortcuts)
  const label = `${descriptor.title}${shortcut ? `（${videoEditShortcutLabel(shortcut)}）` : ''}`
  const state = videoEditCommandState(context, id)
  return { ...state, title: descriptor.title, label, tooltip: !state.enabled && state.reason ? `${label}：${state.reason}` : label }
}
