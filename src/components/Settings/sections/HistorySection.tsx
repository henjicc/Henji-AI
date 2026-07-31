import React from 'react'
import NumberInput from '@/components/ui/NumberInput'
import { UiFormRow } from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import { useI18n } from '@/hooks/useI18n'

interface HistorySectionProps {
  maxHistoryCount: number
  onChange: (value: number) => void
}

const HistorySection: React.FC<HistorySectionProps> = ({ maxHistoryCount, onChange }) => {
  const { t } = useI18n('settings')
  return (
    // 取值范围（1-500）和超出后的行为属于「不看也能填对」，收进 ⓘ
    <UiFormRow label={t('sections.history.limitLabel')} info={t('sections.history.limitHint')} inline>
      <NumberInput
        value={maxHistoryCount}
        onChange={onChange}
        min={1}
        max={500}
        step={1}
        widthClassName={SETTINGS_INLINE_CONTROL_CLASS}
      />
    </UiFormRow>
  )
}

export default HistorySection
