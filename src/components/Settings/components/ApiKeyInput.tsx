import React from 'react'
import { Eye, EyeOff } from 'lucide-react'

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
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={onToggleVisibility}
          className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-white transition-colors"
          title={toggleLabel}
          aria-label={toggleLabel}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  )
}

export default ApiKeyInput
