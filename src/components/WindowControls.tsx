import React from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isDesktop, isDesktopAsync } from '../utils/save'
import { logError } from '../utils/errorLogger'

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

const tabs: TabConfig[] = [
  {
    id: 'conversation',
    label: '对话',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    )
  },
  {
    id: 'nodes',
    label: '画布',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
      </svg>
    )
  },
  {
    id: 'tools',
    label: '工具箱',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )
  },
]

interface WindowControlsProps {
  activeTab?: string
  onTabChange?: (tabId: string) => void
}

const WindowControls: React.FC<WindowControlsProps> = ({ activeTab = 'conversation', onTabChange }) => {
  const [isTauri, setIsTauri] = React.useState<boolean>(false)
  const [isMacOS, setIsMacOS] = React.useState<boolean>(false)

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

  if (!isTauri) return null
  const win = getCurrentWindow()

  const handleMinimize = async () => {
    try { await win.minimize() } catch (e) { logError('[WindowControls] minimize failed', e) }
  }
  const handleToggleMaximize = async () => {
    try { await win.toggleMaximize() } catch (e) { logError('[WindowControls] toggleMaximize failed', e) }
  }
  const handleClose = async () => {
    try { await win.close() } catch (e) { console.error('[WindowControls] close failed', e) }
  }

  // Tab 组件 - 居中显示
  const TabBar = () => (
    <div
      className="flex items-center gap-0.5 bg-black/20 rounded-lg p-0.5"
      data-tauri-ignore-drag-region
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange?.(tab.id)}
          className={`
            flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium
            transition-all duration-200 ease-out
            ${activeTab === tab.id
              ? 'bg-[#00a0ea]/30 text-[#00a0ea]'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/10'
            }
          `}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div
      className="fixed top-0 left-0 right-0 h-10 bg-[#131313] border-b border-zinc-700/50 z-40 flex items-center justify-between px-3 text-white"
      data-tauri-drag-region
      style={{ WebkitAppRegion: 'drag' }}
    >
      {isMacOS ? (
        <>
          {/* macOS: 左侧窗口控制按钮 */}
          <div
            className="flex items-center gap-2"
            data-tauri-ignore-drag-region
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            <button
              onClick={handleClose}
              className="w-3 h-3 rounded-full bg-[#FF5F56] hover:bg-[#FF5F56]/80 flex items-center justify-center group"
              title="关闭"
            >
              <svg className="w-2 h-2 text-black/50 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <button
              onClick={handleMinimize}
              className="w-3 h-3 rounded-full bg-[#FFBD2E] hover:bg-[#FFBD2E]/80 flex items-center justify-center group"
              title="最小化"
            >
              <svg className="w-2 h-2 text-black/50 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16" />
              </svg>
            </button>
            <button
              onClick={handleToggleMaximize}
              className="w-3 h-3 rounded-full bg-[#27C93F] hover:bg-[#27C93F]/80 flex items-center justify-center group"
              title="最大化"
            >
              <svg className="w-2 h-2 text-black/50 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 8h8v8H8z" />
              </svg>
            </button>
          </div>

          {/* macOS: 中间 Tab 栏 */}
          <TabBar />

          {/* macOS: 右侧占位 */}
          <div className="w-14"></div>
        </>
      ) : (
        <>
          {/* Windows: 左侧标题 */}
          <div className="text-sm text-zinc-300 shrink-0">痕迹AI</div>

          {/* Windows: 中间 Tab 栏 */}
          <TabBar />

          {/* Windows: 右侧窗口控制按钮 */}
          <div
            className="flex items-center gap-1 shrink-0"
            data-tauri-ignore-drag-region
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            <button
              onClick={handleMinimize}
              className="w-8 h-8 rounded hover:bg-zinc-800/80 flex items-center justify-center"
              title="最小化"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14" />
              </svg>
            </button>
            <button
              onClick={handleToggleMaximize}
              className="w-8 h-8 rounded hover:bg-zinc-800/80 flex items-center justify-center"
              title="最大化/还原"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="6" y="6" width="12" height="12" />
              </svg>
            </button>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded hover:bg-red-700/70 flex items-center justify-center"
              title="关闭"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default WindowControls
