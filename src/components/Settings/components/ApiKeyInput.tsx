import { UiFieldMessage } from '@/components/ui'
import React, { useCallback, useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Eye, EyeOff } from 'lucide-react'
import {
  UI_FIELD_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiIconButton,
  UiInput,
} from '@/components/ui'

/** 停止输入这么久后自动保存；失焦、回车与卸载时立即保存。 */
const AUTO_SAVE_DELAY_MS = 600

interface ApiKeyInputProps {
  maskedHint?: string
  onClear?: () => void
  /** 自动保存：输入停顿、失焦、回车或卸载时调用；空输入不保存，删除只走“清除”。 */
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
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const pendingRef = useRef(false)
  const flush = useCallback((): void => {
    if (!pendingRef.current) return
    pendingRef.current = false
    saveRef.current?.()
  }, [])
  useEffect(() => {
    if (!pendingRef.current) return
    const timer = setTimeout(flush, AUTO_SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [value, flush])
  // 设置页在停顿计时结束前关掉时，也要把刚输入的密钥存下来。
  useEffect(() => flush, [flush])
  // 上次保存失败时内容没变也允许失焦或回车重试。
  const retryOrFlush = (): void => {
    if (error && onSave && value.trim()) pendingRef.current = true
    flush()
  }
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
        {onClear ? <UiButton type="button" variant="danger" size="sm" disabled={disabled}
          // 按下时不让输入框失焦，免得失焦保存与清除先后落盘，把刚清除的密钥又写回去。
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { pendingRef.current = false; onClear() }}>
          {t('apiKeys.clear', { defaultValue: '清除' })}
        </UiButton> : null}
      </div> : null}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 grow">
          <UiInput
            id={inputId}
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => {
              pendingRef.current = Boolean(onSave && e.target.value.trim())
              onChange(e.target.value)
            }}
            onBlur={retryOrFlush}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) retryOrFlush()
            }}
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
      </div>
      {hint ? <div id={hintId} className={`mt-2 ${UI_TEXT_META_CLASS}`}>{hint}</div> : null}
      {error ? <UiFieldMessage id={errorId} className="mt-1">{error}</UiFieldMessage> : null}
    </div>
  )
}

export default ApiKeyInput
