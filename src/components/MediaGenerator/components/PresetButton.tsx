/**
 * PresetButton Component
 *
 * 预设按钮组件，用于在 MediaGenerator 中触发预设管理面板
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PresetManager } from '@/components/Presets/PresetManager'
import { UI_FIELD_CONTROL_HEIGHT_SM_CLASS, UiButton } from '@/components/ui'


interface PresetButtonProps {
  currentModelId: string
  disabled?: boolean
}

export function PresetButton({ currentModelId, disabled }: PresetButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { t } = useTranslation('ui')

  return (
    <>
      <div className="relative inline-block">
        <label className="block text-sm font-medium mb-1 text-text-soft">{t('presets.label')}</label>
        <UiButton
          variant="muted"
          size="sm"
          disabled={disabled}
          onClick={() => setIsOpen(true)}
          className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} w-full justify-between px-3 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <span className="text-sm truncate">{t('presets.manage')}</span>
          <svg className="w-4 h-4 text-text-muted ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
        </UiButton>
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
