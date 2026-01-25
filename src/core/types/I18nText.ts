import i18n from '@/i18n'

const KNOWN_NAMESPACES = ['common', 'models', 'params', 'errors', 'ui', 'history', 'settings'] as const

/**
 * 国际化文本类型
 *
 * 支持纯字符串、多语言对象或 i18n key
 *
 * @example
 * ```typescript
 * // 纯字符串（默认语言）
 * const text1: I18nText = "Hello"
 *
 * // 多语言对象
 * const text2: I18nText = {
 *   zh: "你好",
 *   en: "Hello"
 * }
 * ```
 */
export type I18nText = string | {
  zh: string
  en: string
  [lang: string]: string  // 支持未来扩展其他语言
} | {
  key: string
  fallback?: string
  absolute?: boolean
}

/**
 * 翻译 I18nText 的函数类型
 */
export type TranslateI18nText = (text: I18nText) => string

/**
 * 获取国际化文本的实际值
 *
 * @param text - 国际化文本
 * @param locale - 语言代码（默认 'zh'）
 * @returns 实际文本值
 */
export function getI18nText(text: I18nText, locale: string = 'zh'): string {
  if (typeof text === 'string') {
    return text
  }

  if ('key' in text && typeof text.key === 'string') {
    const fallback = typeof text.fallback === 'string' ? text.fallback : text.key
    const key = text.key
    try {
      if (key.includes(':')) {
        return i18n.t(key, { defaultValue: fallback })
      }

      for (const ns of KNOWN_NAMESPACES) {
        const prefix = `${ns}.`
        if (key.startsWith(prefix)) {
          return i18n.t(key.slice(prefix.length), { ns, defaultValue: fallback })
        }
      }

      return i18n.t(key, { defaultValue: fallback })
    } catch {
      return fallback
    }
  }

  // 1. 尝试完全匹配 (e.g. 'zh-CN')
  if (text[locale]) {
    return text[locale]
  }

  // 2. 尝试语言前缀匹配 (e.g. 'zh-CN' -> 'zh', 'en-US' -> 'en')
  const langPrefix = locale.split('-')[0]
  if (text[langPrefix]) {
    return text[langPrefix]
  }

  // 3. 如果请求的是英语但没找到，尝试找 en
  if (langPrefix === 'en' && text.en) {
    return text.en
  }

  // 4. 默认回退（优先 zh，然后 en，最后第一个可用值）
  if (text.zh) return text.zh
  if (text.en) return text.en

  const firstKey = Object.keys(text)[0]
  return text[firstKey] || ''
}

/**
 * 判断是否为 I18nText 对象
 */
export function isI18nTextObject(text: I18nText): text is Exclude<I18nText, string> {
  return typeof text === 'object' && text !== null
}
