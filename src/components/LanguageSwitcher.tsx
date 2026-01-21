/**
 * 语言切换器组件
 */

import React, { useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { supportedLanguages } from '@/i18n'

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
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded transition-colors"
      >
        {currentLang?.name || '中文'}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-32 bg-gray-800 rounded shadow-lg z-20">
            {supportedLanguages.map(lang => (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className={`
                  w-full px-4 py-2 text-left text-sm hover:bg-gray-700 transition-colors
                  ${lang.code === currentLanguage ? 'bg-gray-700' : ''}
                `}
              >
                {lang.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default LanguageSwitcher
