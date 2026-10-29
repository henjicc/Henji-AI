import { UiFieldMessage } from '@/components/ui'
import React, { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Eye, EyeOff } from 'lucide-react'
import {
  UI_FIELD_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiIconButton,
  UiInput,
} from '@/components/ui'

interface ApiKeyInputProps {
  maskedHint?: string
  onClear?: () => void
  onSave?: () => void
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
  maskedHint,
  onClear,
  onSave,
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
  const { t } = useTranslation('settings')
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
      {maskedHint ? <div className="mb-2 flex items-center gap-2">
        <span className={UI_TEXT_META_CLASS}>{t('apiKeys.configuredHint', { defaultValue: '已配置 · {{hint}}', hint: maskedHint })}</span>
        {onClear ? <UiButton type="button" variant="danger" size="sm" disabled={disabled} onClick={onClear}>
          {t('apiKeys.clear', { defaultValue: '清除' })}
        </UiButton> : null}
      </div> : null}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 grow">
          <UiInput
            id={inputId}
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onSave ? (e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && value.trim()) onSave()
            } : undefined}
            placeholder={maskedHint ? t('apiKeys.replacePlaceholder', { defaultValue: '输入新密钥以替换' }) : placeholder}
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
        {onSave ? <UiButton type="button" variant="secondary" size="lg" className="shrink-0"
          disabled={disabled || !value.trim()}
          disabledReason={disabled ? undefined : t('apiKeys.saveDisabledReason', { defaultValue: '先输入密钥' })}
          onClick={onSave}>
          {t('common:save')}
        </UiButton> : null}
      </div>
      {hint ? <div id={hintId} className={`mt-2 ${UI_TEXT_META_CLASS}`}>{hint}</div> : null}
      {error ? <UiFieldMessage id={errorId} className="mt-1">{error}</UiFieldMessage> : null}
    </div>
  )
}

export default ApiKeyInput
