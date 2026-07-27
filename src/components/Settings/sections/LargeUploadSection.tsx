import React from 'react'

import Dropdown from '@/components/ui/Dropdown'
import SectionCard from '../components/SectionCard'
import { useI18n } from '@/hooks/useI18n'
import { useSettingsStore, type LargeUploadStrategy } from '@/stores/settingsStore'
import { UI_TEXT_LABEL_CLASS, UI_TEXT_META_CLASS } from '@/components/ui'

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
    <SectionCard
      title={t('sections.largeUpload.title')}
      description={t('sections.largeUpload.description')}
    >
      <div className="flex items-center justify-between gap-4">
        <label className={UI_TEXT_LABEL_CLASS}>
          {t('sections.largeUpload.strategyLabel')}
        </label>
        <Dropdown
          value={strategy}
          display={options.find((option) => option.value === strategy)?.label}
          options={options}
          onSelect={(value) => setStrategy(value as LargeUploadStrategy)}
          className="w-44"
          buttonClassName="h-[34px] w-full bg-surface-dark border-border-dark"
        />
      </div>
      <p className={`mt-2 ${UI_TEXT_META_CLASS}`}>{t('sections.largeUpload.hint')}</p>
    </SectionCard>
  )
}

export default LargeUploadSection
