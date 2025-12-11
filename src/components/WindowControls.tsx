import React from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isDesktop, isDesktopAsync } from '../utils/save'
import { logError, logWarning, logInfo } from '../utils/errorLogger'

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

const WindowControls: React.FC = () => {
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

  return (
    <div
      className="fixed top-0 left-0 right-0 h-10 bg-[#131313] border-b border-zinc-700/50 z-40 flex items-center justify-between px-3 text-white"
      data-tauri-drag-region
      style={{ WebkitAppRegion: 'drag' }}
    >
      {isMacOS ? (
        <>
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
          <div className="text-sm text-zinc-300 absolute left-1/2 -translate-x-1/2 pointer-events-none">痕迹AI</div>
          <div className="w-14"></div> {/* Spacer for balance */}
        </>
      ) : (
        <>
          <div className="text-sm text-zinc-300">痕迹AI</div>
          <div
            className="flex items-center gap-2"
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
