/**
 * QualityTierSelector - 质量档位选择器组件
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { QualityOption } from './types'
import { getI18nText } from '@/core/types'
import { UI_TEXT_LABEL_CLASS, UiOptionButton } from '@/components/ui'

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
    <div className="flex flex-col gap-2">
      <label className={UI_TEXT_LABEL_CLASS}>
        {t('resolutionPanel.resolution', { defaultValue: '分辨率' })}
      </label>
      <div className="flex flex-wrap justify-start gap-2">
        {filteredOptions.map((option) => {
          const label = getI18nText(option.label, i18n.language)
          const description = option.description
            ? getI18nText(option.description, i18n.language)
            : option.resolution

          return (
            <UiOptionButton
              type="button"
              active={value === option.value}
              variant="menu"
              key={option.value}
              onClick={() => onChange(option.value)}
              className={`w-[78px] px-2 py-1.5 text-sm justify-center ${
                value === option.value ? '' : 'bg-veil-faint'
              }`}
              style={{ height: description ? '52px' : '42px' }}
            >
              <span className="font-medium leading-none">{label}</span>
              {description && (
                <span className="text-2xs leading-none opacity-80">{description}</span>
              )}
            </UiOptionButton>
          )
        })}
      </div>
    </div>
  )
}
