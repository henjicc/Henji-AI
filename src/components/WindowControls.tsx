import { createLogger } from '@/core/logging'
import React from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiChipButton, UiIconButton } from '@/components/ui'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import type { WorkspaceId } from '@/core/types/workspace'
import type { AssetLibraryView } from '@/features/assets/store/assetLibraryStore'
import { Sparkles } from 'lucide-react'

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
  icon: React.ReactNode
}

interface WindowControlsProps {
  activeTab?: WorkspaceId
  assetView?: AssetLibraryView
  onTabChange?: (tabId: WorkspaceId) => void
  onAssetClick?: () => void
  onOpenSettings?: () => void
  assistantOpen?: boolean
  onAssistantClick?: () => void
}

const WindowControls: React.FC<WindowControlsProps> = ({ activeTab = 'generation', assetView = 'closed', onTabChange, onAssetClick, onOpenSettings, assistantOpen = false, onAssistantClick }) => {
  const { t } = useI18n('ui')
  const [isDesktopShell, setIsDesktopShell] = React.useState<boolean>(false)
  const [isMacOS, setIsMacOS] = React.useState<boolean>(false)
  const [isMaximized, setIsMaximized] = React.useState<boolean>(false)
  const tabs: TabConfig[] = [
    {
      id: 'generation',
      label: t('tabs.generation'),
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      )
    },
    {
      id: 'nodes',
      label: t('tabs.canvas'),
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
        </svg>
      )
    },
    {
      id: 'tools',
      label: t('tabs.tools'),
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    },
    {
      id: 'assets',
      label: t('tabs.assets'),
      icon: <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M5 7l1-3h12l1 3v13H5V7zm4 4h6" /></svg>
    },
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

  // Tab 组件 - 居中显示
  const TabBar = () => (
    <div
      className="flex items-center gap-0.5 bg-black/20 rounded-lg p-0.5"
      style={noDragRegionStyle}
    >
      {tabs.map((tab) => (
        <UiChipButton
          key={tab.id}
          type="button"
          onClick={() => tab.id === 'assets' ? onAssetClick?.() : onTabChange?.(tab.id)}
          className={`
            !h-7 gap-1.5 px-3 py-1 rounded-md text-xs font-medium border-0
            transition-all duration-200 ease-out
            ${(tab.id === 'assets' ? assetView !== 'closed' : activeTab === tab.id)
              ? 'bg-accent/30 !text-accent'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/10 bg-transparent'
            }
          `}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </UiChipButton>
      ))}
    </div>
  )

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[2147483647] h-10 select-none border-b border-zinc-700/50 bg-panel px-3 text-white"
      style={dragRegionStyle}
    >
      {isMacOS ? (
        <>
          {/* macOS: 左侧窗口控制按钮 */}
          <div
            className="absolute left-3 top-1/2 flex -translate-y-1/2 items-center gap-2"
            style={noDragRegionStyle}
            data-window-nodrag
          >
            <UiIconButton
              type="button"
              onClick={handleOpenSettings}
              className="!w-6 !h-6 !rounded-md border-0 bg-transparent hover:bg-zinc-800/80"
              title={t('actions.settings')}
            >
              <svg className="w-3.5 h-3.5 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </UiIconButton>
            <UiIconButton
              type="button"
              onClick={handleClose}
              className="!w-3 !h-3 !rounded-full !border-0 !bg-red-400 hover:!bg-red-400/80 !p-0 group"
              title={t('windowControls.close')}
            >
              <svg className="w-2 h-2 text-black/50 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </UiIconButton>
            <UiIconButton
              type="button"
              onClick={handleMinimize}
              className="!w-3 !h-3 !rounded-full !border-0 !bg-yellow-400 hover:!bg-yellow-400/80 !p-0 group"
              title={t('windowControls.minimize')}
            >
              <svg className="w-2 h-2 text-black/50 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16" />
              </svg>
            </UiIconButton>
            <UiIconButton
              type="button"
              onClick={handleToggleMaximize}
              className="!w-3 !h-3 !rounded-full !border-0 !bg-green-500 hover:!bg-green-500/80 !p-0 group"
              title={t('windowControls.maximize')}
            >
              <svg className="w-2 h-2 text-black/50 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 8h8v8H8z" />
              </svg>
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

          <div className="absolute right-3 top-1/2 -translate-y-1/2" style={noDragRegionStyle} data-window-nodrag>
            <UiIconButton type="button" active={assistantOpen} onClick={onAssistantClick} className="!h-7 !w-7 border-0 bg-transparent" title="智能助手">
              <Sparkles className="h-4 w-4" />
            </UiIconButton>
          </div>

        </>
      ) : (
        <>
          {/* Windows: 左侧标题 */}
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-300 shrink-0">{t('windowControls.appName')}</div>

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
              onClick={onAssistantClick}
              className="!w-8 !h-8 !rounded border-0 bg-transparent hover:bg-zinc-800/80"
              title="智能助手"
            >
              <Sparkles className="h-4 w-4" />
            </UiIconButton>
            <UiIconButton
              type="button"
              onClick={handleOpenSettings}
              className="!w-8 !h-8 !rounded border-0 bg-transparent hover:bg-zinc-800/80"
              title={t('actions.settings')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </UiIconButton>
            <UiIconButton
              type="button"
              onClick={handleMinimize}
              className="!w-8 !h-8 !rounded border-0 bg-transparent hover:bg-zinc-800/80"
              title={t('windowControls.minimize')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14" />
              </svg>
            </UiIconButton>
            <UiIconButton
              type="button"
              onClick={handleToggleMaximize}
              className="!w-8 !h-8 !rounded border-0 bg-transparent hover:bg-zinc-800/80"
              title={t('windowControls.toggleMaximize')}
            >
              {isMaximized ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048" className="w-2.5 h-2.5" fill="currentColor">
                  <path d="M2048 1638h-410v410H0V410h410V0h1638zM1434 614H205v1229h1229zm409-409H614v205h1024v1024h205z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="6" y="6" width="12" height="12" />
                </svg>
              )}
            </UiIconButton>
            <UiIconButton
              type="button"
              onClick={handleClose}
              className="!w-8 !h-8 !rounded border-0 bg-transparent hover:bg-red-700/70"
              title={t('windowControls.close')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </UiIconButton>
          </div>
        </>
      )}
    </div>
  )
}

export default WindowControls


