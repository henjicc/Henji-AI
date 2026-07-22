import type { EditorView } from '@tiptap/pm/view'

import type { PromptEditorSubmitShortcut } from './types'

export function isPromptEditorHistoryShortcut(event: KeyboardEvent): boolean {
  if (!event.ctrlKey && !event.metaKey) return false
  const key = event.key.toLocaleLowerCase()
  return key === 'z' || key === 'y'
}

export function shouldSubmitPromptEditor(
  view: EditorView,
  event: KeyboardEvent,
  shortcut: PromptEditorSubmitShortcut,
): boolean {
  if (event.key !== 'Enter' || event.isComposing || view.composing) return false

  const hasModifier = event.ctrlKey || event.metaKey
  if (shortcut === 'enter') {
    return !hasModifier && !event.shiftKey && !event.altKey
  }

  return shortcut === 'mod-enter' && hasModifier
}
