import Dropdown from '@/components/ui/Dropdown'
import { UiFormRow } from '@/components/ui'
import { UI_SCALE_MODES, type UiScaleMode } from '@/core/theme/uiScale'
import { useI18n } from '@/hooks/useI18n'
import { useSettingsStore } from '@/stores/settingsStore'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'

export default function UiScaleSection(): JSX.Element {
  const { t } = useI18n('settings')
  const uiScaleMode = useSettingsStore((state) => state.uiScaleMode)
  const setUiScaleMode = useSettingsStore((state) => state.setUiScaleMode)
  const options = UI_SCALE_MODES.map((value) => ({
    value,
    label: t(`sections.interface.uiScaleOptions.${value}`),
  }))

  return (
    <UiFormRow
      label={t('sections.interface.uiScaleLabel')}
      info={t('sections.interface.uiScaleHint')}
      inline
    >
      <Dropdown
        value={uiScaleMode}
        options={options}
        display={options.find((option) => option.value === uiScaleMode)?.label}
        onSelect={(value) => setUiScaleMode(value as UiScaleMode)}
        className={SETTINGS_INLINE_CONTROL_CLASS}
      />
    </UiFormRow>
  )
}
