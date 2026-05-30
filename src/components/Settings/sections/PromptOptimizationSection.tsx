import React from 'react'
import Dropdown from '@/components/ui/Dropdown'
import SectionCard from '../components/SectionCard'
import { useI18n } from '@/hooks/useI18n'
import type { PromptOptimizationButtonBehavior } from '@/core/llm/promptOptimizationBehavior'

interface PromptOptimizationSectionProps {
  behavior: PromptOptimizationButtonBehavior
  onChangeBehavior: (value: PromptOptimizationButtonBehavior) => void
}

const PromptOptimizationSection: React.FC<PromptOptimizationSectionProps> = ({
  behavior,
  onChangeBehavior,
}) => {
  const { t } = useI18n('settings')
  const options: Array<{ value: PromptOptimizationButtonBehavior; label: string }> = [
    { value: 'select-profile', label: t('sections.promptOptimization.options.selectProfile') },
    { value: 'direct-optimize', label: t('sections.promptOptimization.options.directOptimize') },
  ]

  return (
    <SectionCard title={t('sections.promptOptimization.title')}>
      <Dropdown
        label={t('sections.promptOptimization.label')}
        value={behavior}
        options={options}
        display={options.find((option) => option.value === behavior)?.label}
        onSelect={(value) => onChangeBehavior(value as PromptOptimizationButtonBehavior)}
        className="w-full"
      />
      <p className="mt-2 text-xs text-zinc-500">{t('sections.promptOptimization.hint')}</p>
    </SectionCard>
  )
}

export default PromptOptimizationSection
