import React, { useState } from 'react'
import Dropdown from '@/components/ui/Dropdown'
import SectionCard from '../components/SectionCard'
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

  return (
    <SectionCard
      title={t('sections.language.title')}
      description={t('sections.language.description')}
    >
      <Dropdown
        label={t('sections.language.label')}
        value={language}
        options={options}
        display={options.find(option => option.value === language)?.label}
        onSelect={(value) => {
          changeLanguage(value)
          setLanguage(getCurrentLanguage())
        }}
        className="w-full"
      />
    </SectionCard>
  )
}

export default LanguageSection
