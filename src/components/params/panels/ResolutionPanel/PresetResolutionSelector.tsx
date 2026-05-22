/**
 * PresetResolutionSelector - 预设分辨率选择器组件
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { PresetOption } from './types'
import { getI18nText } from '@/core/types'
import { UiOptionButton } from '@/components/ui'

export interface PresetResolutionSelectorProps {
  value: string
  onChange: (value: string) => void
  options: PresetOption[]
}

export const PresetResolutionSelector: React.FC<PresetResolutionSelectorProps> = ({
  value,
  onChange,
  options
}) => {
  const { t, i18n } = useTranslation('ui')

  return (
    <div className="flex flex-col gap-2">
      <label className="block text-xs text-zinc-400">
        {t('resolutionPanel.resolution', { defaultValue: '分辨率' })}
      </label>
      <div className="flex flex-wrap justify-start gap-2">
        {options.map((option) => {
          const label = getI18nText(option.label, i18n.language)

          return (
            <UiOptionButton
              type="button"
              active={value === option.value}
              key={option.value}
              onClick={() => onChange(option.value)}
              className={`w-[120px] px-2 py-2 text-sm flex-col justify-center gap-1 ${
                value === option.value ? '!bg-accent !border-accent !text-white' : ''
              }`}
              style={{ minHeight: '52px' }}
            >
              <span className="font-medium leading-none">{label}</span>
              {option.aspectRatio && (
                <span className="text-[11px] leading-none opacity-80">({option.aspectRatio})</span>
              )}
            </UiOptionButton>
          )
        })}
      </div>
    </div>
  )
}
