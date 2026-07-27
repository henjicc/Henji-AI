import React from 'react'
import NumberInput from '@/components/ui/NumberInput'
import SectionCard from '../components/SectionCard'
import { useI18n } from '@/hooks/useI18n'
import { UI_TEXT_META_CLASS } from '@/components/ui'

interface HistorySectionProps {
  maxHistoryCount: number
  onChange: (value: number) => void
}

const HistorySection: React.FC<HistorySectionProps> = ({ maxHistoryCount, onChange }) => {
  const { t } = useI18n('settings')
  return (
    <SectionCard title={t('sections.history.title')}>
      <NumberInput
        label={t('sections.history.limitLabel')}
        value={maxHistoryCount}
        onChange={onChange}
        min={1}
        max={500}
        step={1}
        widthClassName="w-full"
      />
      <p className={`mt-2 ${UI_TEXT_META_CLASS}`}>{t('sections.history.limitHint')}</p>
    </SectionCard>
  )
}

export default HistorySection
