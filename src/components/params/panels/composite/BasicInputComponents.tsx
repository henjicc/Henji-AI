import React from 'react'
import { useTranslation } from 'react-i18next'
import Dropdown from '@/components/ui/Dropdown'
import Toggle from '@/components/ui/Toggle'
import { UiInput, UiOptionButton } from '@/components/ui'
import { getI18nText, type I18nText } from '@/core/types'

interface CompositeComponentProps<TConfig> {
  config: TConfig
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}

interface CompositeOption {
  value: string | number
  label: I18nText
  disabled?: boolean
}

interface TextInputConfig {
  placeholder?: I18nText
  maxLength?: number
}

interface NumberInputConfig {
  min?: number
  max?: number
  step?: number
  placeholder?: I18nText
}

interface DropdownConfig {
  options: CompositeOption[]
}

interface SwitchConfig {
  onText?: I18nText
  offText?: I18nText
}

interface RadioConfig {
  options: CompositeOption[]
}

interface FileInputConfig {
  accept?: string[]
  maxSizeMb?: number
  buttonText?: I18nText
  hint?: I18nText
}

function clampNumber(value: number, config: NumberInputConfig): number {
  let next = value
  if (typeof config.min === 'number') {
    next = Math.max(config.min, next)
  }
  if (typeof config.max === 'number') {
    next = Math.min(config.max, next)
  }
  return next
}

function resolveCompositeOptions(options: CompositeOption[], language: string): Array<{
  value: string | number
  label: string
  disabled?: boolean
}> {
  return options.map((option) => ({
    value: option.value,
    label: getI18nText(option.label, language),
    disabled: option.disabled,
  }))
}

export const CompositeTextInput: React.FC<CompositeComponentProps<TextInputConfig>> = ({
  config,
  value,
  onChange,
  disabled = false,
}) => {
  const { i18n } = useTranslation()
  const safeValue = typeof value === 'string' ? value : ''
  const placeholder = config.placeholder
    ? getI18nText(config.placeholder, i18n.language)
    : undefined

  return (
    <UiInput
      type="text"
      value={safeValue}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      maxLength={config.maxLength}
      disabled={disabled}
      className="h-[38px] w-full"
    />
  )
}

export const CompositeNumberInput: React.FC<CompositeComponentProps<NumberInputConfig>> = ({
  config,
  value,
  onChange,
  disabled = false,
}) => {
  const { i18n } = useTranslation()
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : ''
  const placeholder = config.placeholder
    ? getI18nText(config.placeholder, i18n.language)
    : undefined

  return (
    <UiInput
      type="number"
      value={safeValue}
      min={config.min}
      max={config.max}
      step={config.step}
      placeholder={placeholder}
      disabled={disabled}
      className="h-[38px] w-full"
      onChange={(event) => {
        const parsed = Number(event.target.value)
        if (!Number.isFinite(parsed)) {
          return
        }
        onChange(clampNumber(parsed, config))
      }}
    />
  )
}

export const CompositeDropdown: React.FC<CompositeComponentProps<DropdownConfig>> = ({
  config,
  value,
  onChange,
  disabled = false,
}) => {
  const { i18n } = useTranslation()
  const options = resolveCompositeOptions(config.options || [], i18n.language)
  const selected = options.find((option) => String(option.value) === String(value))
  const fallback = options.find((option) => option.disabled !== true)

  return (
    <Dropdown
      value={selected?.value ?? fallback?.value}
      display={selected?.label ?? fallback?.label}
      options={options}
      onSelect={(next) => onChange(next)}
      disabled={disabled}
      buttonClassName="w-full"
      minWidthStrategy="none"
    />
  )
}

export const CompositeSwitch: React.FC<CompositeComponentProps<SwitchConfig>> = ({
  config,
  value,
  onChange,
  disabled = false,
}) => {
  const { i18n } = useTranslation()
  const checked = value === true
  const onText = config.onText
    ? getI18nText(config.onText, i18n.language)
    : undefined
  const offText = config.offText
    ? getI18nText(config.offText, i18n.language)
    : undefined

  return (
    <Toggle
      checked={checked}
      onChange={(next) => onChange(next)}
      onText={onText}
      offText={offText}
      disabled={disabled}
      className="w-full"
    />
  )
}

export const CompositeRadio: React.FC<CompositeComponentProps<RadioConfig>> = ({
  config,
  value,
  onChange,
  disabled = false,
}) => {
  const { i18n } = useTranslation()
  const options = resolveCompositeOptions(config.options || [], i18n.language)

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <UiOptionButton
          key={String(option.value)}
          type="button"
          variant="flat"
          active={String(value) === String(option.value)}
          disabled={disabled || option.disabled === true}
          onClick={() => onChange(option.value)}
          className="!h-9 !px-3 !py-1.5 !text-xs"
        >
          {option.label}
        </UiOptionButton>
      ))}
    </div>
  )
}

function resolveFileName(value: unknown): string {
  if (typeof File !== 'undefined' && value instanceof File) {
    return value.name
  }
  if (value && typeof value === 'object' && 'name' in value) {
    const record = value as { name?: unknown }
    return typeof record.name === 'string' ? record.name : ''
  }
  return ''
}

function validateFileByAccept(file: File, accept: string[]): boolean {
  if (accept.length === 0) {
    return true
  }
  const mime = file.type.toLowerCase()
  const fileName = file.name.toLowerCase()
  return accept.some((item) => {
    const normalized = item.trim().toLowerCase()
    if (!normalized) {
      return false
    }
    if (normalized.startsWith('.')) {
      return fileName.endsWith(normalized)
    }
    if (normalized.endsWith('/*')) {
      const prefix = normalized.slice(0, -1)
      return mime.startsWith(prefix)
    }
    return mime === normalized
  })
}

export const CompositeFileInput: React.FC<CompositeComponentProps<FileInputConfig>> = ({
  config,
  value,
  onChange,
  disabled = false,
}) => {
  const { i18n } = useTranslation()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [errorText, setErrorText] = React.useState('')
  const selectedFileName = resolveFileName(value)
  const acceptList = Array.isArray(config.accept) ? config.accept : []
  const buttonText = config.buttonText
    ? getI18nText(config.buttonText, i18n.language)
    : '选择文件'
  const hintText = config.hint ? getI18nText(config.hint, i18n.language) : ''

  return (
    <div className="flex w-full flex-col gap-2">
      <UiInput
        ref={inputRef}
        type="file"
        accept={acceptList.join(',')}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) {
            return
          }
          if (!validateFileByAccept(file, acceptList)) {
            setErrorText('文件类型不支持')
            if (inputRef.current) {
              inputRef.current.value = ''
            }
            return
          }
          if (typeof config.maxSizeMb === 'number' && config.maxSizeMb > 0) {
            const maxSize = config.maxSizeMb * 1024 * 1024
            if (file.size > maxSize) {
              setErrorText(`文件大小不能超过 ${config.maxSizeMb}MB`)
              if (inputRef.current) {
                inputRef.current.value = ''
              }
              return
            }
          }
          setErrorText('')
          onChange(file)
          if (inputRef.current) {
            inputRef.current.value = ''
          }
        }}
      />

      <div className="flex items-center gap-2">
        <UiOptionButton
          type="button"
          variant="flat"
          className="!h-[38px] !px-3 !py-2 text-sm leading-none"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {buttonText}
        </UiOptionButton>
        {selectedFileName && (
          <UiOptionButton
            type="button"
            variant="flat"
            className="!h-[38px] !px-3 !py-2 text-sm leading-none"
            disabled={disabled}
            onClick={() => {
              setErrorText('')
              onChange(null)
            }}
          >
            清除
          </UiOptionButton>
        )}
      </div>

      {selectedFileName && (
        <div className="truncate text-xs text-text-dark" title={selectedFileName}>
          {selectedFileName}
        </div>
      )}
      {hintText && <div className="text-xs text-text-muted">{hintText}</div>}
      {errorText && <div className="text-xs text-red-400">{errorText}</div>}
    </div>
  )
}
