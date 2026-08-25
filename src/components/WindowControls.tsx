import { createLogger } from '@/core/logging'
import React from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiChipButton, UiIconButton } from '@/components/ui'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import type { WorkspaceId } from '@/core/types/workspace'
import type { AssetLibraryView } from '@/features/assets/store/assetLibraryStore'
import { Copy, Minus, Sparkles, Square, X, type LucideIcon } from 'lucide-react'
import {
  ICON_ASSET_LIBRARY,
  ICON_SETTINGS,
  ICON_WORKSPACE_CANVAS,
  ICON_WORKSPACE_GENERATE,
  ICON_WORKSPACE_TOOLBOX,
} from '@/core/theme/icons'

const logger = createLogger('components.WindowControls')

type AppRegionStyle = React.CSSProperties & {
  WebkitAppRegion: 'drag' | 'no-drag'
}

const dragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'drag' }
const noDragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'no-drag' }


// Tab 配置
interface TabConfig {
  id: WorkspaceId
  label: string
  /** 概念图标一律取自 `@/core/theme/icons`，不在这里各自挑图形，也不手写 svg */
  icon: LucideIcon
}

interface WindowControlsProps {
  activeTab?: WorkspaceId
  assetView?: AssetLibraryView
  onTabChange?: (tabId: WorkspaceId) => void
  onAssetClick?: () => void
  onOpenSettings?: () => void
  /** 指针移到设置按钮上时预取设置面板 chunk：悬停到点击之间的空档足够抹平首次加载 */
  onPrefetchSettings?: () => void
  assistantOpen?: boolean
  onAssistantClick?: () => void
}

const WindowControls: React.FC<WindowControlsProps> = ({ activeTab = 'generation', assetView = 'closed', onTabChange, onAssetClick, onOpenSettings, onPrefetchSettings, assistantOpen = false, onAssistantClick }) => {
  const { t } = useI18n('ui')
  const [isDesktopShell, setIsDesktopShell] = React.useState<boolean>(false)
  const [isMacOS, setIsMacOS] = React.useState<boolean>(false)
  const [isMaximized, setIsMaximized] = React.useState<boolean>(false)
  const tabs: TabConfig[] = [
    { id: 'generation', label: t('tabs.generation'), icon: ICON_WORKSPACE_GENERATE },
    { id: 'nodes', label: t('tabs.canvas'), icon: ICON_WORKSPACE_CANVAS },
    { id: 'tools', label: t('tabs.tools'), icon: ICON_WORKSPACE_TOOLBOX },
    { id: 'assets', label: t('tabs.assets'), icon: ICON_ASSET_LIBRARY },
  ]

  React.useEffect(() => {
    setIsDesktopShell(isDesktopRuntime())
    // Simple macOS detection
    if (navigator.userAgent.includes('Mac')) {
      setIsMacOS(true)
    }
  }, [])

  React.useEffect(() => {
    if (!isDesktopShell) return
    const win = getPlatform().window
    let unlisten: (() => void) | null = null
    let isDisposed = false

    const syncMaximizeState = async (): Promise<void> => {
      try {
        const maximized = await win.isMaximized()
        if (!isDisposed) {
          setIsMaximized(maximized)
        }
      } catch (error) {
        logger.error('[WindowControls] isMaximized failed', error)
      }
    }

    void syncMaximizeState()
    unlisten = win.onResized(() => {
      void syncMaximizeState()
    })

    return () => {
      isDisposed = true
      if (unlisten) {
        unlisten()
      }
    }
  }, [isDesktopShell])

  if (!isDesktopShell) return null
  const win = getPlatform().window

  const handleMinimize = async () => {
    try { await win.minimize() } catch (e) { logger.error('[WindowControls] minimize failed', e) }
  }
  const handleToggleMaximize = async () => {
    try {
      await win.toggleMaximize()
      setIsMaximized(await win.isMaximized())
    } catch (e) {
      logger.error('[WindowControls] toggleMaximize failed', e)
    }
  }
  const handleClose = async () => {
    try { await win.close() } catch (e) { logger.error('[WindowControls] close failed', e) }
  }
  const handleOpenSettings = (): void => {
    onOpenSettings?.()
  }
  const handlePrefetchSettings = (): void => {
    onPrefetchSettings?.()
  }

  // Tab 组件 - 居中显示
  const TabBar = () => (
    <div
      className="flex items-center gap-0.5 rounded-lg bg-app/40 p-0.5"
      style={noDragRegionStyle}
    >
      {tabs.map((tab) => (
        <UiChipButton
          key={tab.id}
          type="button"
          onClick={() => tab.id === 'assets' ? onAssetClick?.() : onTabChange?.(tab.id)}
          active={tab.id === 'assets' ? assetView !== 'closed' : activeTab === tab.id}
          selectionRole="navigation"
          className="!h-7 gap-1.5 rounded-md border-0 px-3 py-1 text-xs font-medium"
        >
          <tab.icon className="h-3.5 w-3.5" />
          <span>{tab.label}</span>
        </UiChipButton>
      ))}
    </div>
  )

  return (
    <div
      className="fixed top-0 left-0 right-0 z-titlebar h-10 select-none border-b border-border-dark/50 bg-panel px-3 text-white"
      style={dragRegionStyle}
    >
      {isMacOS ? (
        <>
          {/* macOS: 左侧窗口控制按钮 */}
          <div
            className="absolute left-1 top-1/2 flex -translate-y-1/2 items-center"
            style={noDragRegionStyle}
            data-window-nodrag
          >
            <UiIconButton
              type="button"
              onClick={handleClose}
              className="group !h-6 !w-6 !rounded-full !border-0 !bg-transparent !p-0 hover:!bg-transparent"
              title={t('windowControls.close')}
            >
              <span className="flex h-3 w-3 items-center justify-center rounded-full bg-red-400 group-hover:bg-red-400/80">
                <X className="h-2 w-2 text-black/50 opacity-0 group-hover:opacity-100" strokeWidth={3} />
              </span>
            </UiIconButton>
            <UiIconButton
              type="button"
              onClick={handleMinimize}
              className="group !h-6 !w-6 !rounded-full !border-0 !bg-transparent !p-0 hover:!bg-transparent"
              title={t('windowControls.minimize')}
            >
              <span className="flex h-3 w-3 items-center justify-center rounded-full bg-yellow-400 group-hover:bg-yellow-400/80">
                <Minus className="h-2 w-2 text-black/50 opacity-0 group-hover:opacity-100" strokeWidth={3} />
              </span>
            </UiIconButton>
            <UiIconButton
              type="button"
              onClick={handleToggleMaximize}
              className="group !h-6 !w-6 !rounded-full !border-0 !bg-transparent !p-0 hover:!bg-transparent"
              title={t('windowControls.maximize')}
            >
              <span className="flex h-3 w-3 items-center justify-center rounded-full bg-green-500 group-hover:bg-green-500/80">
                <Square className="h-2 w-2 text-black/50 opacity-0 group-hover:opacity-100" strokeWidth={3} />
              </span>
            </UiIconButton>
          </div>

          {/* macOS: 中间 Tab 栏 */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={noDragRegionStyle}
            data-window-nodrag
          >
            <TabBar />
          </div>

          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1" style={noDragRegionStyle} data-window-nodrag>
            <UiIconButton
              type="button"
              active={assistantOpen}
              showBorder={false}
              appearance="hover-only"
              onClick={onAssistantClick}
              className="!h-7 !w-7"
              title="智能助手"
            >
              <Sparkles className="h-4 w-4" />
            </UiIconButton>
            <UiIconButton
              type="button"
              showBorder={false}
              appearance="hover-only"
              onClick={handleOpenSettings}
              onPointerEnter={handlePrefetchSettings}
              className="!h-7 !w-7"
              title={t('actions.settings')}
            >
              <ICON_SETTINGS className="h-4 w-4" />
            </UiIconButton>
          </div>

        </>
      ) : (
        <>
          {/* Windows: 左侧标题 */}
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-soft shrink-0">{t('windowControls.appName')}</div>

          {/* Windows: 中间 Tab 栏 */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={noDragRegionStyle}
            data-window-nodrag
          >
            <TabBar />
          </div>

          {/* Windows: 右侧窗口控制按钮 */}
          <div
            className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2 shrink-0"
            style={noDragRegionStyle}
            data-window-nodrag
          >
            <UiIconButton
              type="button"
              active={assistantOpen}
              showBorder={false}
              appearance="hover-only"
              onClick={onAssistantClick}
              className="!h-8 !w-8 !rounded"
              title="智能助手"
            >
              <Sparkles className="h-4 w-4" />
            </UiIconButton>
            <UiIconButton
              type="button"
              onClick={handleOpenSettings}
              onPointerEnter={handlePrefetchSettings}
              className="!w-8 !h-8 !rounded border-0 bg-transparent hover:bg-surface-dark/80"
              title={t('actions.settings')}
            >
              <ICON_SETTINGS className="h-4 w-4" />
            </UiIconButton>
            <UiIconButton
              type="button"
              onClick={handleMinimize}
              className="!w-8 !h-8 !rounded border-0 bg-transparent hover:bg-surface-dark/80"
              title={t('windowControls.minimize')}
            >
              <Minus className="h-4 w-4" />
            </UiIconButton>
            <UiIconButton
              type="button"
              onClick={handleToggleMaximize}
              className="!w-8 !h-8 !rounded border-0 bg-transparent hover:bg-surface-dark/80"
              title={t('windowControls.toggleMaximize')}
            >
              {isMaximized ? (
                <Copy className="h-3.5 w-3.5" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
            </UiIconButton>
            <UiIconButton
              type="button"
              onClick={handleClose}
              className="!w-8 !h-8 !rounded border-0 bg-transparent hover:bg-red-700/70"
              title={t('windowControls.close')}
            >
              <X className="h-4 w-4" />
            </UiIconButton>
          </div>
        </>
      )}
    </div>
  )
}

export default WindowControls
