import React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { UiButton, UiInput, UI_FIELD_CONTROL_HEIGHT_CLASS } from '@/components/ui'

interface ApiKeyInputProps {
  label?: string
  value: string
  visible: boolean
  onChange: (value: string) => void
  onToggleVisibility: () => void
  placeholder: string
  showLabel: string
  hideLabel: string
}

const ApiKeyInput: React.FC<ApiKeyInputProps> = ({
  label,
  value,
  visible,
  onChange,
  onToggleVisibility,
  placeholder,
  showLabel,
  hideLabel
}) => {
  const toggleLabel = visible ? hideLabel : showLabel
  return (
    <div className="mb-4">
      {label ? <label className="mb-2 block text-sm font-medium text-text-dark">{label}</label> : null}
      <div className="flex gap-2">
        <UiInput
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${UI_FIELD_CONTROL_HEIGHT_CLASS} flex-1`}
        />
        <UiButton
          onClick={onToggleVisibility}
          variant="muted"
          size="field"
          className="w-10 px-0"
          title={toggleLabel}
          aria-label={toggleLabel}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </UiButton>
      </div>
    </div>
  )
}

export default ApiKeyInput
