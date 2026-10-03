import { createLogger } from '@/core/logging'
import React from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiChipButton, UiIconButton, UiWindowControl } from '@/components/ui'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import type { WorkspaceId } from '@/core/types/workspace'
import type { AssetLibraryView } from '@/features/assets/store/assetLibraryStore'
import { Sparkles } from 'lucide-react'
import { ICON_SETTINGS } from '@/core/theme/icons'

const logger = createLogger('components.WindowControls')

type AppRegionStyle = React.CSSProperties & {
  WebkitAppRegion: 'drag' | 'no-drag'
}

const dragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'drag' }
const noDragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'no-drag' }


/** 工作区导航项：设计稿为纯文字导航（“生成 / 画布 / 剪辑 / 工具 / 资产”），不带图标。 */
interface TabConfig {
  id: WorkspaceId
  label: string
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
    { id: 'generation', label: t('tabs.generation') },
    { id: 'nodes', label: t('tabs.canvas') },
    { id: 'videoEdit', label: t('tabs.videoEdit') },
    { id: 'tools', label: t('tabs.tools') },
    { id: 'assets', label: t('tabs.assets') },
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

  const windowControlsPlatform = isMacOS ? 'mac' : 'windows'
  const minimizeControl = (
    <UiWindowControl
      platform={windowControlsPlatform}
      action="minimize"
      onClick={handleMinimize}
      title={t('windowControls.minimize')}
      aria-label={t('windowControls.minimize')}
    />
  )
  const maximizeControl = (
    <UiWindowControl
      platform={windowControlsPlatform}
      action={isMaximized ? 'restore' : 'maximize'}
      onClick={handleToggleMaximize}
      title={isMaximized ? t('windowControls.restore') : t('windowControls.maximize')}
      aria-label={isMaximized ? t('windowControls.restore') : t('windowControls.maximize')}
    />
  )
  const closeControl = (
    <UiWindowControl
      platform={windowControlsPlatform}
      action="close"
      onClick={handleClose}
      title={t('windowControls.close')}
      aria-label={t('windowControls.close')}
    />
  )

  // 设计稿 TitleBar：左（应用名 / macOS 交通灯）与右（助手、设置、窗口控件）各占 flex-1，导航居中；
  // 窗口变窄时两侧先让出空白，应用名可截断，导航与右侧控件保持完整。
  return (
    <header
      className={`fixed inset-x-0 top-0 z-titlebar flex h-10 select-none items-center gap-3 border-b border-line bg-window pr-1.5 text-text1 ${isMacOS ? 'pl-2' : 'pl-4'}`}
      style={dragRegionStyle}
    >
      <div className="flex min-w-0 flex-1 items-center">
        {isMacOS ? (
          <div
            className="group/window-controls flex items-center"
            style={noDragRegionStyle}
            data-window-nodrag
          >
            {closeControl}
            {minimizeControl}
            {maximizeControl}
          </div>
        ) : (
          <span className="truncate text-13 font-semibold tracking-wide">{t('windowControls.appName')}</span>
        )}
      </div>

      <nav
        aria-label={t('windowControls.workspaceNav')}
        className="flex shrink-0 items-center gap-0.5"
        style={noDragRegionStyle}
        data-window-nodrag
      >
        {tabs.map((tab) => {
          const active = tab.id === 'assets' ? assetView !== 'closed' : activeTab === tab.id
          return (
            <UiChipButton
              key={tab.id}
              type="button"
              selectionRole="navigation"
              selectionAppearance="workspace"
              active={active}
              aria-current={active ? 'page' : undefined}
              onClick={() => tab.id === 'assets' ? onAssetClick?.() : onTabChange?.(tab.id)}
            >
              {tab.label}
            </UiChipButton>
          )
        })}
      </nav>

      <div className="flex flex-1 items-center justify-end">
        <div className="flex items-center gap-0.5" style={noDragRegionStyle} data-window-nodrag>
          {onAssistantClick && (
            <UiIconButton
              type="button"
              on={assistantOpen}
              onClick={onAssistantClick}
              title={t('windowControls.assistant')}
              aria-label={t('windowControls.assistant')}
            >
              <Sparkles className="h-4 w-4" />
            </UiIconButton>
          )}
          <UiIconButton
            type="button"
            onClick={handleOpenSettings}
            onPointerEnter={handlePrefetchSettings}
            title={t('actions.settings')}
            aria-label={t('actions.settings')}
          >
            <ICON_SETTINGS className="h-4 w-4" />
          </UiIconButton>
          {!isMacOS && (
            <>
              <span aria-hidden="true" className="mx-1.5 h-3.5 w-px bg-line" />
              {minimizeControl}
              {maximizeControl}
              {closeControl}
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export default WindowControls
