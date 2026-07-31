import React from 'react'
import NumberInput from '@/components/ui/NumberInput'
import { UiFormRow } from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import { useI18n } from '@/hooks/useI18n'

interface ConcurrencySectionProps {
  maxConcurrentTasks: number
  onChange: (value: number) => void
}

const ConcurrencySection: React.FC<ConcurrencySectionProps> = ({ maxConcurrentTasks, onChange }) => {
  const { t } = useI18n('settings')
  return (
    // 两条说明合并进 ⓘ：都是「超出后会排队」这类工作原理，不影响用户填几
    <UiFormRow
      label={t('sections.concurrency.label')}
      info={`${t('sections.concurrency.hint')} ${t('sections.concurrency.queueHint')}`}
      inline
    >
      <NumberInput
        value={maxConcurrentTasks}
        onChange={onChange}
        min={1}
        max={10}
        step={1}
        widthClassName={SETTINGS_INLINE_CONTROL_CLASS}
      />
    </UiFormRow>
  )
}

export default ConcurrencySection
