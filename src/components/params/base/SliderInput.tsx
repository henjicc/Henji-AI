/**
 * SliderInput 组件
 *
 * 支持滑块输入，带有标记和拖动反馈
 * 支持 i18n 显示名称
 * 支持禁用和条件显示
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SliderParamDef } from '@/core/types'

interface SliderInputProps {
  param: SliderParamDef
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}

export const SliderInput: React.FC<SliderInputProps> = ({
  param,
  value,
  onChange,
  disabled = false
}) => {
  const { t } = useTranslation()
  const [isDragging, setIsDragging] = useState(false)

  // 获取显示名称（支持 i18n）
  const displayName = param.displayName
    ? (typeof param.displayName === 'string'
        ? param.displayName
        : t(param.displayName.key, param.displayName.fallback))
    : param.id

  // 处理滑块变化
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value)
    onChange(newValue)
  }

  // 处理拖动状态
  const handleMouseDown = () => setIsDragging(true)
  const handleMouseUp = () => setIsDragging(false)

  // 计算标记位置
  const marks = param.marks || []
  const min = param.min ?? 0
  const max = param.max ?? 100
  const step = param.step ?? 1

  return (
    <div className="slider-input-wrapper">
      <label className="param-label">
        {displayName}
        {param.required && <span className="required-mark">*</span>}
        <span className="slider-value">{value}</span>
      </label>
      <div className={`slider-container ${isDragging ? 'dragging' : ''}`}>
        <input
          type="range"
          value={value ?? min}
          onChange={handleChange}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchEnd={handleMouseUp}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          className="slider-input"
        />
        {marks.length > 0 && (
          <div className="slider-marks">
            {marks.map((mark, index) => {
              const position = ((mark.value - min) / (max - min)) * 100
              return (
                <div
                  key={index}
                  className="slider-mark"
                  style={{ left: `${position}%` }}
                >
                  <div className="slider-mark-dot" />
                  <div className="slider-mark-label">{mark.label}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {param.description && (
        <div className="param-description">{param.description}</div>
      )}
    </div>
  )
}
