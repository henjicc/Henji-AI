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
