import React from 'react'
import NumberInput from '@/components/ui/NumberInput'
import { UiFormRow, UiSwitch } from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import SettingsDependentRows from '../components/SettingsDependentRows'
import SettingsSegmented from '../components/SettingsSegmented'
import { useI18n } from '@/hooks/useI18n'
import type { PriceEstimateCurrencyMode } from '@/core/pricing/priceDisplay'

interface DisplaySectionProps {
  showPriceEstimate: boolean
  priceEstimateCurrencyMode: PriceEstimateCurrencyMode
  usdToCnyRate: number
  onToggleShowPrice: (value: boolean) => void
  onChangePriceEstimateCurrencyMode: (value: PriceEstimateCurrencyMode) => void
  onChangeUsdToCnyRate: (value: number) => void
}

const DisplaySection: React.FC<DisplaySectionProps> = ({
  showPriceEstimate,
  priceEstimateCurrencyMode,
  usdToCnyRate,
  onToggleShowPrice,
  onChangePriceEstimateCurrencyMode,
  onChangeUsdToCnyRate,
}) => {
  const { t } = useI18n('settings')
  const currencyModeOptions: Array<{ value: PriceEstimateCurrencyMode; label: string }> = [
    { value: 'auto', label: t('sections.display.currencyOptions.auto') },
    { value: 'cny', label: t('sections.display.currencyOptions.cny') },
    { value: 'usd', label: t('sections.display.currencyOptions.usd') },
  ]

  return (
    <>
      <UiFormRow label={t('sections.display.priceLabel')} info={t('sections.display.priceHint')} inline>
        <UiSwitch checked={showPriceEstimate} onCheckedChange={onToggleShowPrice} />
      </UiFormRow>

      <SettingsDependentRows open={showPriceEstimate}>
        <UiFormRow
          label={t('sections.display.currencyModeLabel')}
          info={t('sections.display.currencyModeHint')}
          inline
        >
          <SettingsSegmented
            value={priceEstimateCurrencyMode}
            options={currencyModeOptions}
            onChange={onChangePriceEstimateCurrencyMode}
            ariaLabel={t('sections.display.currencyModeLabel')}
          />
        </UiFormRow>

        <UiFormRow
          label={t('sections.display.exchangeRateLabel')}
          info={t('sections.display.exchangeRateHint')}
          inline
        >
          <NumberInput
            value={usdToCnyRate}
            onChange={onChangeUsdToCnyRate}
            min={0.01}
            max={999.9999}
            step={0.01}
            precision={4}
            widthClassName={SETTINGS_INLINE_CONTROL_CLASS}
          />
        </UiFormRow>
      </SettingsDependentRows>
    </>
  )
}

export default DisplaySection
