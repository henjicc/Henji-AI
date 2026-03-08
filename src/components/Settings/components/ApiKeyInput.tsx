import React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { UiButton, UiInput } from '@/components/ui'

interface ApiKeyInputProps {
  label: string
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
      <label className="block text-sm font-medium text-zinc-300 mb-2">{label}</label>
      <div className="flex gap-2">
        <UiInput
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1"
        />
        <UiButton
          onClick={onToggleVisibility}
          variant="muted"
          size="sm"
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
