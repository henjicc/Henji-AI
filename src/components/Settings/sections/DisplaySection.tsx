import React from 'react'
import Toggle from '@/components/ui/Toggle'
import SectionCard from '../components/SectionCard'
import { useI18n } from '@/hooks/useI18n'

interface DisplaySectionProps {
  showPriceEstimate: boolean
  enableAutoFocusModelSearch: boolean
  onToggleShowPrice: (value: boolean) => void
  onToggleAutoFocus: (value: boolean) => void
}

const DisplaySection: React.FC<DisplaySectionProps> = ({
  showPriceEstimate,
  enableAutoFocusModelSearch,
  onToggleShowPrice,
  onToggleAutoFocus
}) => {
  const { t } = useI18n('settings')
  const onText = t('actions.toggleOn')
  const offText = t('actions.toggleOff')
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

      <div className="mt-4 pt-4 border-t border-zinc-700/30">
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
    </SectionCard>
  )
}

export default DisplaySection
