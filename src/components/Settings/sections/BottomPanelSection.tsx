import React from 'react'
import { UI_SEGMENTED_TRACK_CLASS, UiFormRow, UiOptionButton, UiRangeInput } from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import SettingsDependentRows from '../components/SettingsDependentRows'
import { useI18n } from '@/hooks/useI18n'

interface BottomPanelSectionProps {
  enableAutoCollapse: boolean
  collapseDelay: number
  collapseOnScrollOnly: boolean
  onToggleAutoCollapse: (value: boolean) => void
  onChangeDelay: (value: number) => void
  onToggleScrollOnly: (value: boolean) => void
}

type CollapseMode = 'off' | 'scroll' | 'scrollOrLeave'

/**
 * 生成页底部面板的自动折叠。
 *
 * 存储仍是三个键（开关、仅滚动、延迟），界面合成一个三选一：
 * 原来三项并排时，默认开着「仅滚动时折叠」，此时「折叠延迟」完全不起作用却显示为可调。
 * 现在只有「鼠标离开也折叠」这一档才出现延迟。
 */
const BottomPanelSection: React.FC<BottomPanelSectionProps> = ({
  enableAutoCollapse,
  collapseDelay,
  collapseOnScrollOnly,
  onToggleAutoCollapse,
  onChangeDelay,
  onToggleScrollOnly
}) => {
  const { t } = useI18n('settings')
  const mode: CollapseMode = !enableAutoCollapse ? 'off' : collapseOnScrollOnly ? 'scroll' : 'scrollOrLeave'
  const modes: CollapseMode[] = ['off', 'scroll', 'scrollOrLeave']

  const selectMode = (next: CollapseMode): void => {
    onToggleAutoCollapse(next !== 'off')
    if (next !== 'off') onToggleScrollOnly(next === 'scroll')
  }

  return (
    <>
      <UiFormRow label={t('sections.interface.autoCollapseLabel')} info={t('sections.interface.autoCollapseHint')} inline>
        <div role="radiogroup" aria-label={t('sections.interface.autoCollapseLabel')} className={UI_SEGMENTED_TRACK_CLASS}>
          {modes.map((item) => (
            <UiOptionButton
              key={item}
              type="button"
              variant="segment"
              role="radio"
              aria-checked={mode === item}
              active={mode === item}
              onClick={() => selectMode(item)}
            >
              {t(`sections.interface.autoCollapseModes.${item}`)}
            </UiOptionButton>
          ))}
        </div>
      </UiFormRow>

      <SettingsDependentRows open={mode === 'scrollOrLeave'}>
        <UiFormRow
          label={t('sections.interface.collapseDelayLabel', { value: (collapseDelay / 1000).toFixed(1) })}
          info={t('sections.interface.collapseDelayHint')}
          inline
        >
          <UiRangeInput
            min={100}
            max={3000}
            step={100}
            value={collapseDelay}
            onChange={(event) => onChangeDelay(Number(event.target.value))}
            className={SETTINGS_INLINE_CONTROL_CLASS}
          />
        </UiFormRow>
      </SettingsDependentRows>
    </>
  )
}

export default BottomPanelSection
