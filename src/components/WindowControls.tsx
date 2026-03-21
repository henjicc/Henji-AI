import { createLogger } from '@/core/logging'
import React from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isDesktop, isDesktopAsync } from '../utils/save'
import { useI18n } from '@/hooks/useI18n'
import { UiChipButton, UiIconButton } from '@/components/ui'

const logger = createLogger('components.WindowControls')

// CSS properties that are not in the default type definitions
type WebkitAppRegion = 'drag' | 'no-drag'

// Extend the CSSProperties interface
declare global {
  namespace React {
    interface CSSProperties {
      WebkitAppRegion?: WebkitAppRegion
    }
  }
}

// Tab 配置
interface TabConfig {
  id: string
  label: string
  icon: React.ReactNode
}

interface WindowControlsProps {
  activeTab?: string
  onTabChange?: (tabId: string) => void
  onOpenSettings?: () => void
}

const WindowControls: React.FC<WindowControlsProps> = ({ activeTab = 'conversation', onTabChange, onOpenSettings }) => {
  const { t } = useI18n('ui')
  const [isTauri, setIsTauri] = React.useState<boolean>(false)
  const [isMacOS, setIsMacOS] = React.useState<boolean>(false)
  const [isMaximized, setIsMaximized] = React.useState<boolean>(false)
  const tabs: TabConfig[] = [
    {
      id: 'conversation',
      label: t('tabs.conversation'),
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
  ]

  React.useEffect(() => {
    const ok = isDesktop()
    if (ok) setIsTauri(true)
    else {
      isDesktopAsync().then(v => { if (v) setIsTauri(true) })
    }
    // Simple macOS detection
    if (navigator.userAgent.includes('Mac')) {
      setIsMacOS(true)
    }
  }, [])

  React.useEffect(() => {
    if (!isTauri) return
    const win = getCurrentWindow()
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
    void win.onResized(() => {
      void syncMaximizeState()
    }).then((fn) => {
      unlisten = fn
    }).catch((error) => {
      logger.error('[WindowControls] onResized listener failed', error)
    })

    return () => {
      isDisposed = true
      if (unlisten) {
        unlisten()
      }
    }
  }, [isTauri])

  if (!isTauri) return null
  const win = getCurrentWindow()

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
      data-tauri-ignore-drag-region
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      {tabs.map((tab) => (
        <UiChipButton
          key={tab.id}
          type="button"
          onClick={() => onTabChange?.(tab.id)}
          className={`
            !h-7 gap-1.5 px-3 py-1 rounded-md text-xs font-medium border-0
            transition-all duration-200 ease-out
            ${activeTab === tab.id
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
      className="fixed top-0 left-0 right-0 z-[2147483647] h-10 border-b border-zinc-700/50 bg-panel px-3 text-white"
      data-tauri-drag-region
      style={{ WebkitAppRegion: 'drag' }}
    >
      {isMacOS ? (
        <>
          {/* macOS: 左侧窗口控制按钮 */}
          <div
            className="absolute left-3 top-1/2 flex -translate-y-1/2 items-center gap-2"
            data-tauri-ignore-drag-region
            style={{ WebkitAppRegion: 'no-drag' }}
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
            data-tauri-ignore-drag-region
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            <TabBar />
          </div>

        </>
      ) : (
        <>
          {/* Windows: 左侧标题 */}
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-300 shrink-0">{t('windowControls.appName')}</div>

          {/* Windows: 中间 Tab 栏 */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            data-tauri-ignore-drag-region
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            <TabBar />
          </div>

          {/* Windows: 右侧窗口控制按钮 */}
          <div
            className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2 shrink-0"
            data-tauri-ignore-drag-region
            style={{ WebkitAppRegion: 'no-drag' }}
          >
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


