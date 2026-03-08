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
    <div className="preset-resolution-selector">
      <label className="param-label">{t('resolutionPanel.qualityLabel')}</label>
      <div className="preset-resolution-grid">
        {options.map((option) => {
          const label = getI18nText(option.label, i18n.language)

          return (
            <UiOptionButton
              active={value === option.value}
              key={option.value}
              onClick={() => onChange(option.value)}
              className={`preset-resolution-option ${value === option.value ? 'selected' : ''}`}
            >
              <span className="preset-resolution-label">{label}</span>
              {option.aspectRatio && (
                <span className="preset-resolution-ratio">({option.aspectRatio})</span>
              )}
            </UiOptionButton>
          )
        })}
      </div>
    </div>
  )
}
