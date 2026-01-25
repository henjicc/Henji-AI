import React from 'react'
import type { MigrationProgress } from '../hooks/useDataPath'

interface SettingsProgressDialogProps {
  open: boolean
  title: string
  hint: string
  progress: MigrationProgress
}

const SettingsProgressDialog: React.FC<SettingsProgressDialogProps> = ({ open, title, hint, progress }) => {
  if (!open) return null
  const ratio = progress.total > 0 ? (progress.current / progress.total) * 100 : 0
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-dialog="true"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative bg-[#131313]/80 border border-zinc-700/50 rounded-xl p-4 w-[400px] shadow-2xl">
        <div className="text-white text-base">{title}</div>
        <div className="mt-4">
          <div className="text-sm text-zinc-300 mb-2 truncate">{progress.file}</div>
          <div className="text-xs text-zinc-400 mb-2">{progress.current} / {progress.total}</div>
          <div className="w-full bg-zinc-800 rounded-full h-2">
            <div className="bg-[#007eff] h-2 rounded-full transition-all duration-300" style={{ width: `${ratio}%` }} />
          </div>
        </div>
        <div className="text-xs text-zinc-400 mt-4">{hint}</div>
      </div>
    </div>
  )
}

export default SettingsProgressDialog
