/**
 * i18n Hook
 * 提供类型安全的翻译函数
 */

import { useTranslation } from 'react-i18next'
import type { I18nText } from '@/core/types/I18nText'

export function useI18n(namespace?: string | string[]) {
  const { t, i18n } = useTranslation(namespace)

  /**
   * 翻译 I18nText 类型
   * 支持字符串和多语言对象
   */
  const tText = (text: I18nText): string => {
    if (typeof text === 'string') {
      return text
    }

    const lang = i18n.language

    // 优先使用当前语言
    if (text[lang]) {
      return text[lang]
    }

    // 降级到中文
    if (text.zh) {
      return text.zh
    }

    // 降级到英文
    if (text.en) {
      return text.en
    }

    // 返回第一个可用的值
    const firstKey = Object.keys(text)[0]
    return text[firstKey] || ''
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
