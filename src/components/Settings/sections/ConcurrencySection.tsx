import React from 'react'
import NumberInput from '@/components/ui/NumberInput'
import SectionCard from '../components/SectionCard'
import { useI18n } from '@/hooks/useI18n'
import { UI_TEXT_META_CLASS } from '@/components/ui'

interface ConcurrencySectionProps {
  maxConcurrentTasks: number
  onChange: (value: number) => void
}

const ConcurrencySection: React.FC<ConcurrencySectionProps> = ({ maxConcurrentTasks, onChange }) => {
  const { t } = useI18n('settings')
  return (
    <SectionCard title={t('sections.concurrency.title')}>
      <NumberInput
        label={t('sections.concurrency.label')}
        value={maxConcurrentTasks}
        onChange={onChange}
        min={1}
        max={10}
        step={1}
        widthClassName="w-full"
      />
      <p className={`mt-2 ${UI_TEXT_META_CLASS}`}>{t('sections.concurrency.hint')}</p>
      <p className={`mt-1 ${UI_TEXT_META_CLASS}`}>{t('sections.concurrency.queueHint')}</p>
    </SectionCard>
  )
}

export default ConcurrencySection
