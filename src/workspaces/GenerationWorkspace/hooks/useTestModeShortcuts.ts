import { useEffect } from 'react'

export interface UseTestModeShortcutsParams {
  togglePanel: () => void
}

export function useTestModeShortcuts({ togglePanel }: UseTestModeShortcutsParams): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        togglePanel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePanel])
}

