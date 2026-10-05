import React from 'react'
import Dropdown from '@/components/ui/Dropdown'
import { UiFormRow, UiSwitch } from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import { useI18n } from '@/hooks/useI18n'
import type { PromptOptimizationButtonBehavior } from '@/core/llm/promptOptimizationBehavior'

interface PromptOptimizationSectionProps {
  behavior: PromptOptimizationButtonBehavior
  onChangeBehavior: (value: PromptOptimizationButtonBehavior) => void
  enableAutoFocusModelSearch: boolean
  onToggleAutoFocus: (value: boolean) => void
}

const PromptOptimizationSection: React.FC<PromptOptimizationSectionProps> = ({
  behavior,
  onChangeBehavior,
  enableAutoFocusModelSearch,
  onToggleAutoFocus,
}) => {
  const { t } = useI18n('settings')
  const options: Array<{ value: PromptOptimizationButtonBehavior; label: string }> = [
    { value: 'select-profile', label: t('sections.promptOptimization.options.selectProfile') },
    { value: 'direct-optimize', label: t('sections.promptOptimization.options.directOptimize') },
  ]

  return (
    <>
      <UiFormRow
        label={t('sections.promptOptimization.title')}
        info={t('sections.promptOptimization.hint')}
        inline
      >
        <Dropdown
          value={behavior}
          options={options}
          display={options.find((option) => option.value === behavior)?.label}
          onSelect={(value) => onChangeBehavior(value as PromptOptimizationButtonBehavior)}
          className={SETTINGS_INLINE_CONTROL_CLASS}
        />
      </UiFormRow>
      <UiFormRow label={t('sections.display.autoFocusLabel')} info={t('sections.display.autoFocusHint')} inline>
        <UiSwitch checked={enableAutoFocusModelSearch} onCheckedChange={onToggleAutoFocus} />
      </UiFormRow>
    </>
  )
}

export default PromptOptimizationSection
