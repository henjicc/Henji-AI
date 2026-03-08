import React from 'react'
import { UiTextArea } from '@/components/ui'

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
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
  }

  const remainingChars = maxLength - value.length

  return (
    <div className="text-input-container">
      <UiTextArea
        className="text-input"
        value={value}
        onChange={handleChange}
        onPaste={onPaste}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        autoFocus={autoFocus}
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
