/**
 * AspectRatioSelector - 比例选择器组件
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { formatAspectRatioDisplayLabel } from '@/core/params/ratioResolution'
import type { AspectRatioOption } from './types'
import { getI18nText } from '@/core/types'
import { UiOptionButton } from '@/components/ui'

export interface AspectRatioSelectorProps {
  value: string
  onChange: (value: string) => void
  options: AspectRatioOption[]
  visualize?: boolean
  smartMatchEnabled?: boolean
}

export const AspectRatioSelector: React.FC<AspectRatioSelectorProps> = ({
  value,
  onChange,
  options,
  visualize = true,
  smartMatchEnabled = false
}) => {
  const { t, i18n } = useTranslation('ui')

  // 计算图标尺寸
  const getIconSize = (ratio: string): { width: number; height: number } => {
    const [w, h] = ratio.split(':').map(Number)
    const maxSize = 28
    const scale = Math.min(maxSize / w, maxSize / h)
    return {
      width: Math.round(w * scale),
      height: Math.round(h * scale)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="block text-xs text-zinc-400">
        {t('resolutionPanel.aspectRatio', { defaultValue: '比例' })}
      </label>
      <div className="flex flex-wrap justify-start gap-2">
        {smartMatchEnabled && (
          <UiOptionButton
            type="button"
            active={value === 'smart'}
            variant="menu"
            onClick={() => onChange('smart')}
            className={`w-[78px] px-2 py-2 text-xs flex-col justify-center gap-2 ${
              value === 'smart' ? '' : 'bg-veil-faint'
            }`}
            style={{ height: '92px' }}
          >
            <div className="h-8 flex items-center justify-center">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M13 2L3 14h8l-1 8 11-14h-8l1-6z" />
              </svg>
            </div>
            <span className="font-medium leading-none">
              {t('resolutionPanel.smart', { defaultValue: '智能' })}
            </span>
          </UiOptionButton>
        )}

        {options
          .filter(option => !(smartMatchEnabled && option.value === 'smart'))
          .map((option) => {
            const iconSize = option.icon || getIconSize(option.value)
            const label = formatAspectRatioDisplayLabel(
              String(getI18nText(option.label, i18n.language) || option.value),
              option.value
            )

            return (
              <UiOptionButton
                type="button"
                active={value === option.value}
                variant="menu"
                key={option.value}
                onClick={() => onChange(option.value)}
                className={`w-[78px] px-2 py-2 text-xs flex-col justify-center gap-2 ${
                  value === option.value ? '' : 'bg-veil-faint'
                }`}
                style={{ height: '92px' }}
              >
                {visualize && (
                  <div className="h-8 flex items-center justify-center">
                    <div
                      className="border-2 border-current"
                      style={{
                        width: `${iconSize.width}px`,
                        height: `${iconSize.height}px`
                      }}
                    />
                  </div>
                )}
                <span className="font-medium leading-none">{label}</span>
              </UiOptionButton>
            )
          })}
      </div>
    </div>
  )
}
