import React from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isDesktop, isDesktopAsync } from '../utils/save'

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
  React.useEffect(() => {
    const ok = isDesktop()
    if (ok) setIsTauri(true)
    else {
      isDesktopAsync().then(v => { if (v) setIsTauri(true) })
    }
  }, [])
  if (!isTauri) return null
  const win = getCurrentWindow()

  const handleMinimize = async () => {
    try { await win.minimize() } catch (e) { console.error('[WindowControls] minimize failed', e) }
  }
  const handleToggleMaximize = async () => {
    try { await win.toggleMaximize() } catch (e) { console.error('[WindowControls] toggleMaximize failed', e) }
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
    </div>
  )
}

export default WindowControls
