/**
 * PresetButton Component
 *
 * 预设按钮组件，用于在 MediaGenerator 中触发预设管理面板
 */

import React, { useState } from 'react'
import { PresetManager } from '../Presets/PresetManager'
import PanelTrigger from '../ui/PanelTrigger'

interface PresetButtonProps {
  currentModelId: string
  disabled?: boolean
}

export function PresetButton({ currentModelId, disabled }: PresetButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <PanelTrigger
        label="预设"
        onClick={() => setIsOpen(true)}
        disabled={disabled}
      />

      {isOpen && (
        <PresetManager
          currentModelId={currentModelId}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
