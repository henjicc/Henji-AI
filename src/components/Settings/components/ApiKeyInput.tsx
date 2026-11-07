import { UiFieldMessage } from '@/components/ui'
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
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
  /** 自动保存：输入停顿、失焦、回车或卸载时调用；把已保存的密钥清空则改调 onClear。 */
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
  const inputId = useId()
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  const toggleLabel = visible ? hideLabel : showLabel
  // 已保存的密钥拿不到明文，只拿得到等长的圆点；没动过时把圆点当作框里的内容显示，像普通密码框一样。
  // 按输入次数计时而不是按值：把已保存的圆点清空时值仍是空串，也要重新计时去删除。
  const [edits, setEdits] = useState(0)
  const showsSaved = Boolean(maskedHint) && edits === 0 && !value
  const latest = useRef({ onSave, onClear, value, maskedHint })
  latest.current = { onSave, onClear, value, maskedHint }
  const pendingRef = useRef(false)
  const flush = useCallback((): void => {
    if (!pendingRef.current) return
    pendingRef.current = false
    const current = latest.current
    if (current.value.trim()) current.onSave?.()
    else if (current.maskedHint) current.onClear?.()
  }, [])
  useEffect(() => {
    if (!pendingRef.current) return
    const timer = setTimeout(flush, AUTO_SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [edits, flush])
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
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 grow">
          <UiInput
            id={inputId}
            type={visible && !showsSaved ? 'text' : 'password'}
            value={showsSaved ? maskedHint : value}
            // 点进来就全选已保存的圆点，直接输入即替换。
            onFocus={showsSaved ? (e) => e.currentTarget.select() : undefined}
            onChange={(e) => {
              const next = showsSaved ? e.target.value.replace(/•/g, '') : e.target.value
              setEdits(count => count + 1)
              pendingRef.current = Boolean(onSave)
              onChange(next)
            }}
            onBlur={retryOrFlush}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) retryOrFlush()
            }}
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
      </div>
      {hint ? <div id={hintId} className={`mt-2 ${UI_TEXT_META_CLASS}`}>{hint}</div> : null}
      {error ? <UiFieldMessage id={errorId} className="mt-1">{error}</UiFieldMessage> : null}
    </div>
  )
}

export default ApiKeyInput
