/**
 * 语言切换器组件
 */

import React, { useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { supportedLanguages } from '@/i18n'
import { UiButton, UiOptionButton, UiPanel } from '@/components/ui'

export function LanguageSwitcher() {
  const { currentLanguage, changeLanguage } = useI18n()
  const [isOpen, setIsOpen] = useState(false)

  const currentLang = supportedLanguages.find(lang => lang.code === currentLanguage)

  const handleLanguageChange = async (langCode: string) => {
    await changeLanguage(langCode)
    setIsOpen(false)
  }

  return (
    <div className="relative">
      <UiButton
        variant="muted"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="px-3"
      >
        {currentLang?.name || '中文'}
      </UiButton>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <UiPanel className="absolute right-0 z-20 mt-2 w-32 p-1">
            {supportedLanguages.map(lang => (
              <UiOptionButton
                active={lang.code === currentLanguage}
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className="w-full px-4 py-2 text-left text-sm"
              >
                {lang.name}
              </UiOptionButton>
            ))}
          </UiPanel>
        </>
      )}
    </div>
  )
}

export default LanguageSwitcher
