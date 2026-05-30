import React from 'react'
import Dropdown from '@/components/ui/Dropdown'
import NumberInput from '@/components/ui/NumberInput'
import Toggle from '@/components/ui/Toggle'
import SectionCard from '../components/SectionCard'
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
  const onText = t('actions.toggleOn')
  const offText = t('actions.toggleOff')
  const currencyModeOptions: Array<{ value: PriceEstimateCurrencyMode; label: string }> = [
    { value: 'auto', label: t('sections.display.currencyOptions.auto') },
    { value: 'cny', label: t('sections.display.currencyOptions.cny') },
    { value: 'usd', label: t('sections.display.currencyOptions.usd') },
  ]
  return (
    <SectionCard title={t('sections.display.title')}>
      <Toggle
        label={t('sections.display.priceLabel')}
        checked={showPriceEstimate}
        onChange={onToggleShowPrice}
        className="w-full"
        onText={onText}
        offText={offText}
      />
      <p className="mt-2 text-xs text-zinc-500">{t('sections.display.priceHint')}</p>

      <div className="mt-4 border-t border-border-dark pt-4">
        <div className={`space-y-3 ${showPriceEstimate ? '' : 'opacity-60'}`}>
          <Dropdown
            label={t('sections.display.currencyModeLabel')}
            value={priceEstimateCurrencyMode}
            options={currencyModeOptions}
            display={currencyModeOptions.find((option) => option.value === priceEstimateCurrencyMode)?.label}
            onSelect={(value) => onChangePriceEstimateCurrencyMode(value as PriceEstimateCurrencyMode)}
            className="w-full"
            disabled={!showPriceEstimate}
          />
          <p className="text-xs text-zinc-500">{t('sections.display.currencyModeHint')}</p>

          <NumberInput
            label={t('sections.display.exchangeRateLabel')}
            value={usdToCnyRate}
            onChange={onChangeUsdToCnyRate}
            min={0.01}
            max={999.9999}
            step={0.01}
            precision={4}
            widthClassName="w-full"
            disabled={!showPriceEstimate}
          />
          <p className="text-xs text-zinc-500">{t('sections.display.exchangeRateHint')}</p>
        </div>

        <div className="mt-4 border-t border-border-dark pt-4">
          <Toggle
            label={t('sections.display.autoFocusLabel')}
            checked={enableAutoFocusModelSearch}
            onChange={onToggleAutoFocus}
            className="w-full"
            onText={onText}
            offText={offText}
          />
          <p className="mt-2 text-xs text-zinc-500">{t('sections.display.autoFocusHint')}</p>
        </div>
      </div>
    </SectionCard>
  )
}

export default DisplaySection
