import React from 'react'
import Dropdown from '@/components/ui/Dropdown'
import NumberInput from '@/components/ui/NumberInput'
import { UiFormRow, UiSwitch } from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import { useI18n } from '@/hooks/useI18n'
import type { PriceEstimateCurrencyMode } from '@/core/pricing/priceDisplay'

interface DisplaySectionProps {
  showPriceEstimate: boolean
  priceEstimateCurrencyMode: PriceEstimateCurrencyMode
  usdToCnyRate: number
  enableAutoFocusModelSearch: boolean
  onToggleShowPrice: (value: boolean) => void
  onChangePriceEstimateCurrencyMode: (value: PriceEstimateCurrencyMode) => void
  onChangeUsdToCnyRate: (value: number) => void
  onToggleAutoFocus: (value: boolean) => void
}

const DisplaySection: React.FC<DisplaySectionProps> = ({
  showPriceEstimate,
  priceEstimateCurrencyMode,
  usdToCnyRate,
  enableAutoFocusModelSearch,
  onToggleShowPrice,
  onChangePriceEstimateCurrencyMode,
  onChangeUsdToCnyRate,
  onToggleAutoFocus
}) => {
  const { t } = useI18n('settings')
  const currencyModeOptions: Array<{ value: PriceEstimateCurrencyMode; label: string }> = [
    { value: 'auto', label: t('sections.display.currencyOptions.auto') },
    { value: 'cny', label: t('sections.display.currencyOptions.cny') },
    { value: 'usd', label: t('sections.display.currencyOptions.usd') },
  ]
  const priceDependentClass = showPriceEstimate ? '' : 'opacity-50'

  return (
    <>
      <UiFormRow label={t('sections.display.priceLabel')} info={t('sections.display.priceHint')} inline>
        <UiSwitch checked={showPriceEstimate} onCheckedChange={onToggleShowPrice} />
      </UiFormRow>

      <UiFormRow
        label={t('sections.display.currencyModeLabel')}
        info={t('sections.display.currencyModeHint')}
        inline
        className={priceDependentClass}
      >
        <Dropdown
          value={priceEstimateCurrencyMode}
          options={currencyModeOptions}
          display={currencyModeOptions.find((option) => option.value === priceEstimateCurrencyMode)?.label}
          onSelect={(value) => onChangePriceEstimateCurrencyMode(value as PriceEstimateCurrencyMode)}
          className={SETTINGS_INLINE_CONTROL_CLASS}
          disabled={!showPriceEstimate}
        />
      </UiFormRow>

      <UiFormRow
        label={t('sections.display.exchangeRateLabel')}
        info={t('sections.display.exchangeRateHint')}
        inline
        className={priceDependentClass}
      >
        <NumberInput
          value={usdToCnyRate}
          onChange={onChangeUsdToCnyRate}
          min={0.01}
          max={999.9999}
          step={0.01}
          precision={4}
          widthClassName={SETTINGS_INLINE_CONTROL_CLASS}
          disabled={!showPriceEstimate}
        />
      </UiFormRow>

      <UiFormRow label={t('sections.display.autoFocusLabel')} info={t('sections.display.autoFocusHint')} inline>
        <UiSwitch checked={enableAutoFocusModelSearch} onCheckedChange={onToggleAutoFocus} />
      </UiFormRow>
    </>
  )
}

export default DisplaySection
