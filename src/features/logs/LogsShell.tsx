import { useEffect, useState, type CSSProperties } from 'react'
import { useApplyRuntimeTheme } from '@/hooks/useApplyRuntimeTheme'
import { useApplyUiScale } from '@/hooks/useApplyUiScale'
import { useI18n } from '@/hooks/useI18n'
import { getPlatform } from '@/platform/runtime'
import { UiIconButton } from '@/components/ui'
import { Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { LogsPanel } from './LogsPanel'

type AppRegionStyle = CSSProperties & { WebkitAppRegion: 'drag' | 'no-drag' }
const dragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'drag' }
const noDragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'no-drag' }

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

  return (
    <div className="flex h-screen min-h-screen flex-col overflow-hidden bg-app text-text-dark">
      <div
        className="flex h-10 shrink-0 select-none items-center justify-between border-b border-border-dark/50 bg-panel px-3"
        style={dragRegionStyle}
      >
        <div className="text-sm text-text-muted">{t('logsWindow.title')}</div>
        <div className="flex items-center gap-1" style={noDragRegionStyle}>
          <UiIconButton
            type="button"
            onClick={handleMinimize}
            className="!h-8 !w-8 rounded border-0 bg-transparent hover:bg-white/10"
            title={t('windowControls.minimize')}
          >
            <Minus className="h-4 w-4" />
          </UiIconButton>
          <UiIconButton
            type="button"
            onClick={handleToggleMaximize}
            className="!h-8 !w-8 rounded border-0 bg-transparent hover:bg-white/10"
            title={t('windowControls.toggleMaximize')}
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </UiIconButton>
          <UiIconButton
            type="button"
            onClick={handleClose}
            className="!h-8 !w-8 rounded border-0 bg-transparent hover:bg-red-700/70"
            title={t('windowControls.close')}
          >
            <X className="h-4 w-4" />
          </UiIconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <LogsPanel />
      </div>
    </div>
  )
}
