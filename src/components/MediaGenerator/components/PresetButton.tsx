/**
 * PresetButton Component
 *
 * 预设按钮组件，用于在 MediaGenerator 中触发预设管理面板
 */

import React, { useState } from 'react'
import { PresetManager } from '@/components/Presets/PresetManager'


interface PresetButtonProps {
  currentModelId: string
  disabled?: boolean
}

export function PresetButton({ currentModelId, disabled }: PresetButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <div className="relative inline-block">
        <label className="block text-sm font-medium mb-1 text-zinc-300">预设</label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen(true)}
          className={`bg-zinc-800/70 backdrop-blur-lg border border-zinc-700/50 rounded-lg px-3 py-2 h-[38px] !outline-none focus:!outline-none focus-visible:!outline-none !ring-0 focus:!ring-0 focus-visible:!ring-0 shadow-none focus:shadow-none transition-all duration-300 flex items-center justify-between whitespace-nowrap w-full ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-zinc-700/70 hover:border-zinc-600/50'}`}
        >
          <span className="text-sm truncate">管理预设</span>
          <svg className="w-4 h-4 text-zinc-400 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
        </button>
      </div>

      {isOpen && (
        <PresetManager
          currentModelId={currentModelId}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
