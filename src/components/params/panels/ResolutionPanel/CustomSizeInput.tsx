/**
 * CustomSizeInput - 自定义尺寸输入组件
 */

import React, { useState, useCallback } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiIconButton, UiInput } from '@/components/ui'

export interface CustomSizeInputProps {
  value: { width: number; height: number }
  onChange: (value: { width: number; height: number }) => void
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
  step: number
  lockRatio?: boolean
  disabled?: boolean
}

export const CustomSizeInput: React.FC<CustomSizeInputProps> = ({
  value,
  onChange,
  minWidth,
  maxWidth,
  minHeight,
  maxHeight,
  step,
  lockRatio = false,
  disabled = false
}) => {
  const { t } = useI18n('ui')
  const [isRatioLocked, setIsRatioLocked] = useState(lockRatio)
  const [ratio, setRatio] = useState(value.width / value.height)

  const handleWidthChange = useCallback((newWidth: number) => {
    const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))

    if (isRatioLocked) {
      const newHeight = Math.round(clampedWidth / ratio / step) * step
      const clampedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight))
      onChange({ width: clampedWidth, height: clampedHeight })
    } else {
      onChange({ width: clampedWidth, height: value.height })
      setRatio(clampedWidth / value.height)
    }
  }, [value.height, isRatioLocked, ratio, minWidth, maxWidth, minHeight, maxHeight, step, onChange])

  const handleHeightChange = useCallback((newHeight: number) => {
    const clampedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight))

    if (isRatioLocked) {
      const newWidth = Math.round(clampedHeight * ratio / step) * step
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))
      onChange({ width: clampedWidth, height: clampedHeight })
    } else {
      onChange({ width: value.width, height: clampedHeight })
      setRatio(value.width / clampedHeight)
    }
  }, [value.width, isRatioLocked, ratio, minWidth, maxWidth, minHeight, maxHeight, step, onChange])

  return (
    <div className="custom-size-input">
      <label className="param-label">{t('resolutionPanel.sizeLabel')}</label>
      <div className="custom-size-controls">
        <UiInput
          type="number"
          value={value.width}
          onChange={(e) => handleWidthChange(Number(e.target.value))}
          disabled={disabled}
          min={minWidth}
          max={maxWidth}
          step={step}
          className="custom-size-field"
        />

        <UiIconButton
          active={isRatioLocked}
          onClick={() => setIsRatioLocked(!isRatioLocked)}
          className={`ratio-lock-button ${isRatioLocked ? 'locked' : ''}`}
          disabled={disabled}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isRatioLocked ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
            )}
          </svg>
        </UiIconButton>

        <UiInput
          type="number"
          value={value.height}
          onChange={(e) => handleHeightChange(Number(e.target.value))}
          disabled={disabled}
          min={minHeight}
          max={maxHeight}
          step={step}
          className="custom-size-field"
        />

        <span className="custom-size-unit">PX</span>
      </div>
    </div>
  )
}
