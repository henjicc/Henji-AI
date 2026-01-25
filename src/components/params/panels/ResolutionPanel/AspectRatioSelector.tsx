/**
 * AspectRatioSelector - 比例选择器组件
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { AspectRatioOption } from './types'
import { getI18nText } from '@/core/types'

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
    <div className="aspect-ratio-selector">
      <label className="param-label">{t('resolutionPanel.aspectRatioLabel')}</label>
      <div className="aspect-ratio-grid">
        {smartMatchEnabled && (
          <button
            onClick={() => onChange('smart')}
            className={`aspect-ratio-option ${value === 'smart' ? 'selected' : ''}`}
          >
            <div className="aspect-ratio-icon">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="aspect-ratio-label">{t('resolutionPanel.smart')}</span>
          </button>
        )}

        {options
          .filter(option => !(smartMatchEnabled && option.value === 'smart'))
          .map((option) => {
            const iconSize = option.icon || getIconSize(option.value)
            const label = getI18nText(option.label, i18n.language)

            return (
              <button
                key={option.value}
                onClick={() => onChange(option.value)}
                className={`aspect-ratio-option ${value === option.value ? 'selected' : ''}`}
              >
                {visualize && (
                  <div className="aspect-ratio-icon">
                    <div
                      className="aspect-ratio-box"
                      style={{
                        width: `${iconSize.width}px`,
                        height: `${iconSize.height}px`
                      }}
                    />
                  </div>
                )}
                <span className="aspect-ratio-label">{label}</span>
              </button>
            )
          })}
      </div>
    </div>
  )
}
