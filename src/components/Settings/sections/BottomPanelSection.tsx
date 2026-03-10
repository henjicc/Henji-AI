import React from 'react'
import Toggle from '@/components/ui/Toggle'
import NumberInput from '@/components/ui/NumberInput'
import SectionCard from '../components/SectionCard'
import { useI18n } from '@/hooks/useI18n'

interface BottomPanelSectionProps {
  enableAutoCollapse: boolean
  collapseDelay: number
  collapseOnScrollOnly: boolean
  onToggleAutoCollapse: (value: boolean) => void
  onChangeDelay: (value: number) => void
  onToggleScrollOnly: (value: boolean) => void
}

const BottomPanelSection: React.FC<BottomPanelSectionProps> = ({
  enableAutoCollapse,
  collapseDelay,
  collapseOnScrollOnly,
  onToggleAutoCollapse,
  onChangeDelay,
  onToggleScrollOnly
}) => {
  const { t } = useI18n('settings')
  const onText = t('actions.toggleOn')
  const offText = t('actions.toggleOff')
  return (
    <SectionCard title={t('sections.interface.bottomPanelTitle')}>
      <div className="space-y-5">
        <div>
          <Toggle
            label={t('sections.interface.autoCollapseLabel')}
            checked={enableAutoCollapse}
            onChange={onToggleAutoCollapse}
            className="w-full"
            onText={onText}
            offText={offText}
          />
          <p className="mt-2 text-xs text-zinc-500">{t('sections.interface.autoCollapseHint')}</p>
        </div>

        <div className={`transition-colors duration-300 ${!enableAutoCollapse ? 'pointer-events-none' : ''}`}>
          <NumberInput
            label={t('sections.interface.collapseDelayLabel')}
            value={collapseDelay}
            onChange={onChangeDelay}
            min={100}
            max={3000}
            step={100}
            widthClassName="w-full"
            disabled={!enableAutoCollapse}
          />
          <p className="mt-2 text-xs text-zinc-500">{t('sections.interface.collapseDelayHint')}</p>
        </div>

        <div className={`transition-colors duration-300 ${!enableAutoCollapse ? 'pointer-events-none' : ''}`}>
          <Toggle
            label={t('sections.interface.collapseOnScrollLabel')}
            checked={collapseOnScrollOnly}
            onChange={onToggleScrollOnly}
            className="w-full"
            disabled={!enableAutoCollapse}
            onText={onText}
            offText={offText}
          />
          <p className="mt-2 text-xs text-zinc-500">{t('sections.interface.collapseOnScrollHint')}</p>
        </div>
      </div>
    </SectionCard>
  )
}

export default BottomPanelSection
