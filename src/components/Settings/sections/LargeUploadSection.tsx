import React from 'react'

import Dropdown from '@/components/ui/Dropdown'
import { UiFormRow } from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import { useI18n } from '@/hooks/useI18n'
import { useSettingsStore, type LargeUploadStrategy } from '@/stores/settingsStore'

const STRATEGY_OPTIONS: LargeUploadStrategy[] = ['ask', 'copy', 'reference']

/** 大文件（>100MB）本地媒体的处理策略设置：每次询问 / 复制进数据目录 / 直接引用原文件 */
const LargeUploadSection: React.FC = () => {
  const { t } = useI18n('settings')
  const strategy = useSettingsStore((state) => state.largeUploadStrategy)
  const setStrategy = useSettingsStore((state) => state.setLargeUploadStrategy)

  const options = STRATEGY_OPTIONS.map((value) => ({
    value,
    label: t(`sections.largeUpload.options.${value}`),
  }))

  return (
    // 常驻说明：100MB 这个阈值决定了这个设置什么时候才生效，不看会以为它管所有上传
    <UiFormRow
      label={t('sections.largeUpload.strategyLabel')}
      hint={t('sections.largeUpload.description')}
      info={t('sections.largeUpload.hint')}
      inline
    >
      <Dropdown
        value={strategy}
        display={options.find((option) => option.value === strategy)?.label}
        options={options}
        onSelect={(value) => setStrategy(value as LargeUploadStrategy)}
        className={SETTINGS_INLINE_CONTROL_CLASS}
      />
    </UiFormRow>
  )
}

export default LargeUploadSection
