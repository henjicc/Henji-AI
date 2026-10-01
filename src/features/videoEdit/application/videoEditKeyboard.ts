import { matchVideoEditShortcut, type VideoEditCommandScope, type VideoEditKeyEvent, type VideoEditShortcutOverrides } from '@/core/videoEdit/commands'

/** DOM protection belongs to the host; command meanings and bindings stay in the shared registry. */
export function videoEditKeyboardCommand(event: VideoEditKeyEvent & { target: EventTarget | null }, fallback: VideoEditCommandScope, overrides: VideoEditShortcutOverrides) {
  const target = event.target instanceof HTMLElement ? event.target : null
  const editable = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]') || target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="dialog"],[role="menu"],[role="listbox"],[role="option"],[data-dropdown-portal]'))
  const nativeSpace = event.code === 'Space' && Boolean(target?.closest('button,[role="button"]'))
  const panel = target?.closest<HTMLElement>('[data-video-edit-panel]')?.dataset.videoEditPanel
  const scope = panel && ['timeline', 'program', 'source', 'project', 'effects'].includes(panel) ? panel as VideoEditCommandScope : fallback
  const id = matchVideoEditShortcut(event, scope, overrides, editable || nativeSpace)
  return id ? { id, scope } : undefined
}
