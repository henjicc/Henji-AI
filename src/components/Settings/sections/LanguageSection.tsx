import React, { useState } from 'react'
import Dropdown from '@/components/ui/Dropdown'
import { UiFormRow } from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import { getCurrentLanguage, changeLanguage, type LanguageOption } from '@/utils/language'
import { useI18n } from '@/hooks/useI18n'

const LanguageSection: React.FC = () => {
  const { t } = useI18n('settings')
  const [language, setLanguage] = useState<LanguageOption>(getCurrentLanguage())

  const options: Array<{ value: LanguageOption; label: string }> = [
    { value: 'auto', label: t('sections.language.options.auto') },
    { value: 'zh-CN', label: t('sections.language.options.zhCN') },
    { value: 'en-US', label: t('sections.language.options.enUS') }
  ]

  // 标签自解释，不给说明：原来的「选择界面显示语言」和标签在说同一件事
  return (
    <UiFormRow label={t('sections.language.label')} inline>
      <Dropdown
        value={language}
        options={options}
        display={options.find(option => option.value === language)?.label}
        onSelect={(value) => {
          changeLanguage(value)
          setLanguage(getCurrentLanguage())
        }}
        className={SETTINGS_INLINE_CONTROL_CLASS}
      />
    </UiFormRow>
  )
}

export default LanguageSection
