/**
 * 文本输入组件
 * 职责：提供提示词输入功能
 */

import React, { useRef, useEffect } from 'react'

interface TextInputProps {
  value: string
  onChange: (value: string) => void
  onPaste: (e: React.ClipboardEvent) => void
  placeholder?: string
  maxLength?: number
  rows?: number
  autoFocus?: boolean
  disabled?: boolean
}

export const TextInput: React.FC<TextInputProps> = ({
  value,
  onChange,
  onPaste,
  placeholder = '请输入提示词...',
  maxLength = 2000,
  rows = 4,
  autoFocus = false,
  disabled = false
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
  }

  const remainingChars = maxLength - value.length

  return (
    <div className="text-input-container">
      <textarea
        ref={textareaRef}
        className="text-input"
        value={value}
        onChange={handleChange}
        onPaste={onPaste}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        disabled={disabled}
      />
      <div className="text-input-footer">
        <span className={`char-count ${remainingChars < 100 ? 'warning' : ''}`}>
          {value.length} / {maxLength}
        </span>
      </div>
    </div>
  )
}
