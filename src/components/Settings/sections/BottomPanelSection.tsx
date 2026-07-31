import React from 'react'
import NumberInput from '@/components/ui/NumberInput'
import { UiFormRow, UiSwitch } from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
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
  const dependentClass = enableAutoCollapse ? '' : 'opacity-50'

  return (
    <>
      <UiFormRow
        label={t('sections.interface.autoCollapseLabel')}
        info={t('sections.interface.autoCollapseHint')}
        inline
      >
        <UiSwitch checked={enableAutoCollapse} onCheckedChange={onToggleAutoCollapse} />
      </UiFormRow>

      <UiFormRow
        label={t('sections.interface.collapseDelayLabel')}
        info={t('sections.interface.collapseDelayHint')}
        inline
        className={dependentClass}
      >
        <NumberInput
          value={collapseDelay}
          onChange={onChangeDelay}
          min={100}
          max={3000}
          step={100}
          widthClassName={SETTINGS_INLINE_CONTROL_CLASS}
          disabled={!enableAutoCollapse}
        />
      </UiFormRow>

      <UiFormRow
        label={t('sections.interface.collapseOnScrollLabel')}
        info={t('sections.interface.collapseOnScrollHint')}
        inline
        className={dependentClass}
      >
        <UiSwitch
          checked={collapseOnScrollOnly}
          onCheckedChange={onToggleScrollOnly}
          disabled={!enableAutoCollapse}
        />
      </UiFormRow>
    </>
  )
}

export default BottomPanelSection
