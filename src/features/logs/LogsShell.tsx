import { useEffect, useState } from 'react'
import { useApplyRuntimeTheme } from '@/hooks/useApplyRuntimeTheme'
import { useApplyUiScale } from '@/hooks/useApplyUiScale'
import { useI18n } from '@/hooks/useI18n'
import { getPlatform } from '@/platform/runtime'
import { UiWindowControl } from '@/components/ui'
import { WindowTitleBar } from '@/components/WindowTitleBar'
import { LogsPanel } from './LogsPanel'

/**
 * 独立日志窗口的顶层壳：自定义无边框标题栏（沿用主窗口 frame:false 风格，
 * 复用通用 `getPlatform().window` per-sender-window 控制，不新起一套窗口控制协议）
 * + 跟随主窗口主题（`useApplyRuntimeTheme` 读取同一个 `settingsStore`，
 * 主题相关字段走 localStorage 持久化，独立窗口加载时天然拿到同一份配置）+ 渲染 `LogsPanel`。
 */
export default function LogsShell(): JSX.Element {
  useApplyRuntimeTheme()
  useApplyUiScale()
  const { t } = useI18n('ui')
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const win = getPlatform().window
    let disposed = false

    const syncMaximizeState = async (): Promise<void> => {
      try {
        const maximized = await win.isMaximized()
        if (!disposed) {
          setIsMaximized(maximized)
        }
      } catch {
        // 忽略：窗口即将销毁等边界场景
      }
    }

    void syncMaximizeState()
    const unlisten = win.onResized(() => {
      void syncMaximizeState()
    })

    return () => {
      disposed = true
      unlisten()
    }
  }, [])

  const win = getPlatform().window
  const handleMinimize = (): void => {
    void win.minimize()
  }
  const handleToggleMaximize = (): void => {
    void win.toggleMaximize()
  }
  const handleClose = (): void => {
    void win.close()
  }

  const maximizeLabel = isMaximized ? t('windowControls.restore') : t('windowControls.maximize')

  // 标题栏与剪辑独立面板窗口共用 WindowTitleBar（与主窗口同一外观），窗口控件用 `UiWindowControl`。
  return (
    <div className="flex h-screen min-h-screen flex-col overflow-hidden bg-window text-text1">
      <WindowTitleBar
        actions={<>
          <UiWindowControl
            action="minimize"
            onClick={handleMinimize}
            title={t('windowControls.minimize')}
            aria-label={t('windowControls.minimize')}
          />
          <UiWindowControl
            action={isMaximized ? 'restore' : 'maximize'}
            onClick={handleToggleMaximize}
            title={maximizeLabel}
            aria-label={maximizeLabel}
          />
          <UiWindowControl
            action="close"
            onClick={handleClose}
            title={t('windowControls.close')}
            aria-label={t('windowControls.close')}
          />
        </>}
      >
        <span className="min-w-0 truncate text-13 font-semibold">{t('logsWindow.title')}</span>
      </WindowTitleBar>
      <div className="min-h-0 flex-1">
        <LogsPanel />
      </div>
    </div>
  )
}
