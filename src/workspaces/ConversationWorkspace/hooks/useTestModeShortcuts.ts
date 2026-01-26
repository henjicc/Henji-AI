import { useEffect } from 'react'
import { logError, logInfo } from '@/utils/errorLogger'

export interface UseTestModeShortcutsParams {
  togglePanel: () => void
}

export function useTestModeShortcuts({ togglePanel }: UseTestModeShortcutsParams): void {
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        togglePanel()
      }

      if (e.key !== 'F12') return

      // 开发环境：始终允许打开 DevTools
      if (import.meta.env.DEV) {
        e.preventDefault()
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('toggle_devtools')
          logInfo('[DevTools] 开发者工具已切换', {})
        } catch (error) {
          logError('[DevTools] 打开开发者工具失败', error)
        }
        return
      }

      // 生产环境：需要测试模式授权
      e.preventDefault()
      try {
        const { getTestModeState } = await import('@/utils/testMode')
        const testMode = getTestModeState()
        if (!testMode.enabled || !testMode.options.enableDevTools) return

        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('toggle_devtools')
        logInfo('[DevTools] 开发者工具已切换', {})
      } catch (error) {
        logError('[DevTools] 打开开发者工具失败', error)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePanel])
}
