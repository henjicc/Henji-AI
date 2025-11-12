import React from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

const WindowControls: React.FC = () => {
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
      className="fixed top-0 left-0 right-0 h-10 bg-[#131313]/70 backdrop-blur-md border-b border-[rgba(46,46,46,0.8)] z-40 flex items-center justify-between px-3"
      data-tauri-drag-region
    >
      <div className="text-sm text-gray-300">Henji AI</div>
      <div className="flex items-center gap-2" style={{ pointerEvents: 'auto' }}>
        <button
          onClick={handleMinimize}
          className="w-8 h-8 rounded hover:bg-gray-800/80 flex items-center justify-center"
          title="最小化"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M5 12h14v2H5z" />
          </svg>
        </button>
        <button
          onClick={handleToggleMaximize}
          className="w-8 h-8 rounded hover:bg-gray-800/80 flex items-center justify-center"
          title="最大化/还原"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M6 6h12v12H6z" />
          </svg>
        </button>
        <button
          onClick={handleClose}
          className="w-8 h-8 rounded hover:bg-red-700/70 flex items-center justify-center"
          title="关闭"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default WindowControls
