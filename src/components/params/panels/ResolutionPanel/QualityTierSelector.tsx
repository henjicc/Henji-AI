/**
 * QualityTierSelector - 质量档位选择器组件
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { QualityOption } from './types'
import { getI18nText } from '@/core/types'
import { UiOptionButton } from '@/components/ui'

export interface QualityTierSelectorProps {
  value: string
  onChange: (value: string) => void
  options: QualityOption[]
  availableFor?: string
  availableForMap?: Record<string, string[]>
}

export const QualityTierSelector: React.FC<QualityTierSelectorProps> = ({
  value,
  onChange,
  options,
  availableFor,
  availableForMap
}) => {
  const { t, i18n } = useTranslation('ui')

  // 过滤可用的质量选项
  const filteredOptions = useMemo(() => {
    if (!availableFor || !availableForMap) {
      return options
    }

    const availableQualities = availableForMap[availableFor]
    if (!availableQualities) {
      return options
    }

    return options.filter(option => availableQualities.includes(option.value))
  }, [options, availableFor, availableForMap])

  return (
    <div className="quality-tier-selector">
      <label className="param-label">{t('resolutionPanel.qualityLabel')}</label>
      <div className="quality-tier-grid">
        {filteredOptions.map((option) => {
          const label = getI18nText(option.label, i18n.language)
          const description = option.description
            ? getI18nText(option.description, i18n.language)
            : option.resolution

          return (
            <UiOptionButton
              active={value === option.value}
              key={option.value}
              onClick={() => onChange(option.value)}
              className={`quality-tier-option ${value === option.value ? 'selected' : ''}`}
            >
              <span className="quality-tier-label">{label}</span>
              {description && (
                <span className="quality-tier-description">{description}</span>
              )}
            </UiOptionButton>
          )
        })}
      </div>
    </div>
  )
}
