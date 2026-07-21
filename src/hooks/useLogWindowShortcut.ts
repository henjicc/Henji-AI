import { createLogger } from '@/core/logging'
import { openLogWindow } from '@/commands/logging'
import { useEffect } from 'react'

const logger = createLogger('hooks.useLogWindowShortcut')

/**
 * 全局 Ctrl+Shift+L 快捷键，打开独立日志窗口（2.1 日志窗口骨架）。
 * 与 `useDevToolsShortcut` 同款门控策略：开发环境始终允许；生产环境需要测试模式已开启。
 * 必须挂载在不随 Tab 切换卸载的位置（如 App 根组件）。
 *
 * 未使用 Electron 全局快捷键（`globalShortcut`）或主进程 `before-input-event`，
 * 而是复用既有的渲染层 keydown 监听模式（与 Ctrl+Alt+Shift+T 测试面板快捷键一致）：
 * 主进程无需额外同步测试模式状态，门控逻辑与按钮可见性判断保持同一处、同一份代码。
 */
export function useLogWindowShortcut(): void {
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || !e.shiftKey || e.key.toLowerCase() !== 'l') return

      if (import.meta.env.DEV) {
        e.preventDefault()
        try {
          await openLogWindow()
        } catch (error) {
          logger.error('[LogWindow] 打开日志窗口失败', error)
        }
        return
      }

      e.preventDefault()
      try {
        const { getTestModeState } = await import('@/utils/testMode')
        if (!getTestModeState().enabled) return
        await openLogWindow()
      } catch (error) {
        logger.error('[LogWindow] 打开日志窗口失败', error)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
