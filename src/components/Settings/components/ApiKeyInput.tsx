import { UiFieldMessage } from '@/components/ui'
import React, { useId } from 'react'
import { ExternalLink, Eye, EyeOff } from 'lucide-react'
import {
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
        <div className="mb-1.5 min-h-6">
          {label ? <label htmlFor={inputId} className={UI_FIELD_LABEL_CLASS}>{label}</label> : null}
          <div className={`${label ? 'mt-1' : ''} flex items-center justify-start gap-3`}>
            {websiteUrl && websiteLabel && onOpenUrl ? (
              <UiButton
                type="button"
                variant="link"
                className="shrink-0"
                onClick={() => onOpenUrl(websiteUrl)}
              >
                {websiteLabel}
                <ExternalLink  />
              </UiButton>
            ) : null}
            {managementUrl && managementLabel && onOpenUrl ? (
              <UiButton
                type="button"
                variant="link"
                className="shrink-0"
                onClick={() => onOpenUrl(managementUrl)}
              >
                {managementLabel}
                <ExternalLink  />
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
          size="lg"
          className="pr-12"
        />
        <UiIconButton size="md"
          type="button"
          onClick={onToggleVisibility}
          disabled={disabled}
          className="absolute right-1 top-1/2 -translate-y-1/2"
          tooltip={toggleLabel}
          aria-label={toggleLabel}
          aria-pressed={visible}
        >
          {visible ? <EyeOff  /> : <Eye  />}
        </UiIconButton>
      </div>
      {hint ? <div id={hintId} className={`mt-2 ${UI_TEXT_META_CLASS}`}>{hint}</div> : null}
      {error ? <UiFieldMessage id={errorId} className="mt-1">{error}</UiFieldMessage> : null}
    </div>
  )
}

export default ApiKeyInput
