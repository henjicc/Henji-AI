/**
 * 键盘快捷键 Hook
 * 职责：管理键盘快捷键
 */

import { useEffect, useCallback } from 'react'

interface KeyboardShortcut {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  action: () => void
  description: string
}

export const useKeyboardShortcuts = (shortcuts: KeyboardShortcut[]) => {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    for (const shortcut of shortcuts) {
      const ctrlMatch = shortcut.ctrl === undefined || shortcut.ctrl === (e.ctrlKey || e.metaKey)
      const shiftMatch = shortcut.shift === undefined || shortcut.shift === e.shiftKey
      const altMatch = shortcut.alt === undefined || shortcut.alt === e.altKey
      const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase()

      if (ctrlMatch && shiftMatch && altMatch && keyMatch) {
        e.preventDefault()
        shortcut.action()
        break
      }
    }
  }, [shortcuts])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return { shortcuts }
}
