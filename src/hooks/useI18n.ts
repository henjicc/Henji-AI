/**
 * i18n Hook
 * 提供类型安全的翻译函数
 */

import { useTranslation } from 'react-i18next'
import { getI18nText, type I18nText } from '@/core/types/I18nText'

export function useI18n(namespace?: string | string[]) {
  const { t, i18n } = useTranslation(namespace)

  /**
   * 翻译 I18nText 类型
   * 支持字符串和多语言对象
   */
  const tText = (text: I18nText): string => {
    return getI18nText(text, i18n.language)
  }

  /**
   * 切换语言
   */
  const changeLanguage = (lang: string) => {
    return i18n.changeLanguage(lang)
  }

  return {
    t,
    tText,
    i18n,
    changeLanguage,
    currentLanguage: i18n.language,
  }
}
