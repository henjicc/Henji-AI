import { createLogger } from '@/core/logging'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import { useEffect } from 'react'

const logger = createLogger('hooks.useDevToolsShortcut')

/**
 * 全局 F12 开发者工具快捷键。
 * 必须挂载在不随 Tab 切换卸载的位置（如 App 根组件），
 * 否则切换到非"生成"Tab 时会随旧的挂载位置一起被移除。
 */
export function useDevToolsShortcut(): void {
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key !== 'F12') return

      // 开发环境：始终允许打开 DevTools
      if (import.meta.env.DEV) {
        e.preventDefault()
        try {
          if (!isDesktopRuntime()) return
          await getPlatform().window.toggleDevTools()
          logger.info('[DevTools] 开发者工具已切换', {})
        } catch (error) {
          logger.error('[DevTools] 打开开发者工具失败', error)
        }
        return
      }

      // 生产环境：需要测试模式授权
      e.preventDefault()
      try {
        const { getTestModeState } = await import('@/utils/testMode')
        const testMode = getTestModeState()
        if (!testMode.enabled || !testMode.options.enableDevTools) return

        if (!isDesktopRuntime()) return
        await getPlatform().window.toggleDevTools()
        logger.info('[DevTools] 开发者工具已切换', {})
      } catch (error) {
        logger.error('[DevTools] 打开开发者工具失败', error)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
