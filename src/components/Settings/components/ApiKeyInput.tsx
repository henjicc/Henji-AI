import React, { useId } from 'react'
import { ExternalLink, Eye, EyeOff } from 'lucide-react'
import {
  UI_FIELD_CONTROL_HEIGHT_CLASS,
  UI_FIELD_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiIconButton,
  UiInput,
} from '@/components/ui'

interface ApiKeyInputProps {
  label?: string
  value: string
  visible: boolean
  onChange: (value: string) => void
  onToggleVisibility: () => void
  placeholder: string
  showLabel: string
  hideLabel: string
  hint?: string
  disabled?: boolean
  error?: string
  websiteUrl?: string | null
  websiteLabel?: string
  managementUrl?: string | null
  managementLabel?: string
  onOpenUrl?: (url: string) => void
}

const ApiKeyInput: React.FC<ApiKeyInputProps> = ({
  label,
  value,
  visible,
  onChange,
  onToggleVisibility,
  placeholder,
  showLabel,
  hideLabel,
  hint,
  disabled = false,
  error,
  websiteUrl,
  websiteLabel,
  managementUrl,
  managementLabel,
  onOpenUrl,
}) => {
  const inputId = useId()
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  const toggleLabel = visible ? hideLabel : showLabel
  return (
    <div>
      {label || websiteUrl || managementUrl ? (
        <div className="mb-1.5 flex min-h-6 items-center justify-between gap-3">
          {label ? <label htmlFor={inputId} className={UI_FIELD_LABEL_CLASS}>{label}</label> : <span />}
          <div className="flex items-center gap-2">
            {websiteUrl && websiteLabel && onOpenUrl ? (
              <UiButton
                type="button"
                variant="plain"
                size="sm"
                className="h-6 shrink-0 px-1 text-brand-300 hover:bg-transparent hover:text-brand-300 hover:underline"
                onClick={() => onOpenUrl(websiteUrl)}
              >
                {websiteLabel}
                <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </UiButton>
            ) : null}
            {managementUrl && managementLabel && onOpenUrl ? (
              <UiButton
                type="button"
                variant="plain"
                size="sm"
                className="h-6 shrink-0 px-1 text-brand-300 hover:bg-transparent hover:text-brand-300 hover:underline"
                onClick={() => onOpenUrl(managementUrl)}
              >
                {managementLabel}
                <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </UiButton>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="relative">
        <UiInput
          id={inputId}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          data-observation-sensitive={visible ? 'true' : undefined}
          className={`${UI_FIELD_CONTROL_HEIGHT_CLASS} pr-12`}
        />
        <UiIconButton
          type="button"
          onClick={onToggleVisibility}
          disabled={disabled}
          appearance="color-only"
          className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
          title={toggleLabel}
          aria-label={toggleLabel}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </UiIconButton>
      </div>
      {hint ? <div id={hintId} className={`mt-2 ${UI_TEXT_META_CLASS}`}>{hint}</div> : null}
      {error ? <div id={errorId} role="alert" className="mt-2 text-xs text-red-400">{error}</div> : null}
    </div>
  )
}

export default ApiKeyInput
